# 生产部署与运维手册（Debian 13）

> 对应阶段 5（生产部署）与 [ADR-0006](../decisions/0006-agent-permission-model.md)、[ADR-0009](../decisions/0009-lan-deployment-and-https.md)。

## 1. 部署拓扑（局域网默认直连 HTTP）

```
Debian 13 宿主机（原生 Rust Agent）
    │  Unix Domain Socket（目录挂载，0750 / 0660）
    ▼
Docker Compose（独立桥接网络 lhm_net，全非 root 容器）
  ├── health-engine (Haskell，仅内部 8090，无宿主机端口)
  ├── api           (Bun + Elysia + SQLite 本地卷，仅内部 3000，无宿主机端口)
  └── web           (nginx-unprivileged，暴露单端口 ${LHM_WEB_PORT:-18080}:8080)
```

安全与隔离基线：
- **零侵入宿主机**：不触碰宿主机 `80`/`443`/`8080`/`9000` 端口、不修改宿主机 `/etc/nginx`、不影响已有容器。
- **全非 root 容器**：禁用 `privileged: true`、`network_mode: host`、Docker socket 挂载与宿主机根目录挂载。
- **Unix Socket 目录挂载**：仅挂载目录（`${LHM_IPC_DIR}` → `/run/linux-hardware-monitor`），禁止直接挂载单个 `.sock` 文件。

## 2. 快速启动（局域网 HTTP 默认模式）

1. 准备环境变量文件（禁止提交 `.env` 到 Git）：

```bash
cp deploy/docker/.env.example deploy/docker/.env
# 按需修改 LHM_WEB_PORT（默认 18080）、LHM_UID/LHM_GID、LHM_ALLOWED_ORIGINS
```

2. 创建宿主机 IPC 目录并构建启动三容器：

```bash
mkdir -p run
docker compose --env-file deploy/docker/.env -f deploy/docker/docker-compose.yml up -d --build
docker compose --env-file deploy/docker/.env -f deploy/docker/docker-compose.yml ps
```

3. 启动原生 Rust Agent：
   - **零特权本地运行（无需 sudo）**：
     ```bash
     CARGO_BUILD_JOBS=2 cargo build --release -p lhm-agent
     bash deploy/scripts/run-agent-local.sh --interval 5
     ```
   - **生产 systemd 常驻服务（需管理员手动 sudo）**：详见 [deploy/systemd/README.md](../../deploy/systemd/README.md)。

4. 获取首次启动的一次性管理员初始化令牌并创建管理员账号：

```bash
docker compose --env-file deploy/docker/.env -f deploy/docker/docker-compose.yml logs api | grep bootstrap_token
```

随后在局域网浏览器访问 `http://<主机局域网IP>:18080` 完成初始化登录。

## 3. 可选 HTTPS 反向代理模式（已准备就绪，默认不启用）

按 ADR-0009，当前局域网默认直连 HTTP，**无需启用**以下配置。若未来需要 TLS 加密访问：

```bash
# 1. 生成含局域网 IP SAN 的自签名证书（仅生成一次，不提交到 Git）
bash deploy/scripts/gen-self-signed-cert.sh 192.168.9.165 deploy/docker/certs

# 2. 更新 deploy/docker/.env 中的 LHM_ALLOWED_ORIGINS，加入 https://192.168.9.165:18443
# 3. 叠加 HTTPS 覆写文件启动（自动开启 LHM_COOKIE_SECURE=true 与 18443 HTTPS 监听）
docker compose --env-file deploy/docker/.env \
  -f deploy/docker/docker-compose.yml \
  -f deploy/docker/docker-compose.https.yml up -d
```

## 4. SQLite 在线备份与恢复演练

严禁直接 `cp` 正在写入的 WAL SQLite 数据库文件；统一使用 `VACUUM INTO` 在线快照机制：

### 4.1 在线备份

```bash
# 对运行中的 api 容器执行在线备份（输出至 ./backups/lhm-<UTC>.sqlite 与 .sha256）
LHM_DOCKER_CONTAINER=lhm-api bash deploy/scripts/backup-sqlite.sh /data/lhm.sqlite ./backups 14
```

### 4.2 恢复演练（不破坏当前运行库）

```bash
bash deploy/scripts/restore-sqlite.sh ./backups/lhm-<UTC>.sqlite /tmp/lhm-restore-drill.sqlite
```

### 4.3 生产库恢复（须先停止 API 并备份现有库）

```bash
docker compose --env-file deploy/docker/.env -f deploy/docker/docker-compose.yml stop api
bash deploy/scripts/restore-sqlite.sh ./backups/lhm-<UTC>.sqlite /path/to/lhm.sqlite --force-overwrite
docker compose --env-file deploy/docker/.env -f deploy/docker/docker-compose.yml start api
```

## 5. 长期运行验收建议

阶段 5 的 7 天连续运行稳定性测试（目标见 [workflow.md](../development/workflow.md) §6）需在实际部署后持续观察：
- Agent 内存（目标 `< 150 MB`）与 CPU（目标 `< 2%`）
- 容器 `docker stats` 内存趋势（无持续增长泄漏）
- SQLite WAL 体积、小时/分钟聚合与自动保留清理日志
- 模拟 Agent 重启与容器重建后的自动重连与数据无丢失
