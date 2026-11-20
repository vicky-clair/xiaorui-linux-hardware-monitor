# 项目状态

> 本文件记录当前开发阶段与验收情况。只有项目所有者可以确认阶段验收；AI 代理只能提交验收证据并提出申请。

- **当前阶段**：阶段 4 — Haskell 健康分析与告警
- **阶段状态**：开发与自检完成，等待项目所有者验收（L0 全量 CI + 真实编译版 Haskell HTTP 服务 ↔ Bun API 端到端联调 + L3 Rust/Bun/Web 复验均已通过）
- **最后更新**：2026-11-20

## 阶段验收记录

| 阶段 | 名称 | 状态 | 验收日期 | 验收证据 |
| ---- | ---- | ---- | -------- | -------- |
| 0 | 基础工程 | 已验收 | 2026-11-20 | L0 全量 CI 通过；L3 Debian 13.6 Rust 原生构建与测试通过；ADR-0001~0007 已批准；Tag `v0.0.0-phase0` |
| 1 | Rust Agent | 已验收 | 2026-11-20 | ADR-0008 已批准；L0 全量 CI 通过；L3 15 项测试与非 root 实机发现/采集验证通过；Tag `v0.1.0-phase1` |
| 2 | Bun API | 已验收 | 2026-11-20 | L0 全量 CI（含 API 5 套件 / 79 断言）+ SQLite 写入基准通过；L3 非 root 容器 + 原生 Rust Agent 真实 Unix Socket 端到端入库与认证查询通过；Tag `v0.2.0-phase2` |
| 3 | React Web | 已验收 | 2026-11-20 | 全部 14 个阶段 3 视图实现完成；L0 全量 CI（Web 5 套件 / 33 断言 + Vite 生产构建）与 L3 非 root 容器验证通过；Tag `v0.3.0-phase3` |
| 4 | Haskell 健康分析与告警 | 待验收 | — | 共享协议 v1.1（`analyze.schema.json`）三端黄金样例通过；Haskell 10 模块纯计算 + 无状态 HTTP 服务通过单测并与 Bun API 实机联调通过；Bun API 告警生命周期/去重/降级 + Web 告警中心与健康分析页通过 L0/L3 验证 |
| 5 | 生产部署 | 未开始 | — | 阶段 5 前需提出并批准 ADR-0009（局域网 HTTPS 证书方案） |
| 6 | 扩展 | 未开始 | — | — |

阶段定义见 [development/workflow.md](development/workflow.md)。

## ADR 状态

见 [decisions/README.md](decisions/README.md)。ADR-0001 至 ADR-0008 均已 `accepted`；进入阶段 5 前需起草并批准 ADR-0009（局域网 HTTPS 证书）。

## 已知风险 / 待办

- L3 实体机（`192.168.9.165`）未原生安装 GHC/Cabal，Haskell 引擎在 Linux 侧的镜像构建与容器化运行将在阶段 5 Docker Compose 中验证。
- 等待项目所有者确认阶段 4 验收后，起草 ADR-0009 并进入阶段 5（生产部署：systemd、Docker Compose、Nginx、HTTPS、备份与恢复演练）。
