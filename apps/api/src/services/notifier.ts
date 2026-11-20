/**
 * 阶段 6 告警 Webhook 异步通知分发器：
 * 内置 SSRF 目标地址校验（阻断 169.254.0.0/16 云元数据、非 http/https 协议及内嵌凭据 URL）、
 * 可选 HMAC-SHA256 签名（X-LHM-Signature）、5 秒超时限制与敏感密钥脱敏存储（is_sensitive=1）。
 */
import { createHmac } from "node:crypto";
import type { AlertTransitionRecord } from "@lhm/protocol";
import type { AuthRepository } from "../repositories/authRepo.ts";

export interface NotificationPublicConfig {
  webhook_enabled: boolean;
  webhook_url: string;
  has_secret: boolean;
}

export interface WebhookDeliveryResult {
  delivered: boolean;
  status: number | null;
  error: string | null;
}

const WEBHOOK_ENABLED_KEY = "notification_webhook_enabled";
const WEBHOOK_URL_KEY = "notification_webhook_url";
const WEBHOOK_SECRET_KEY = "notification_webhook_secret";

/**
 * Validates outbound webhook URLs against protocol abuse and cloud-metadata / link-local SSRF.
 * Allows http:// and https:// LAN or external endpoints while rejecting link-local metadata ranges.
 */
export function validateWebhookUrl(rawUrl: string): { ok: true; url: URL } | { ok: false; reason: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { ok: false, reason: "Webhook URL cannot be empty" };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "Webhook URL must be a valid HTTP(S) URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "Only http:// and https:// webhook URLs are allowed" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "Embedded credentials in webhook URL are forbidden" };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "0.0.0.0" ||
    host === "::" ||
    host.startsWith("169.254.") ||
    host.startsWith("fe80:") ||
    host === "metadata.google.internal" ||
    host === "metadata"
  ) {
    return { ok: false, reason: `Blocked restricted/metadata webhook target: ${host}` };
  }

  return { ok: true, url: parsed };
}

/**
 * Non-blocking, timeout-bounded Webhook dispatcher for Phase 6 alert notifications.
 * Secrets are stored with is_sensitive=1 and never echoed back to clients or logs.
 */
export class AlertNotifier {
  constructor(private readonly authRepo: AuthRepository) {}

  getPublicConfig(): NotificationPublicConfig {
    const enabled = Boolean(this.authRepo.getInternalSetting(WEBHOOK_ENABLED_KEY)?.value ?? false);
    const url = String(this.authRepo.getInternalSetting(WEBHOOK_URL_KEY)?.value ?? "");
    const secret = String(this.authRepo.getInternalSetting(WEBHOOK_SECRET_KEY)?.value ?? "");
    return {
      webhook_enabled: enabled,
      webhook_url: url,
      has_secret: secret.length > 0,
    };
  }

  saveConfig(
    input: { webhook_enabled?: boolean; webhook_url?: string; webhook_secret?: string | null },
    actorUsername: string,
  ): NotificationPublicConfig {
    const current = this.getPublicConfig();
    const nextEnabled =
      input.webhook_enabled !== undefined ? Boolean(input.webhook_enabled) : current.webhook_enabled;
    const nextUrl =
      input.webhook_url !== undefined ? String(input.webhook_url).trim() : current.webhook_url;

    if (nextEnabled || nextUrl.length > 0) {
      const check = validateWebhookUrl(nextUrl);
      if (!check.ok) {
        throw new Error(check.reason);
      }
    }

    const updates: Record<string, unknown> = {
      [WEBHOOK_ENABLED_KEY]: nextEnabled,
      [WEBHOOK_URL_KEY]: nextUrl,
    };
    const sensitive = new Set<string>();
    if (input.webhook_secret !== undefined) {
      updates[WEBHOOK_SECRET_KEY] = input.webhook_secret === null ? "" : String(input.webhook_secret);
      sensitive.add(WEBHOOK_SECRET_KEY);
    }

    this.authRepo.upsertSettings(updates, actorUsername, sensitive);
    return this.getPublicConfig();
  }

  async sendPayload(payload: Record<string, unknown>): Promise<WebhookDeliveryResult> {
    const url = String(this.authRepo.getInternalSetting(WEBHOOK_URL_KEY)?.value ?? "").trim();
    const secret = String(this.authRepo.getInternalSetting(WEBHOOK_SECRET_KEY)?.value ?? "");

    const check = validateWebhookUrl(url);
    if (!check.ok) {
      return { delivered: false, status: null, error: check.reason };
    }

    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "content-type": "application/json; charset=utf-8",
      "user-agent": "linux-hardware-monitor/1.1",
    };
    if (secret.length > 0) {
      const sig = createHmac("sha256", secret).update(body).digest("hex");
      headers["x-lhm-signature"] = `sha256=${sig}`;
    }

    try {
      const res = await fetch(check.url.toString(), {
        method: "POST",
        headers,
        body,
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        return {
          delivered: false,
          status: res.status,
          error: `Webhook endpoint returned HTTP ${res.status}`,
        };
      }
      return { delivered: true, status: res.status, error: null };
    } catch (err) {
      return {
        delivered: false,
        status: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async dispatchTransitions(transitions: AlertTransitionRecord[]): Promise<void> {
    if (transitions.length === 0) return;
    const cfg = this.getPublicConfig();
    if (!cfg.webhook_enabled || !cfg.webhook_url) return;

    for (const tr of transitions) {
      const result = await this.sendPayload({
        event: "alert_transition",
        timestamp: new Date().toISOString(),
        transition: tr,
      });
      if (!result.delivered) {
        console.warn(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            component: "lhm-api-notifier",
            level: "WARN",
            error_code: "WEBHOOK_DELIVERY_FAILED",
            device_id: tr.device_id,
            message: result.error ?? "Webhook delivery failed",
          }),
        );
      }
    }
  }
}
