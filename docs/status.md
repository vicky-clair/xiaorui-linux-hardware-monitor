# 项目状态

> 本文件记录当前开发阶段与验收情况。只有项目所有者可以确认阶段验收；AI 代理只能提交验收证据并提出申请。

- **当前阶段**：阶段 4 — Haskell 健康分析与告警
- **阶段状态**：进行中（阶段 3 已验收并推送至 GitHub，正在实施阶段 4：Haskell 纯计算引擎与无状态 HTTP 服务、Bun 告警生命周期与分析调度、Web 告警中心与健康评分展示）
- **最后更新**：2026-11-20

## 阶段验收记录

| 阶段 | 名称 | 状态 | 验收日期 | 验收证据 |
| ---- | ---- | ---- | -------- | -------- |
| 0 | 基础工程 | 已验收 | 2026-11-20 | L0 全量 CI 通过；L3 Debian 13.6 Rust 原生构建与测试通过；ADR-0001~0007 已批准；Tag `v0.0.0-phase0` |
| 1 | Rust Agent | 已验收 | 2026-11-20 | ADR-0008 已批准；L0 全量 CI 通过；L3 15 项测试与非 root 实机发现/采集验证通过；Tag `v0.1.0-phase1` |
| 2 | Bun API | 已验收 | 2026-11-20 | L0 全量 CI（含 API 5 套件 / 79 断言）+ SQLite 写入基准通过；L3 非 root 容器 + 原生 Rust Agent 真实 Unix Socket 端到端入库与认证查询通过；Tag `v0.2.0-phase2` |
| 3 | React Web | 已验收 | 2026-11-20 | 全部 14 个阶段 3 视图实现完成；L0 全量 CI（Web 5 套件 / 33 断言 + Vite 生产构建）与 L3 非 root 容器验证通过；Tag `v0.3.0-phase3` |
| 4 | Haskell 健康分析与告警 | 进行中 | — | — |
| 5 | 生产部署 | 未开始 | — | — |
| 6 | 扩展 | 未开始 | — | — |

阶段定义见 [development/workflow.md](development/workflow.md)。

## ADR 状态

见 [decisions/README.md](decisions/README.md)。ADR-0001 至 ADR-0008 均已 `accepted`。

## 已知风险 / 待办

- L3 实体机（`192.168.9.165`）无 NVIDIA/AMD 独显与 NVMe 设备；非 root 下 `intel-rapl` 与 `smartctl` 准确报 `permission_denied`。
- 阶段 4 严格遵守 ADR-0004（Haskell 无状态内部 HTTP JSON 服务）与 ADR-0007（Haskell 纯计算判定 vs Bun 告警生命周期持久化）。
