// WebSocket 实时数据流 Hook：自动维护断线重连状态与按 sensor_id 索引的最新传感器读数缓存。
import { useEffect, useState } from "react";
import type { SensorReading } from "@lhm/protocol/types";

export type WsConnectionState = "connecting" | "connected" | "disconnected";

export interface LiveTelemetryState {
  connectionState: WsConnectionState;
  latestBySensor: Record<string, SensorReading>;
  lastMessageAt: string | null;
}

export function buildWsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost/api/v1/stream";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/v1/stream`;
}

/**
 * Maintains an authenticated incremental WebSocket stream to `/api/v1/stream`.
 * Never polls full historical datasets; exposes explicit disconnected state.
 */
export function useRealtimeStream(enabled: boolean): LiveTelemetryState {
  const [connectionState, setConnectionState] =
    useState<WsConnectionState>("disconnected");
  const [latestBySensor, setLatestBySensor] = useState<
    Record<string, SensorReading>
  >({});
  const [lastMessageAt, setLastMessageAt] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || typeof WebSocket === "undefined") {
      setConnectionState("disconnected");
      return;
    }

    let closed = false;
    let attempt = 0;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      setConnectionState("connecting");
      ws = new WebSocket(buildWsUrl());

      ws.addEventListener("open", () => {
        attempt = 0;
        setConnectionState("connected");
        ws?.send(
          JSON.stringify({
            action: "subscribe",
            topics: ["reading", "device_status", "collector_status", "ping"],
          }),
        );
      });

      ws.addEventListener("message", (ev) => {
        try {
          const parsed = JSON.parse(String(ev.data)) as {
            type: string;
            data: unknown;
            timestamp: string;
          };
          setLastMessageAt(parsed.timestamp);
          if (parsed.type === "reading" && parsed.data) {
            const reading = parsed.data as SensorReading;
            setLatestBySensor((prev) => ({
              ...prev,
              [reading.sensor_id]: reading,
            }));
          }
        } catch {
          // ignore malformed event
        }
      });

      ws.addEventListener("close", () => {
        if (closed) return;
        setConnectionState("disconnected");
        attempt += 1;
        const delayMs = Math.min(1000 * 2 ** Math.min(attempt - 1, 4), 15_000);
        timer = setTimeout(connect, delayMs);
      });

      ws.addEventListener("error", () => {
        ws?.close();
      });
    };

    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, [enabled]);

  return { connectionState, latestBySensor, lastMessageAt };
}
