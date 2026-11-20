import {
  createProtocolValidator,
  PROTOCOL_NAME,
  SCHEMA_VERSION,
  type IpcMessage,
} from "@lhm/protocol";
import type { TelemetryRepository } from "../repositories/telemetryRepo.ts";
import type { RealtimeHub } from "../websocket/hub.ts";

const SUPPORTED_MAJOR = SCHEMA_VERSION.split(".")[0];

export class IpcProcessor {
  private readonly validator = createProtocolValidator();

  constructor(
    private readonly repo: TelemetryRepository,
    private readonly hub: RealtimeHub,
  ) {}

  processRawJson(rawJson: string): IpcMessage {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      return this.errorMessage("unknown-host", "unknown", 0, "INVALID_JSON", "Malformed JSON payload");
    }

    const check = this.validator.validate("ipc-message", parsed);
    if (!check.valid) {
      const msg = check.errors
        .slice(0, 3)
        .map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`)
        .join("; ");
      return this.errorMessage(
        "unknown-host",
        "unknown",
        0,
        "SCHEMA_VALIDATION_FAILED",
        msg || "IPC message failed JSON Schema validation",
      );
    }

    return this.processMessage(parsed as IpcMessage);
  }

  processMessage(msg: IpcMessage): IpcMessage {
    const major = msg.schema_version.split(".")[0];
    if (msg.message_type === "hello") {
      if (major !== SUPPORTED_MAJOR) {
        return this.buildReply(msg, "hello_ack", {
          accepted: false,
          server_schema_version: SCHEMA_VERSION,
          reason: `Incompatible schema major version: ${msg.schema_version} (server supports ${SUPPORTED_MAJOR}.x)`,
        });
      }
      this.repo.upsertHost(msg.payload.host);
      return this.buildReply(msg, "hello_ack", {
        accepted: true,
        server_schema_version: SCHEMA_VERSION,
        reason: null,
      });
    }

    if (major !== SUPPORTED_MAJOR) {
      return this.errorMessage(
        msg.host_id,
        msg.agent_instance_id,
        msg.sequence,
        "UNSUPPORTED_SCHEMA_VERSION",
        `Unsupported schema version ${msg.schema_version}`,
      );
    }

    // Idempotent deduplication by (agent_instance_id, sequence) (ADR-0003)
    if (
      msg.sequence > 0 &&
      this.repo.isDuplicateSequence(msg.agent_instance_id, msg.sequence)
    ) {
      return this.buildReply(msg, "ack", { acked_sequence: msg.sequence });
    }

    const cursor =
      msg.sequence > 0
        ? { agentInstanceId: msg.agent_instance_id, sequence: msg.sequence }
        : undefined;

    switch (msg.message_type) {
      case "heartbeat": {
        this.repo.touchHostHeartbeat(msg.host_id, msg.payload.uptime_seconds);
        if (cursor) {
          this.repo.advanceCursor(cursor.agentInstanceId, msg.host_id, cursor.sequence);
        }
        return this.buildReply(msg, "ack", { acked_sequence: msg.sequence });
      }
      case "inventory": {
        this.repo.upsertInventory(
          msg.host_id,
          msg.payload.devices,
          msg.payload.sensors,
          cursor,
        );
        for (const dev of msg.payload.devices) {
          this.hub.broadcast(
            "device_status",
            {
              device_id: dev.device_id,
              device_status: dev.device_status,
              name: dev.name,
            },
            { deviceId: dev.device_id },
          );
        }
        return this.buildReply(msg, "ack", { acked_sequence: msg.sequence });
      }
      case "sensor_readings": {
        this.repo.insertReadingsBatch(msg.host_id, msg.payload.readings, cursor);
        for (const r of msg.payload.readings) {
          this.hub.broadcast(
            "reading",
            r as unknown as Record<string, unknown>,
            { deviceId: r.device_id, sensorId: r.sensor_id },
          );
        }
        return this.buildReply(msg, "ack", { acked_sequence: msg.sequence });
      }
      case "smart_report": {
        this.repo.insertSmartReport(msg.payload.report, cursor);
        this.hub.broadcast(
          "device_status",
          {
            device_id: msg.payload.report.device_id,
            device_status: msg.payload.report.device_status,
            smart_passed: msg.payload.report.smart_passed ?? null,
          },
          { deviceId: msg.payload.report.device_id },
        );
        return this.buildReply(msg, "ack", { acked_sequence: msg.sequence });
      }
      case "collector_status": {
        this.repo.upsertCollectorStatuses(msg.host_id, msg.payload.collectors, cursor);
        for (const c of msg.payload.collectors) {
          this.hub.broadcast("collector_status", c as unknown as Record<string, unknown>);
        }
        return this.buildReply(msg, "ack", { acked_sequence: msg.sequence });
      }
      case "diagnostic": {
        this.repo.insertDiagnostic(msg.payload.diagnostic, cursor);
        return this.buildReply(msg, "ack", { acked_sequence: msg.sequence });
      }
      default: {
        return this.errorMessage(
          msg.host_id,
          msg.agent_instance_id,
          msg.sequence,
          "UNEXPECTED_MESSAGE_TYPE",
          `Server does not accept message_type '${msg.message_type}'`,
        );
      }
    }
  }

  private buildReply<T extends IpcMessage["message_type"]>(
    req: IpcMessage,
    type: T,
    payload: Record<string, unknown>,
  ): IpcMessage {
    return {
      protocol: PROTOCOL_NAME,
      schema_version: SCHEMA_VERSION,
      message_id: crypto.randomUUID(),
      message_type: type,
      host_id: req.host_id,
      agent_instance_id: req.agent_instance_id,
      sequence: req.sequence,
      sent_at: new Date().toISOString(),
      payload,
    } as IpcMessage;
  }

  private errorMessage(
    hostId: string,
    agentInstanceId: string,
    sequence: number,
    code: string,
    message: string,
  ): IpcMessage {
    return {
      protocol: PROTOCOL_NAME,
      schema_version: SCHEMA_VERSION,
      message_id: crypto.randomUUID(),
      message_type: "error",
      host_id: hostId,
      agent_instance_id: agentInstanceId,
      sequence,
      sent_at: new Date().toISOString(),
      payload: {
        error_code: code,
        message,
      },
    };
  }
}
