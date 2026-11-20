export type StreamEventType =
  | "reading"
  | "device_status"
  | "collector_status"
  | "alert"
  | "ping";

export interface StreamEvent {
  type: StreamEventType;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface StreamClient {
  id: string;
  send: (payload: string) => void;
  topics: Set<string>;
  deviceIds: Set<string>;
  sensorIds: Set<string>;
}

export class RealtimeHub {
  private readonly clients = new Map<string, StreamClient>();

  register(id: string, send: (payload: string) => void): StreamClient {
    const client: StreamClient = {
      id,
      send,
      topics: new Set(["reading", "device_status", "collector_status", "ping"]),
      deviceIds: new Set(),
      sensorIds: new Set(),
    };
    this.clients.set(id, client);
    return client;
  }

  unregister(id: string): void {
    this.clients.delete(id);
  }

  updateSubscription(
    id: string,
    msg: {
      action?: "subscribe" | "unsubscribe";
      topics?: string[];
      device_ids?: string[];
      sensor_ids?: string[];
    },
  ): void {
    const client = this.clients.get(id);
    if (!client) return;

    if (msg.action === "unsubscribe") {
      msg.topics?.forEach((t) => client.topics.delete(t));
      msg.device_ids?.forEach((d) => client.deviceIds.delete(d));
      msg.sensor_ids?.forEach((s) => client.sensorIds.delete(s));
      return;
    }

    if (msg.topics) {
      client.topics = new Set(msg.topics);
    }
    if (msg.device_ids) {
      client.deviceIds = new Set(msg.device_ids);
    }
    if (msg.sensor_ids) {
      client.sensorIds = new Set(msg.sensor_ids);
    }
  }

  broadcast(
    type: StreamEventType,
    data: Record<string, unknown>,
    filter?: { deviceId?: string; sensorId?: string },
  ): number {
    const event: StreamEvent = {
      type,
      data,
      timestamp: new Date().toISOString(),
    };
    const serialized = JSON.stringify(event);
    let sent = 0;

    for (const client of this.clients.values()) {
      if (!client.topics.has(type)) continue;
      if (
        filter?.deviceId &&
        client.deviceIds.size > 0 &&
        !client.deviceIds.has(filter.deviceId)
      ) {
        continue;
      }
      if (
        filter?.sensorId &&
        client.sensorIds.size > 0 &&
        !client.sensorIds.has(filter.sensorId)
      ) {
        continue;
      }
      try {
        client.send(serialized);
        sent += 1;
      } catch {
        this.clients.delete(client.id);
      }
    }
    return sent;
  }

  clientCount(): number {
    return this.clients.size;
  }
}
