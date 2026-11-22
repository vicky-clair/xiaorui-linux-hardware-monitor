# 项目状态

> 本文件记录当前开发阶段与验收情况。只有项目所有者可以确认阶段验收；AI 代理只能提交验收证据并提出申请。

- **当前阶段**：阶段 6 — 扩展与低开销常驻部署
- **阶段状态**：阶段 6 扩展开发、12 小时超低功耗模式、手动全局健康检测、6 主题/三语控制台、v1.2 扩展 SMART/NVMe/分区容量/CPU 降频/物理网卡采集均已在 L3 常驻部署并实机验证，等待项目所有者验收确认
- **最后更新**：2026-11-22

## 阶段验收记录

| 阶段 | 名称 | 状态 | 验收日期 | 验收证据 |
| ---- | ---- | ---- | -------- | -------- |
| 0 | 基础工程 | 已验收 | 2026-11-20 | L0 全量 CI 通过；L3 Debian 13.6 Rust 原生构建与测试通过；ADR-0001~0007 已批准；Tag `v0.0.0-phase0` |
| 1 | Rust Agent | 已验收 | 2026-11-20 | ADR-0008 已批准；L0 全量 CI 通过；L3 15 项测试与非 root 实机发现/采集验证通过；Tag `v0.1.0-phase1` |
| 2 | Bun API | 已验收 | 2026-11-20 | L0 全量 CI（含 API 5 套件 / 79 断言）+ SQLite 写入基准通过；L3 非 root 容器 + 原生 Rust Agent 真实 Unix Socket 端到端入库与认证查询通过；Tag `v0.2.0-phase2` |
| 3 | React Web | 已验收 | 2026-11-20 | 全部 14 个阶段 3 视图实现完成；L0 全量 CI（Web 5 套件 / 33 断言 + Vite 生产构建）与 L3 非 root 容器验证通过；Tag `v0.3.0-phase3` |
| 4 | Haskell 健康分析与告警 | 已验收 | 2026-11-20 | 共享协议 v1.1（`analyze.schema.json`）三端黄金样例通过；Haskell 10 模块纯计算 + 无状态 HTTP 服务通过单测并与 Bun API 实机联调通过；Bun API 告警生命周期/去重/降级 + Web 告警中心与健康分析页通过 L0/L3 验证；Tag `v0.4.0-phase4` |
| 5 | 生产部署 | 已验收 | 2026-11-20 | ADR-0009 已批准；Docker Compose 非 root 三容器（Haskell/Bun/Nginx）+ 原生 Rust Agent 全链路 L3 实测通过（8 设备/29 传感器/Haskell 分析/容器重建持久性/Agent 重启恢复/SQLite 在线备份恢复演练/可选 HTTPS 模板校验全部通过）；Tag `v0.5.0-phase5` |
| 6 | 扩展 | 待验收 | — | 已完成：12 小时超低功耗模式 + `agent-ctrl.sock` 零轮询手动全局健康检测（`POST /api/v1/system/check`）、6 套深/浅背景主题 + 三语国际化、共享协议 v1.2 + Drizzle 迁移 `0001_smart_extended_telemetry.sql`（扩展 SMART 元数据/自检/三语释义 + NVMe 全字段）、持久化分区容量与使用率、CPU 过热降频计数、物理网卡链路速率/错包采集器、Haskell 鲁棒 MAD/突变异常检测、安全 CSV/JSON 导出、SSRF 防护 Webhook、Tauri 2 脚手架与双磁盘延寿运维指南；已在 L3 `http://192.168.9.165:18080` 常驻运行并通过全链路实机验证 |

阶段定义见 [development/workflow.md](development/workflow.md)。

## ADR 状态

见 [decisions/README.md](decisions/README.md)。ADR-0001 至 ADR-0009 均已 `accepted`；ADR-0010（多主机传输与 IPMI/Redfish 扩展）已起草为 `proposed`（未提前实现依赖代码）。

## 已知风险 / 待办

- L3 实体机（`192.168.9.165:18080`）现已通过非 root `systemd` 托管 `lhm-agent.service`（方案 A，已开机自启，`systemd-analyze security` 分值 `4.7 OK`，cgroup 内存 `1.2 MiB`）与 Docker Compose 三容器（`restart: unless-stopped`）常驻运行，全部设备含 `sda`/`sdb` SMART 原始属性与 Intel RAPL CPU 功耗均已实测入库。
- 7 天连续长期运行稳定性测试需在当前常驻状态下持续观察。
- Tauri 2 桌面客户端（`apps/desktop/`）已完成脚手架配置与服务端 Origin 兼容，实际桌面安装包构建需在具备 WebView2/GTK 桌面工具链的环境执行并实测。
- 多主机传输与 IPMI/Redfish 带外采集保留在 ADR-0010（`proposed`），按需经所有者批准后再实施，当前保持零额外攻击面与零额外性能开销。
