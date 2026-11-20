# 开发与验证环境

> 状态：**已批准，对应 [ADR-0002](../decisions/0002-dev-and-verification-env.md)（accepted）**。

## 1. 现状（2026-11-20 实测）

- **L0（Windows 开发工作站）**：PowerShell 环境；已安装 `git 2.56.0`、`rustc 1.91.1`、`cargo 1.91.1`、`bun 1.4.4`、`node v25.1.0`、`ghc 9.10.3`、`cabal 3.16.1.0`、OpenSSH；未安装 Docker / WSL。
- **L3（局域网 Debian 13.6 实体机）**：主机 `192.168.9.165`（`MiWiFi-RD08-srv`），内核 `6.12.107+deb13-amd64`；已安装 `git 2.47.3`、`rustc 1.90.0`、`cargo 1.90.0`、`docker 29.7.2`、`docker compose v5.5.0`、`smartctl 7.4`、`nvme 2.13`、`sensors 3.6.2`、`gcc 14.2.0`、`pkg-config 1.8.1`、`python3 3.13.5`；未原生安装 `bun`/`node`/`ghc`/`cabal`。
- Rust Agent 依赖 `/sys`、`/proc`、Unix Socket、systemd、smartctl、nvme-cli、GPU 驱动，**无法在 Windows 上运行或真实测试**。

## 2. 环境分级

| 级别 | 环境 | 可用于 | 不可用于 |
| ---- | ---- | ------ | -------- |
| L0 | Windows 本机 | 编辑代码、React 开发、Bun API 单元测试、Haskell 构建测试、协议校验、Rust 平台无关单测 | 任何依赖 Linux 接口的运行与测试 |
| L1 | WSL2 / Linux 容器 | Rust 编译、模拟 sysfs 单测、Haskell 构建测试、协议测试 | 真实传感器（当前工作站未配置 WSL2） |
| L2 | Debian 13 虚拟机 | systemd 单元、Docker Compose 部署、Socket 权限、集成测试 | 真实传感器（当前未配置） |
| L3 | Debian 13 实体机（`192.168.9.165`） | **真实硬件验证**（仅限本机实际拥有的硬件）、Linux 原生编译与测试、Docker Compose 部署、长期运行测试 | 缺失硬件（如 NVIDIA/AMD GPU、NVMe）的真实测试 |

## 3. 规则

1. 只有 L3 上针对真实存在硬件的测试结果可以称为"真实硬件验证"；L3 上不存在的硬件（NVIDIA/AMD GPU、NVMe）只能标记为"仅模拟验证"。
2. 所有测试报告必须注明环境级别（L0–L3）。
3. 代理在 Windows pwsh 中不得直接执行 Linux 命令；Linux 命令通过 SSH 发往 L3 主机执行，且远程工作目录严格限定在 `~/linux-hardware-monitor`。
4. 禁止在任何仓库文件、文档、脚本或日志中存储 SSH 密码或密钥。
5. 在 L3 上执行任何 `sudo` 命令或可能影响宿主机系统配置、既有 Docker 容器/卷、nginx、systemd 服务的操作前，必须先说明影响并取得项目所有者明确授权。

## 4. 执行方式（对应 ADR-0002）

| 级别 | 主机 / 发行版 | 执行方式 | 备注（实测硬件清单） |
| ---- | ------------- | -------- | -------------------- |
| L0 | Windows 本机 | PowerShell 本地执行 | 工作区：`c:\XMWJJ\linux-hardware-monitor` |
| L3 | Debian 13.6（`192.168.9.165`，`MiWiFi-RD08-srv`） | SSH（端口 22，普通用户 `hailan20251015`，凭据仅会话内存传递，不落盘）；远程隔离目录 `~/linux-hardware-monitor` | CPU：Intel Celeron N5095A（4 核）；GPU：Intel JasperLake UHD Graphics（`00:02.0`）；磁盘：`sda` 238.5G SATA SSD、`sdb` 931.5G USB HDD（HGST）；内存：7.5 GiB；传感器：`hwmon0` (`acpitz`)、`hwmon1` (`coretemp`)、`thermal_zone0` (`acpitz`)、`thermal_zone1` (`x86_pkg_temp`) |

## 5. 编码与换行

- 所有文本文件使用 UTF-8、LF 换行（由 `.gitattributes` 保证）。
- 脚本文件（`.sh`）必须是 LF，否则在 Linux 上无法执行。
