# systemd 生产部署说明（需项目所有者手动以 sudo 执行）

> 按 `AGENTS.md §2` 运维红线与 `ADR-0006`，AI 代理不会自动执行 `sudo` 或修改宿主机 systemd。
> 以下步骤仅在您决定将 `lhm-agent` 作为宿主机常驻服务安装时手动执行。

## 1. 创建最小权限用户与共享 IPC 组

```bash
sudo groupadd --system lhm-ipc
sudo useradd --system --gid lhm-ipc --no-create-home --shell /usr/sbin/nologin lhm-agent
# 若需访问 GPU DRM 节点，按实际硬件附加组：
sudo usermod -aG video,render lhm-agent
```

记下 `lhm-ipc` 的 GID（`getent group lhm-ipc`），在 `deploy/docker/.env` 中设置 `LHM_IPC_GID=<该GID>`，使非 root API 容器与原生 Agent 可通过 `0750` 目录内的 `0660` Unix Socket 通信。

## 2. 安装构建产物与单元文件

```bash
# 编译 release 二进制（在仓库根目录执行）
CARGO_BUILD_JOBS=2 cargo build --release -p lhm-agent

# 安装二进制与 systemd 配置
sudo install -m 0755 target/release/lhm-agent /usr/local/bin/lhm-agent
sudo install -m 0644 deploy/systemd/lhm-tmpfiles.conf /etc/tmpfiles.d/linux-hardware-monitor.conf
sudo systemd-tmpfiles --create /etc/tmpfiles.d/linux-hardware-monitor.conf
sudo install -m 0644 deploy/systemd/lhm-agent.service /etc/systemd/system/lhm-agent.service
```

## 3. 按需开启 SMART / NVMe / Intel PMU 权限（可选）

默认 `lhm-agent.service` 不授予任何 Linux capability（仅读取 `/sys/class/hwmon`、`/sys/class/thermal`、`/proc`、`/sys/class/drm`）。
若需要 `smartctl` / `nvme` 采集受限块设备，按 ADR-0006 在 `/etc/systemd/system/lhm-agent.service` 中仅取消注释所需能力与具体 `DeviceAllow=` 行。

## 4. 启用服务并审计沙箱分值

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lhm-agent.service
systemctl status lhm-agent.service
systemd-analyze security lhm-agent.service
```

## 5. 不安装 systemd 时的零特权本地运行方式

若仅在用户目录运行测试（不触碰宿主机配置）：

```bash
bash deploy/scripts/run-agent-local.sh --interval 5
```
