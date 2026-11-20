# ADR-0003：Agent ↔ API IPC 通信协议

- **状态**：proposed
- **日期**：2026-11-20
- **提出者**：Antigravity
- **批准者**：待项目所有者批准

## 背景

Rust Agent 原生运行于宿主机，Bun API 运行于 Docker 容器（或本地进程），二者通过受控 Unix Domain Socket 通信。需要明确连接方向、分帧方式、握手与心跳、API 不可用时的缓冲与重放策略以及消息去重机制。

## 可选方案

### 连接方向

- **方案 A（推荐）：Bun API 监听（Server），Rust Agent 连接（Client）**
  - 生产默认路径：`/run/linux-hardware-monitor/ipc.sock`（通过环境变量/配置可覆盖，便于非 root 开发测试使用 `~/linux-hardware-monitor/run/ipc.sock`）。
  - Docker 部署时将宿主机目录 `/run/linux-hardware-monitor/` 挂载进 API 容器（挂载目录而非单个 socket 文件，避免重建 inode 失效）。
  - 优点：符合数据流（生产者连向消费者）；Agent 重启自动重连，无需 API 轮询；天然兼容未来多客户端连接。
- **方案 B：Rust Agent 监听，Bun API 连接**
  - 缺点：API 需要反向感知 Agent 地址与重启状态，扩展性差。

### 消息分帧

- **方案 A（推荐）：4 字节大端无符号长度前缀（`u32` BE）+ UTF-8 JSON 负载**
  - 单条消息最大长度限制：**1 MiB（1,048,576 字节）**；收到超过上限的帧头立即拒绝并断开连接，记录诊断。
  - 优点：边界绝对明确，无转义与半包歧义；读取前即可校验长度上限防止内存耗尽。
- **方案 B：JSON Lines（`\n` 分帧）**
  - 缺点：需逐字节扫描换行并防止超长无换行恶意输入，流式解析细节更多。

### 握手、心跳、缓冲与去重

1. **握手**：连接建立后 Agent 首帧必发 `hello`（含 `protocol: "lhm-ipc"`、`schema_version`、`host_id`、`agent_instance_id`）；API 校验主版本兼容后回复 `hello_ack`，不兼容则返回 `error` 并断开。
2. **心跳与断线**：Agent 每 10 秒发 `heartbeat`；API 超过 30 秒无有效帧判定断线；Agent 断线后采用指数退避重连（初始 1 秒，上限 30 秒，带随机抖动）。
3. **确认与去重**：
   - Agent 每次进程启动生成唯一 `agent_instance_id`（UUID v4 / ULID），消息 `sequence` 从 `1` 单调递增。
   - API 持久化成功后返回 `ack`（携带 `sequence`），并在 `ipc_cursors` 表记录 `(agent_instance_id, last_sequence)`；重复收到的 `sequence <= last_sequence` 直接幂等回复 `ack` 而不重复入库。
4. **API 不可用时的有界缓冲**：
   - Agent 维护有界内存队列（默认上限：10,000 条 `sensor_readings` 或 32 MiB，可配置）。
   - 队列满时按 FIFO 淘汰最旧的 `sensor_readings`，优先保留 `inventory`、`smart_report`、`collector_status`、`diagnostic`。
   - 发生丢弃时，重连后发送一条 `diagnostic` 明确上报丢弃计数与时间段，保证数据缺口可观测。

## 决定

采用 **API 监听 + Agent 连接 + 4 字节大端长度前缀 JSON + 握手/ACK/有界内存缓冲 + `(agent_instance_id, sequence)` 去重**。

## 影响

- 受影响的模块与文件：`packages/protocol/`、`agents/linux-agent/`、`apps/api/src/ipc/`、`docs/protocol/data-model.md`、`docs/architecture/overview.md`。
- 协议 / 数据库 / 部署是否变更：是（新增 `hello_ack`、`ack` 消息类型，明确 `ipc_cursors` 表及 socket 目录挂载方式）。
- 需要更新的文档：`docs/protocol/data-model.md`。

## 验证方式

- 阶段 0：跨语言编解码与分帧单元测试（含粘包、半包、超长帧拒绝、重启新 `agent_instance_id`）。
- 阶段 1/2：L3 主机上 Rust Agent 与 Bun API 通过真实 Unix Socket 联调，验证 API 重启后的重连、补发与去重。
