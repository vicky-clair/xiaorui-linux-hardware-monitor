# ADR-0002：开发与验证环境

- **状态**：proposed
- **日期**：2026-11-20
- **提出者**：Antigravity
- **批准者**：待项目所有者批准

## 背景

开发工作站为 Windows（L0，未安装 Docker 与 WSL），目标运行与验证平台为局域网内一台 Debian 13.6 实体机（L3，`192.168.9.165`，主机名 `MiWiFi-RD08-srv`）。该实体机同时承载其他局域网服务（已使用约 4.9 GiB / 7.5 GiB 内存、129G / 226G 磁盘），必须严格隔离项目文件，避免破坏宿主机系统与其他数据。

## 硬件与环境实测摘要（L3）

- 系统：Debian 13.6，内核 `6.12.107+deb13-amd64`（`x86_64`）
- CPU：Intel Celeron N5095A @ 2.00GHz（4 核）
- GPU：Intel JasperLake UHD Graphics（PCI `00:02.0`）；无 NVIDIA / AMD 独立显卡
- 存储：`sda`（238.5G SATA SSD）、`sdb`（931.5G USB 机械硬盘 HGST）；无 NVMe 设备
- 传感器接口：`hwmon0`（`acpitz`）、`hwmon1`（`coretemp`）、`thermal_zone0`（`acpitz`）、`thermal_zone1`（`x86_64` `x86_pkg_temp`）
- 远程可用运行时：原生 Rust `1.90.0`、`Docker 29.7.2` + `Compose v5.5.0`、`smartctl 7.4`、`nvme 2.13`、`sensors 3.6.2`；未原生安装 `bun`/`node`/`ghc`/`cabal`

## 可选方案

### 方案 A（推荐）：Windows L0 本地开发 + SSH 同步到 L3 隔离目录验证

- **职责分工**：
  - **L0（Windows）**：编辑代码、Git 版本管理、Bun API / React Web / Haskell 引擎构建与单元测试、协议校验、Rust 平台无关单元测试。
  - **L3（Debian 13 实体机 `192.168.9.165`）**：Rust Agent 原生 Linux 编译与测试（含模拟 sysfs 与真实硬件只读验证）、Docker Compose 集成与部署测试、长期运行验证。
- **目录与安全隔离**：
  - 远程所有代码、构建产物、测试数据严格限定在 `~/linux-hardware-monitor` 内。
  - 禁止修改宿主机 `/etc/`、宿主机 nginx、已有 systemd 服务或已有 Docker 容器/卷。
  - 任何需要 `sudo` 的操作（如 systemd 单元部署、SMART 权限验证、系统目录创建）必须先向项目所有者说明影响并由项目所有者确认或手动执行。
  - 远程凭据不得写入仓库源码、文档、脚本或持久配置文件。
- **代码同步**：通过受控脚本/tar-over-ssh 或 Git 推送仅同步仓库跟踪文件到 `~/linux-hardware-monitor`（排除 `target/`、`node_modules/`、`dist-newstyle/` 与本地 `.db`）。
- **无实机硬件的覆盖**：本机无 NVIDIA/AMD GPU 与 NVMe 设备，相应采集器在 L3 上必须正确报告 `unsupported`，并通过 `tests/hardware-simulation/` 模拟验证并标注"仅模拟验证"。

优点：契合现有已装环境（L0 全栈 + L3 Rust/Docker）；严格隔离，风险最低。
缺点：无法在 L3 实测 NVIDIA/AMD/NVMe 真实硬件，需依赖模拟测试及后续额外硬件验证。

### 方案 B：在 L3 原生安装 Bun / GHC / Cabal 并全部在远程开发

优点：单一 Linux 环境。
缺点：在 4 核 N5095A（剩余内存约 2.6 GiB）上编译 GHC/Haskell 依赖容易触发内存抖动或影响宿主机现有服务，且需在实体机安装较多工具链。

## 决定

采用 **方案 A**。

## 影响

- 受影响的模块与文件：`docs/development/environment.md`、后续同步与测试脚本。
- 协议 / 数据库 / 部署是否变更：否。
- 需要更新的文档：`docs/development/environment.md`。

## 验证方式

- 已通过只读 SSH 验证 L3 连通性与系统/硬件信息。
- 阶段 0 同步 Rust workspace 到 `~/linux-hardware-monitor` 并运行 `cargo test` 验证闭环。
