/**
 * API 侧 Unix Domain Socket IPC 监听服务端（ADR-0003：API 监听，Agent 主动连接）。
 * 使用 4 字节大端长度前缀分帧解码，经 JSON Schema 校验与去重游标处理后返回逐帧 ACK。
 */
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { encodeFrame, FrameDecoder, FrameError } from "@lhm/protocol";
import type { IpcProcessor } from "./processor.ts";

export class IpcStreamSession {
  private readonly decoder = new FrameDecoder();

  constructor(private readonly processor: IpcProcessor) {}

  /**
   * Feeds raw socket bytes, returns framed reply buffers to write back.
   * Throws FrameError on framing violations (oversized > 1 MiB, empty, invalid UTF-8).
   */
  onChunk(chunk: Uint8Array): Uint8Array[] {
    const frames = this.decoder.push(chunk);
    const replies: Uint8Array[] = [];
    for (const raw of frames) {
      const replyMsg = this.processor.processRawJson(raw);
      replies.push(encodeFrame(replyMsg));
    }
    return replies;
  }
}

export interface UnixIpcServerHandle {
  socketPath: string;
  stop: () => void;
}

/**
 * Starts the Unix Domain Socket IPC server (ADR-0003: API listens, Agent connects).
 * Only active on Unix/Linux platforms.
 */
export function startUnixIpcServer(
  socketPath: string,
  processor: IpcProcessor,
  mode: number = 0o660,
): UnixIpcServerHandle {
  mkdirSync(dirname(socketPath), { recursive: true });
  try {
    rmSync(socketPath, { force: true });
  } catch {
    // ignore stale socket cleanup failure
  }

  const sessions = new WeakMap<object, IpcStreamSession>();

  const listener = Bun.listen({
    unix: socketPath,
    socket: {
      open(socket) {
        sessions.set(socket, new IpcStreamSession(processor));
      },
      data(socket, data) {
        const session = sessions.get(socket);
        if (!session) return;
        try {
          const replies = session.onChunk(
            data instanceof Uint8Array ? data : new Uint8Array(data),
          );
          for (const frame of replies) {
            socket.write(frame);
          }
        } catch (err) {
          if (err instanceof FrameError) {
            console.warn(
              JSON.stringify({
                timestamp: new Date().toISOString(),
                component: "lhm-api-ipc",
                level: "WARN",
                error_code: err.code,
                message: err.message,
              }),
            );
          }
          socket.end();
        }
      },
      close(socket) {
        sessions.delete(socket);
      },
      error(socket, err) {
        console.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            component: "lhm-api-ipc",
            level: "ERROR",
            message: err.message,
          }),
        );
        sessions.delete(socket);
      },
    },
  });

  try {
    chmodSync(socketPath, mode);
  } catch {
    // chmod may not apply on non-POSIX filesystems
  }

  return {
    socketPath,
    stop: () => {
      listener.stop(true);
      try {
        rmSync(socketPath, { force: true });
      } catch {
        // ignore
      }
    },
  };
}
