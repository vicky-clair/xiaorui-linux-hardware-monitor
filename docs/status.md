# 项目状态

> 本文件记录当前开发阶段与验收情况。只有项目所有者可以确认阶段验收；AI 代理只能提交验收证据并提出申请。

- **当前阶段**：阶段 2 — Bun API
- **阶段状态**：进行中（阶段 1 已验收并推送至 GitHub，正在实施阶段 2：SQLite + Drizzle Migration + IPC 服务端 + 认证 + REST API + WebSocket）
- **最后更新**：2026-11-20

## 阶段验收记录

| 阶段 | 名称 | 状态 | 验收日期 | 验收证据 |
| ---- | ---- | ---- | -------- | -------- |
| 0 | 基础工程 | 已验收 | 2026-11-20 | L0 全量 CI 通过；L3 Debian 13.6 Rust 原生构建与测试通过；ADR-0001~0007 已批准；Tag `v0.0.0-phase0` |
| 1 | Rust Agent | 已验收 | 2026-11-20 | ADR-0008 已批准；L0 全量 CI（14 项 Rust 单测/模拟测试）通过；L3 Debian 13.6 15 项测试（含真实 Unix Socket）与非 root 实机发现/采集验证通过；Tag `v0.1.0-phase1` |
| 2 | Bun API | 进行中 | — | — |
| 3 | React Web | 未开始 | — | — |
| 4 | Haskell 健康分析与告警 | 未开始 | — | — |
| 5 | 生产部署 | 未开始 | — | — |
| 6 | 扩展 | 未开始 | — | — |

阶段定义见 [development/workflow.md](development/workflow.md)。

## ADR 状态

见 [decisions/README.md](decisions/README.md)。ADR-0001 至 ADR-0008 均已 `accepted`。

## 已知风险 / 待办

- L3 实体机（`192.168.9.165`）无 NVIDIA/AMD 独显与 NVMe 设备，对应采集器仅在模拟测试中验证；非 root 下 `intel-rapl` 与 `smartctl` 准确报 `permission_denied`。
- 阶段 2 需完成 Bun API 全部核心端点、SQLite WAL + Drizzle Migration、IPC 接收与去重、Argon2id 认证与 WebSocket 增量推送，并实测写入性能与数据持久化。
