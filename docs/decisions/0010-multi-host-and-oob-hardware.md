# ADR-0010：多主机远程采集传输与带外硬件（IPMI / Redfish）扩展架构

- **状态**：proposed（阶段 6 规划草案，仅在项目所有者批准后实施多主机传输与带外采集代码）
- **日期**：2026-11-20
- **提出者**：Antigravity
- **批准者**：待项目所有者决定

## 背景

当前 v1 系统采用单机原生 Rust Agent 经宿主机 Unix Domain Socket 向 Bun API 上报数据（ADR-0003），数据模型与 SQLite 表已预留 `host_id` 字段。未来若需监控局域网内多台 Debian 主机或带 BMC 的服务器（IPMI / Redfish），需确定远程 Agent 安全传输协议与带外采集边界。

## 可选方案

### 方案 A（推荐）：单向推模式（HTTPS + 每主机独立 Bearer Token / mTLS）+ 独立可选 OOB 采集器

- **多主机传输**：
  - 远端主机上的 `lhm-agent` 复用现有共享 JSON 协议（`packages/protocol`）与 `(agent_instance_id, sequence)` 去重机制，通过 `POST /api/v1/ingest` 批量上报（仅允许 TLS/HTTPS 或 WireGuard/Tailscale 加密内网链路）。
  - 每台主机由管理员在控制台签发独立注册令牌（数据库仅存 SHA-256 哈希，支持一键吊销），禁止复用用户会话 Cookie。
- **IPMI / Redfish 带外硬件采集**：
  - IPMI（本地 `/dev/ipmi0` 或 `ipmitool` 白名单只读 SDR 查询）与 Redfish（只读 `GET /redfish/v1/Chassis/*/Thermal` & `Power`）作为可选采集器插件，默认禁用；不开启时不产生任何额外进程、网络或设备权限需求。
  - 所有带外凭据仅保存在敏感配置表（`is_sensitive = 1`），绝不下发前端或写入日志。

优点：复用全部既有协议与去重/缓冲逻辑；对现有单机零额外资源开销。
缺点：多主机场景需规划 SQLite 写入并发上限（预计 10 台以内单机 SQLite WAL 可稳定承载，超大规模再评估时序库）。

### 方案 B：服务端主动 SSH / 拉模式轮询远端主机

优点：远端主机无需常驻 Agent。
缺点：服务端容器需持有远端主机 SSH 密钥与登录权限，违背最小权限与容器零宿主机特权红线。

## 决定

提议采用 **方案 A**。本 ADR 在 `proposed` 状态下**不实现任何多主机传输或 IPMI/Redfish 采集代码**，保持当前单机局域网部署零额外攻击面与零额外性能开销。

## 影响

- 受影响的模块与文件（批准后）：`packages/protocol/`、`agents/linux-agent/`、`apps/api/`、`apps/web/`。
- 当前阶段影响：仅文档登记，不改变现有协议、数据库与运行态。

## 验证方式

- 若未来批准实施：在两台真实 Debian 13 主机间验证令牌鉴权、断网缓存补发与去重，并测试无 IPMI/Redfish 硬件主机正确上报 `unsupported` 而非报错。
