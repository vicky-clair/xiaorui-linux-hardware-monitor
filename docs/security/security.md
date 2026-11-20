# 安全规范

## 1. 用户认证

- 用户名 + 密码，密码使用 Argon2id 哈希。
- **初始管理员**：首次启动时通过一次性初始化流程创建（如启动时生成一次性令牌写入日志或文件，或通过 CLI 创建），不得内置默认密码。
- 会话存储于 `app_sessions`，Cookie 设置 `HttpOnly`、`Secure`、`SameSite`。
- 登录失败限流（按用户与来源 IP）。
- 角色：至少区分 `admin`（可修改配置、用户、规则）与 `viewer`（只读）。
- 配置修改、用户管理、告警规则变更写入审计日志。

## 2. 网络

- API 与 Haskell 健康引擎只监听容器内部网络，不直接暴露宿主机端口；由非 root Nginx 容器提供单端口入口。
- 按 [ADR-0009](../decisions/0009-lan-deployment-and-https.md)：受信任私有局域网默认支持直连 HTTP（避开宿主机 80/443 等既有端口，`LHM_COOKIE_SECURE=false`），同时完整提供可选 HTTPS 反向代理模板与自签名证书脚本；若暴露至非受信任网络，**必须**启用 HTTPS 与 `LHM_COOKIE_SECURE=true`。
- WebSocket 必须认证并校验 Origin（已预留阶段 6 Tauri 客户端的 `tauri://localhost` 与 `http://tauri.localhost`）。
- 不在源码中存储密钥；不向前端返回敏感配置；未认证用户不得修改任何配置。

## 3. Agent

- 权限模型由 ADR-0006 确定。需要考虑：smartctl 访问 SATA / NVMe 设备通常需要 root 或 `CAP_SYS_RAWIO` / `CAP_SYS_ADMIN`；Intel GPU 利用率可能需要 `CAP_PERFMON`。
- Linux capability 是进程级的。若要求"不同采集器不同权限"，必须采用特权分离（如独立的受限 helper 进程），否则以进程整体最小权限为准。
- systemd 加固基线（ADR-0006 确定具体取值）：`NoNewPrivileges`、`CapabilityBoundingSet`、`AmbientCapabilities`、`ProtectSystem=strict`、`ProtectHome`、`PrivateTmp`、`DeviceAllow`、`RuntimeDirectory`、`ReadWritePaths` 等。
- Socket 文件权限只允许 Agent 与 API 所属组访问。
- 外部命令：超时、参数数组、路径白名单、输出大小限制。
- IPC 输入数据必须校验。

禁止：任意 Shell 执行接口、任意文件读取 / 写入接口、不必要的 root、无条件开放所有设备访问。

## 4. Docker

禁止未经论证（需 ADR）使用：`privileged: true`、host network、Docker socket 挂载、宿主机根目录挂载、不必要的设备映射、root 容器。

容器以非 root 用户运行；镜像固定版本标签或 digest。

## 5. 日志与错误

- 日志级别：TRACE、DEBUG、INFO、WARN、ERROR，生产默认 INFO。
- 日志至少包含：时间、组件、级别、主机 ID、设备 ID（适用时）、采集器名称、错误代码、请求 ID（适用时）。
- 错误尽可能包含：稳定错误代码、来源、时间、设备身份、诊断信息、修复建议。
- 禁止：静默吞异常、伪造成功、无限重试、刷屏重复错误（需要限频与聚合）、把权限不足当硬件故障。
- 日志中不得包含密码、会话令牌、密钥。
