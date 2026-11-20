# 项目状态

> 本文件记录当前开发阶段与验收情况。只有项目所有者可以确认阶段验收；AI 代理只能提交验收证据并提出申请。

- **当前阶段**：阶段 1 — Rust Agent
- **阶段状态**：开发与自检完成，等待项目所有者验收（ADR-0008 已批准，L0 模拟测试与 L3 实体机非 root 验证均已通过）
- **最后更新**：2026-11-20

## 阶段验收记录

| 阶段 | 名称 | 状态 | 验收日期 | 验收证据 |
| ---- | ---- | ---- | -------- | -------- |
| 0 | 基础工程 | 已验收 | 2026-11-20 | L0 全量 CI 通过；L3 Debian 13.6 Rust 原生构建与测试通过；ADR-0001~0007 已批准；Tag `v0.0.0-phase0` |
| 1 | Rust Agent | 待验收 | — | ADR-0008 已批准；L0 全量 CI（含 14 项 Rust 模拟/单测）通过；L3 Debian 13.6 15 项测试（含真实 Unix Socket 测试）与非 root `lhm-agent --once` 实机验证通过 |
| 2 | Bun API | 未开始 | — | — |
| 3 | React Web | 未开始 | — | — |
| 4 | Haskell 健康分析与告警 | 未开始 | — | — |
| 5 | 生产部署 | 未开始 | — | — |
| 6 | 扩展 | 未开始 | — | — |

阶段定义见 [development/workflow.md](development/workflow.md)。

## ADR 状态

见 [decisions/README.md](decisions/README.md)。ADR-0001 至 ADR-0008 均已 `accepted`。

## 已知风险 / 待办

- L3 实体机（`192.168.9.165`）无 NVIDIA/AMD 独显与 NVMe 设备，对应采集器仅在模拟测试中验证；在 L3 上 NVMe 采集器正确报告 `unsupported`。
- L3 实体机非 root 运行下，`intel-rapl` 与 `smartctl` 均准确报告 `permission_denied` 并给出结构化修复建议，无任何伪造或硬件故障误报。
- 等待项目所有者确认阶段 1 验收后，进入阶段 2（Bun API + SQLite + Drizzle Migration + IPC 服务端 + 认证）。
