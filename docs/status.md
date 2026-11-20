# 项目状态

> 本文件记录当前开发阶段与验收情况。只有项目所有者可以确认阶段验收；AI 代理只能提交验收证据并提出申请。

- **当前阶段**：阶段 0 — 基础工程
- **阶段状态**：开发与自检完成，等待项目所有者验收（ADR-0001 至 ADR-0007 已批准）
- **最后更新**：2026-11-20

## 阶段验收记录

| 阶段 | 名称 | 状态 | 验收日期 | 验收证据 |
| ---- | ---- | ---- | -------- | -------- |
| 0 | 基础工程 | 待验收 | — | L0 全量 CI（TypeScript/Bun/Web/Rust/Haskell）通过；L3 Rust Linux 原生构建与测试验证 |
| 1 | Rust Agent | 未开始 | — | — |
| 2 | Bun API | 未开始 | — | — |
| 3 | React Web | 未开始 | — | — |
| 4 | Haskell 健康分析与告警 | 未开始 | — | — |
| 5 | 生产部署 | 未开始 | — | — |
| 6 | 扩展 | 未开始 | — | — |

阶段定义见 [development/workflow.md](development/workflow.md)。

## ADR 状态

见 [decisions/README.md](decisions/README.md)。阶段 0 必需 ADR（0001–0007）均已为 `accepted`；阶段 1 前需提出并批准 ADR-0008（Rust crate 划分）。

## 已知风险 / 待办

- L3 实体机（`192.168.9.165`）无 NVIDIA/AMD 独显与 NVMe 设备，对应采集器仅能通过模拟环境验证；主机承载其他局域网服务（可用内存约 2.6 GiB），远程操作须严格隔离在 `~/linux-hardware-monitor` 内。
- 等待项目所有者确认阶段 0 验收后，起草 ADR-0008 并进入阶段 1（Rust Agent）。
