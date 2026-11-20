# ADR-0004：Bun API ↔ Haskell 健康分析引擎接口

- **状态**：proposed
- **日期**：2026-11-20
- **提出者**：Antigravity
- **批准者**：待项目所有者批准

## 背景

Haskell 健康分析引擎负责规则评估、阈值判断、趋势/异常/关联分析、健康评分与告警状态机，禁止直接访问 SQLite 或宿主机硬件接口。需要明确 Bun 与 Haskell 的通信方式、历史数据喂入方式、状态机持久化归属及故障降级策略。

## 可选方案

### 方案 A（推荐）：常驻无状态本地 HTTP JSON 服务

- **运行形态**：Haskell 引擎作为常驻服务运行（Docker Compose 内网或本地 `127.0.0.1`，不对外暴露公网/局域网端口）。
- **端点**：
  - `GET /health`：返回引擎版本与就绪状态。
  - `POST /v1/analyze`：接收分析批次请求，返回分析结果与告警状态转移。
- **完全无状态设计**：
  - Bun 从 SQLite 读取所需的上下文：最新采样、所需历史窗口（例如最近 15 分钟原始采样 + 最近 24 小时 1 分钟聚合，按规则需求裁剪）、生效的规则与硬件/用户阈值、以及上一次持久化的告警状态机快照 `alert_states`。
  - Haskell 纯函数计算后返回：`analysis_results`（含评分、因素、原因、阈值来源、引擎/规则版本）、`alert_transitions` 与更新后的 `alert_states`。
  - Bun 在单个 SQLite 事务中写回结果与新状态。
- **超时与降级**：
  - 单次请求超时默认 5 秒，无无限重试。
  - 当 Haskell 引擎不可达、超时或返回错误时，Bun 记录错误日志与诊断事件，继续正常接收和存储采集数据，但对外将健康分析状态标记为 `unknown`（并附 `engine_unavailable`），**绝不展示为健康**。

优点：避免频繁启动 Haskell RTS 的 CPU/内存开销（适配 N5095A 低功耗主机）；无状态设计使引擎重启零数据丢失；在 Windows L0 与 Linux Docker 中通信方式完全一致，易于联调和单测。
缺点：常驻进程会占用少量固定内存（需在阶段 4/5 实测控制）。

### 方案 B：Bun 每次按需 `spawn` Haskell CLI（stdin/stdout JSON）

优点：空闲时内存为 0。
缺点：高频分析时反复启动进程开销大；容器化部署时 Bun 容器无法直接 `spawn` 另一容器内的二进制文件，破坏容器隔离。

## 决定

采用 **方案 A（常驻无状态内部 HTTP JSON 服务）**。

## 影响

- 受影响的模块与文件：`packages/protocol/`、`core/health-engine/`、`apps/api/`、`deploy/docker/`、`docs/architecture/health-engine.md`。
- 协议 / 数据库 / 部署是否变更：是（在协议中新增 `AnalyzeRequest` / `AnalyzeResponse` Schema；数据库中持久化 `alert_states`）。
- 需要更新的文档：`docs/architecture/health-engine.md`、`docs/database/schema.md`。

## 验证方式

- 阶段 0：Haskell 工程独立构建，能反序列化并校验共享协议 fixtures。
- 阶段 4：L0 与 L3 上验证完整分析往返、引擎重启无状态丢失、超时降级为 `unknown`。
