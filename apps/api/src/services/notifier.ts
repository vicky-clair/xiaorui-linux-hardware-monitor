/**
 * 阶段 6 告警 Webhook 异步通知分发器：
 * 内置 SSRF 目标地址校验（阻断 169.254.0.0/16 云元数据、非 http/https 协议及内嵌凭据 URL）、
 * 可选 HMAC-SHA256 签名（X-LHM-Signature）、5 秒超时限制与敏感密钥脱敏存储（is_sensitive=1）。
 */
import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
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

export interface WebhookValidationOptions {
  /** 仅用于本地自动化测试放行 127.0.0.1 接收器；生产环境恒为 false */
  allowLoopback?: boolean;
}

/** 校验单个 IP 字符串是否落入禁止访问的回环、云元数据、链路本地或组播网段（局域网 RFC1918 合法放行以便自托管告警推送） */
export function isRestrictedWebhookIp(
  rawIp: string,
  options: WebhookValidationOptions = {},
): boolean {
  const ip = rawIp.toLowerCase().replace(/^\[|\]$/g, "");
  if (ip === "0.0.0.0" || ip === "::" || ip === "::0") return true;

  // 处理 IPv4-mapped IPv6（兼容点分十进制与 WHATWG URL 规范化后的十六进制形式，如 ::ffff:a9fe:a9fe / ::ffff:7f00:1）
  const v4MappedPrefix = ip.startsWith("::ffff:")
    ? "::ffff:"
    : ip.startsWith("0:0:0:0:0:ffff:")
      ? "0:0:0:0:0:ffff:"
      : null;
  if (v4MappedPrefix) {
    const mapped = ip.slice(v4MappedPrefix.length);
    if (isIP(mapped) === 4) {
      return isRestrictedWebhookIp(mapped, options);
    }
    const hexMatch = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(mapped);
    if (hexMatch) {
      const hi = parseInt(hexMatch[1]!, 16);
      const lo = parseInt(hexMatch[2]!, 16);
      const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isRestrictedWebhookIp(ipv4, options);
    }
  }

  // 回环地址：生产默认拦截，仅本地测试显式 allowLoopback=true 时放行
  if (!options.allowLoopback) {
    if (ip === "::1" || ip === "127.0.0.1" || ip.startsWith("127.")) {
      return true;
    }
  }

  // 云元数据与链路本地地址（IPv4 169.254.0.0/16、IPv6 fe80::/10）
  if (ip.startsWith("169.254.") || /^fe[89ab][0-9a-f]:/.test(ip)) {
    return true;
  }

  // 组播/广播地址（IPv4 224.0.0.0/4..255.255.255.255、IPv6 ff00::/8）
  if (ip.startsWith("ff")) return true;
  if (isIP(ip) === 4) {
    const firstOctet = Number(ip.split(".")[0]);
    if (firstOctet === 0 || firstOctet >= 224) return true;
  }

  return false;
}

/**
 * Validates outbound webhook URLs against protocol abuse, loopback, cloud-metadata / link-local SSRF.
 * Allows http:// and https:// LAN (RFC1918) or external endpoints for self-hosted deployments.
 */
export function validateWebhookUrl(
  rawUrl: string,
  options: WebhookValidationOptions = {},
): { ok: true; url: URL } | { ok: false; reason: string } {
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
    host === "metadata.google.internal" ||
    host === "metadata" ||
    (!options.allowLoopback && (host === "localhost" || host.endsWith(".localhost"))) ||
    isRestrictedWebhookIp(host, options)
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
  constructor(
    private readonly authRepo: AuthRepository,
    private readonly options: WebhookValidationOptions = {},
  ) {}

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
      const check = validateWebhookUrl(nextUrl, this.options);
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

    const check = validateWebhookUrl(url, this.options);
    if (!check.ok) {
      return { delivered: false, status: null, error: check.reason };
    }

    // 发送前对域名做真实 DNS 解析，阻止将外部域名指向回环/云元数据地址的 DNS SSRF
    const host = check.url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (isIP(host) === 0) {
      try {
        const resolved = await lookup(host, { all: true });
        for (const addr of resolved) {
          if (isRestrictedWebhookIp(addr.address, this.options)) {
            return {
              delivered: false,
              status: null,
              error: `Blocked webhook DNS resolution to restricted IP: ${addr.address}`,
            };
          }
        }
      } catch (err) {
        return {
          delivered: false,
          status: null,
          error: `Webhook DNS resolution failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
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
