# ADR-0009：局域网部署网络拓扑与可选 HTTPS 方案

- **状态**：proposed（已按项目所有者 2026-11-20 明确指示起草与落地配置，待阶段 5 验收时正式定稿为 `accepted`）
- **日期**：2026-11-20
- **提出者**：Antigravity
- **批准者**：待项目所有者正式签字确认（方向已于 2026-11-20 明确）

## 背景

阶段 5（生产部署）需要确定 Debian 13 实体机上的容器网络拓扑、端口暴露方式以及局域网 HTTPS 反向代理策略。同时需满足以下约束：

1. 目标 Debian 13.6 主机（`192.168.9.165`）在局域网内运行多个已有服务，`80`、`443`、`8080`、`9000` 等端口已被占用；部署方案不得修改宿主机既有 `/etc/nginx`、systemd 单元或其他容器。
2. `AGENTS.md §2 / §3` 要求 Web/API 采用 Docker Compose + Nginx 非 root 容器部署，API 不直接裸露宿主机端口，禁用 `privileged: true` 与 `network_mode: host`。
3. 项目所有者于 2026-11-20 明确提出：**将 Nginx HTTPS 反向代理配置作为可选功能准备完整，但当前仅在局域网内使用，不需要默认启用 HTTPS 或外部复杂代理配置**。
4. 阶段 6（Tauri 2 桌面客户端）的 WebSocket/API `Origin` 需提前兼容。

## 可选方案

### 方案 A（推荐）：局域网默认直连 HTTP（高位端口单入口容器）+ 准备就绪的可选 HTTPS 覆写配置

- **默认局域网模式（开箱即用）**：
  - `deploy/docker/docker-compose.yml` 在独立内部桥接网络 `lhm_net` 中运行三个非 root 容器：
    - `health-engine`（Haskell 无状态引擎，仅内部 `8090`，不暴露宿主机端口）
    - `api`（Bun + Elysia，仅内部 `3000`，不暴露宿主机端口；挂载宿主机 Unix Socket **目录** `${LHM_IPC_DIR}` 与本地 SQLite 数据卷）
    - `web`（非 root `nginxinc/nginx-unprivileged`，提供 React 静态构建产物，并内部转发 `/api/` 与 WebSocket `/api/v1/stream` 至 `api:3000`），仅暴露一个可配置高位宿主机端口 `${LHM_WEB_PORT:-18080}:8080`。
  - 默认 `LHM_COOKIE_SECURE=false`（局域网纯 HTTP 浏览器可保存 `HttpOnly; SameSite=Lax` 会话 Cookie），通过 `LHM_ALLOWED_ORIGINS` 显式允许局域网访问源（如 `http://192.168.9.165:18080`）、本机调试源及阶段 6 Tauri 源（`tauri://localhost,http://tauri.localhost`）。
- **可选 HTTPS 模式（准备就绪，默认不启用）**：
  - 仓库提供 `deploy/nginx/https.conf.template`、`deploy/docker/docker-compose.https.yml` 与自签名 SAN 证书生成脚本 `deploy/scripts/gen-self-signed-cert.sh`。
  - 当未来需要启用 HTTPS 时，无需改动业务代码，仅生成证书并附加 `-f deploy/docker/docker-compose.https.yml` 启动即可（同时将 `LHM_COOKIE_SECURE=true`，暴露 `${LHM_HTTPS_PORT:-18443}:8443`）。

优点：零冲突、零外部代理负担、完全满足当前局域网即开即用需求，同时随时可一键升级为 HTTPS。
缺点：默认局域网 HTTP 模式下会话流量在局域网内明文传输（仅限受信任私有局域网，严禁直接映射到公网）。

### 方案 B：强制默认启用自签名 HTTPS（或 mkcert / 私有 CA）

优点：局域网内即启用 TLS 加密与 `Secure` Cookie。
缺点：与项目所有者“当前局域网内使用，不需要配置 HTTPS/复杂代理”的明确要求冲突，且每台客户端浏览器需手工信任自签名 CA 证书。

## 决定

采用 **方案 A**：

1. 默认部署使用 `deploy/docker/docker-compose.yml` + `deploy/nginx/default.conf`，以单个高位端口（默认 `18080`）提供局域网直连 HTTP 访问，不触碰宿主机已有 80/443 或系统级 Nginx。
2. 完整准备可选 HTTPS 模板（`deploy/nginx/https.conf.template`）、Compose 覆写文件（`deploy/docker/docker-compose.https.yml`）与证书生成脚本（`deploy/scripts/gen-self-signed-cert.sh`），默认不启用。
3. 明确安全边界：HTTP 模式**仅限受信任局域网使用**；若未来暴露至非受信任网络，必须启用 HTTPS 模式与 `LHM_COOKIE_SECURE=true`。

## 影响

- 受影响的模块与文件：`deploy/docker/`、`deploy/nginx/`、`deploy/scripts/`、`docs/security/security.md`、`docs/deployment/deployment.md`。
- 协议 / 数据库 / 部署是否变更：不修改共享协议与数据库表结构；确立阶段 5 生产部署与可选 HTTPS 启用方式。
- 需要更新的文档：`docs/decisions/README.md`、`docs/architecture/versions.md`、`docs/security/security.md`、`docs/deployment/deployment.md`。

## 验证方式

1. L3 Debian 13.6 上启动隔离测试栈（`COMPOSE_PROJECT_NAME=lhm-test`），验证 3 个非 root 容器全部 `healthy` 且不影响宿主机已有服务与端口。
2. 验证原生 `lhm-agent` → Unix Socket → `api` → SQLite → `health-engine` → `web`（`http://192.168.9.165:18080`）端到端读写、认证与 WebSocket 推送。
3. 静态语法校验可选 HTTPS 模板与 `gen-self-signed-cert.sh`（不改变默认 HTTP 运行模式）。
