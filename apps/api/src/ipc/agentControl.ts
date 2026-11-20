/**
 * API -> Rust Agent 按需手动检测触发客户端（经同目录 Unix Socket `agent-ctrl.sock` 发送固定指令 `SCAN`）。
 * 严格遵守架构边界：API 绝不直接访问硬件，只通过受控 Unix Socket 唤醒宿主机 Agent 执行一轮采集。
 */
import { existsSync } from "node:fs";

export interface AgentScanResult {
  triggered: boolean;
  reason: string | null;
}

export async function triggerAgentScan(
  ctrlSocketPath: string,
  timeoutMs: number = 15_000,
): Promise<AgentScanResult> {
  if (process.platform === "win32") {
    return { triggered: false, reason: "Unix control socket is only available on Linux/Unix hosts" };
  }
  if (!existsSync(ctrlSocketPath)) {
    return {
      triggered: false,
      reason: `Agent control socket not found at ${ctrlSocketPath}`,
    };
  }

  return new Promise<AgentScanResult>((resolve) => {
    let settled = false;
    let received = "";
    const finish = (res: AgentScanResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };

    const timer = setTimeout(() => {
      finish({ triggered: false, reason: `Agent scan timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    Bun.connect({
      unix: ctrlSocketPath,
      socket: {
        open(socket) {
          socket.write("SCAN\n");
        },
        data(socket, chunk) {
          received += new TextDecoder().decode(chunk);
          if (received.includes("\n")) {
            const line = received.trim();
            socket.end();
            if (line === "OK") {
              finish({ triggered: true, reason: null });
            } else {
              finish({ triggered: false, reason: line || "Agent returned error" });
            }
          }
        },
        close() {
          const line = received.trim();
          if (line === "OK") {
            finish({ triggered: true, reason: null });
          } else {
            finish({
              triggered: false,
              reason: line || "Agent closed control socket without OK",
            });
          }
        },
        error(_socket, err) {
          finish({ triggered: false, reason: err.message });
        },
        connectError(_socket, err) {
          finish({ triggered: false, reason: err.message });
        },
      },
    }).catch((err: unknown) => {
      finish({
        triggered: false,
        reason: err instanceof Error ? err.message : String(err),
      });
    });
  });
}
