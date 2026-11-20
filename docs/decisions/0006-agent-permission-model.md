# ADR-0006：Rust Agent 权限模型与 systemd 加固基线

- **状态**：proposed
- **日期**：2026-11-20
- **提出者**：Antigravity
- **批准者**：待项目所有者批准

## 背景

Rust Agent 需要读取 `/sys/class/hwmon`、`/sys/class/thermal`、`/proc`、DRM sysfs，并按需调用 `smartctl`、`nvme` 及可选 GPU 接口。其中 SMART/NVMe 访问块设备通常需要特权，而 AGENTS.md 红线禁止不必要的 root 权限与宽泛设备访问。同时，Linux capability 是进程级的，需要务实、可执行的最小权限模型。

## 可选方案

### 方案 A（推荐）：专用非 root 系统用户 + 精确 systemd Capabilities + 严格路径/设备白名单

- **开发与阶段 1 测试期**：
  - 以当前普通非 root 用户运行 Agent，不申请 `sudo`。
  - 对于无需特权的接口（`hwmon`、`thermal`、`/proc`、`drm` 等）直接实测采集；对于需要特权的接口（如 `smartctl` 访问 `/dev/sda`），若返回权限不足，Agent 必须准确上报 `capability_status = permission_denied` 并输出可操作诊断（禁止伪造正常或误报硬件故障）。
- **阶段 5 生产部署（systemd）**：
  - 专用非 root 用户 `lhm-agent`，主组 `lhm-ipc`（与 API 容器内运行用户共享 GID，用于 Unix Socket 0660 通信），按硬件需要附加 `video`/`render` 组。
  - **禁止 `User=root`**。
  - 按实际启用的采集器，通过 systemd 精确授予最小 `AmbientCapabilities` / `CapabilityBoundingSet`：
    - 启用 SMART / NVMe 时：`CAP_SYS_RAWIO`（必要时经实测确认是否需 `CAP_SYS_ADMIN`）。
    - 启用 Intel GPU PMU 时：`CAP_PERFMON`。
    - 未启用相应采集器时不授予对应 capability。
  - 强制 systemd 沙箱基线：`NoNewPrivileges=yes`、`ProtectSystem=strict`、`ProtectHome=yes`、`PrivateTmp=yes`、`ProtectKernelModules=yes`、`ProtectKernelTunables=yes`、`ProtectControlGroups=yes`、`RestrictNamespaces=yes`、`LockPersonality=yes`、`RuntimeDirectory=linux-hardware-monitor`、`RuntimeDirectoryMode=0750`、`DevicePolicy=closed` + 显式 `DeviceAllow`（仅允许配置内的块设备只读/查询及必需的 DRM 渲染节点）。
- **外部命令白名单**：仅允许固定绝对路径（`/usr/sbin/smartctl`、`/usr/sbin/nvme`），固定参数数组、超时、输出字节上限，禁止任何 Shell 拼接。

优点：在单进程架构下实现可落地的最小权限，systemd 沙箱边界清晰可审计；开发期零 root 风险。
缺点：进程级 capability 在进程内对所有线程可见（后续若需更强隔离，可演进为方案 B）。

### 方案 B：特权分离（独立受限 SMART helper 进程 + Unix 管道）

优点：主 Agent 进程零 capability。
缺点：显著增加 v1 进程管理、打包、IPC 与错误诊断复杂度，适合在 v1 稳定后作为安全增强演进。

## 决定

v1 采用 **方案 A**；保留演进至方案 B 的采集器命令抽象边界（`CommandRunner` trait）。

## 影响

- 受影响的模块与文件：`agents/linux-agent/`、`deploy/systemd/`、`docs/security/security.md`。
- 协议 / 数据库 / 部署是否变更：明确阶段 5 systemd 加固基线。
- 需要更新的文档：`docs/security/security.md`。

## 验证方式

- 阶段 1：L3 非 root 运行验证 `hwmon`/`thermal`/`proc` 正常采集，受限设备准确上报 `permission_denied`。
- 阶段 5：在项目所有者授权后于 L3 实测 systemd 最小 capability 集合，用 `systemd-analyze security` 评估沙箱分值。
