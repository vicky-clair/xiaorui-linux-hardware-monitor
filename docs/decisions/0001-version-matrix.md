# ADR-0001：版本矩阵与依赖锁定策略

- **状态**：accepted
- **日期**：2026-11-20
- **提出者**：Antigravity
- **批准者**：项目所有者（2026-11-20）

## 背景

项目横跨 Windows 开发机（L0）与 Debian 13 实体机（L3），涉及 Rust、Bun/TypeScript、React、Haskell、Docker 等多套工具链。需要锁定工具链与依赖版本，防止跨环境构建不一致或隐式升级导致回归。

## 实测基线（2026-11-20）

- **L0（Windows 开发机）**：`git 2.56.0`、`rustc 1.91.1`、`cargo 1.91.1`、`bun 1.4.4`、`node v25.1.0`、`ghc 9.10.3`、`cabal 3.16.1.0`。
- **L3（Debian 13.6 实体机，`6.12.107+deb13-amd64`）**：`git 2.47.3`、`rustc 1.90.0`、`cargo 1.90.0`、`docker 29.7.2`、`docker compose v5.5.0`、`smartctl 7.4`、`nvme 2.13`、`sensors 3.6.2`、`gcc 14.2.0`、`pkg-config 1.8.1`、`python3 3.13.5`。

## 可选方案

### 方案 A（推荐）：以 L0 / L3 实测低版本为基线 + 锁文件全量提交

- Rust 设定 `rust-version = "1.90"`、Edition `2024`（兼容 L3 的 1.90.0 与 L0 的 1.91.1，无需升级远程主机工具链）。
- Bun 锁定为 `1.4.4`（L0 实测；容器镜像固定对应版本 tag）。
- GHC 锁定 `9.10.3`、Cabal `3.16.1.0`（L0 实测；Haskell 依赖通过 `cabal.project.freeze` 锁定）。
- 第三方依赖（Elysia、Drizzle ORM、React、Vite、ECharts、Rust crates、Haskell packages）在阶段 0 工程初始化安装并通过构建测试后，将实际版本写回 [docs/architecture/versions.md](../architecture/versions.md) 并提交 `bun.lock`、`Cargo.lock`、`cabal.project.freeze`。
- Docker 基础镜像禁止使用 `latest`，固定具体版本标签或 digest。

优点：零额外系统改动，立即兼容现有 L0 与 L3；锁文件保证可重复构建。
缺点：后续若需升级 Rust MSRV，须同步升级 L3 工具链。

### 方案 B：统一升级 L0 与 L3 到同一精确小版本（通过 rustup / 容器）

优点：两地编译器完全一致。
缺点：需要修改远程主机的工具链安装，增加阶段 0 前置运维成本。

## 决定

采用 **方案 A**。

## 影响

- 受影响的模块与文件：`docs/architecture/versions.md`、根目录 `package.json`、`agents/linux-agent/Cargo.toml`、`core/health-engine/cabal.project`、未来 `deploy/docker/`。
- 协议 / 数据库 / 部署是否变更：否。
- 需要更新的文档：`docs/architecture/versions.md`。

## 验证方式

阶段 0 结束前，在 L0 与 L3 分别构建对应组件，确认锁文件生效且所有已验证版本均记录在 `docs/architecture/versions.md`。
