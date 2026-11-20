# 项目状态

> 本文件记录当前开发阶段与验收情况。只有项目所有者可以确认阶段验收；AI 代理只能提交验收证据并提出申请。

- **当前阶段**：阶段 1 — Rust Agent
- **阶段状态**：进行中（阶段 0 已验收；ADR-0008 已起草为 `proposed`，待项目所有者审批）
- **最后更新**：2026-11-20

## 阶段验收记录

| 阶段 | 名称 | 状态 | 验收日期 | 验收证据 |
| ---- | ---- | ---- | -------- | -------- |
| 0 | 基础工程 | 已验收 | 2026-11-20 | L0 全量 CI 通过；L3 Debian 13.6 Rust 原生构建与测试通过；ADR-0001~0007 已批准；Tag `v0.0.0-phase0` |
| 1 | Rust Agent | 进行中 | — | ADR-0008 待审批 |
| 2 | Bun API | 未开始 | — | — |
| 3 | React Web | 未开始 | — | — |
| 4 | Haskell 健康分析与告警 | 未开始 | — | — |
| 5 | 生产部署 | 未开始 | — | — |
| 6 | 扩展 | 未开始 | — | — |

阶段定义见 [development/workflow.md](development/workflow.md)。

## ADR 状态

见 [decisions/README.md](decisions/README.md)。ADR-0001 至 ADR-0007 已 `accepted`；ADR-0008（Rust crate 划分与 Collector 接口）当前为 `proposed`，待审批。

## 已知风险 / 待办

- L3 实体机（`192.168.9.165`）无 NVIDIA/AMD 独显与 NVMe 设备，对应采集器仅能通过模拟环境验证；主机承载其他局域网服务（可用内存约 2.6 GiB），远程操作须严格隔离在 `~/linux-hardware-monitor` 内。
- 批准 ADR-0008 后实施阶段 1 Rust Agent 核心框架、全套采集器、模拟 sysfs 夹具及 L3 实机验证。
