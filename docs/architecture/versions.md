# 版本矩阵

> 状态：**阶段 0 已实测锁定**（对应 [ADR-0001](../decisions/0001-version-matrix.md)，accepted）。
> 填写规则：每一项必须在开发环境与 Debian 13 目标环境中实际验证后填写，并注明验证日期。禁止填写 `latest`，禁止凭记忆填写。

| 组件 | 锁定版本 | 锁文件 / 声明位置 | 验证日期 | 备注 |
| ---- | -------- | ----------------- | -------- | ---- |
| Debian | `13.6`（内核 `6.12.107+deb13-amd64`） | — | 2026-11-20 | L3 实体机实测 |
| Rust 工具链 | MSRV `1.90.0`（Edition `2024`） | 根 `Cargo.toml`、`Cargo.lock` | 2026-11-20 | L3 `1.90.0` / L0 `1.91.1` 实测 |
| Bun | `1.4.4`（Docker 镜像 `oven/bun:1.4.4-debian@sha256:93d5032fe06d163427822dc1598f420363759bb18155c9cc90eb1be05a64a19e`） | `package.json` `packageManager`、`bun.lock` | 2026-11-20 | L0 + L3 容器实测 |
| TypeScript | `5.9.3` | `bun.lock` | 2026-11-20 | L0 实测 |
| Ajv / ajv-formats | `8.20.0` / `3.0.1` | `bun.lock` | 2026-11-20 | JSON Schema Draft 2020-12 校验 |
| Elysia | `1.4.32` | `bun.lock` | 2026-11-20 | L0 实测 |
| Drizzle ORM / drizzle-kit | `0.44.7` / `0.31.11` | `bun.lock` | 2026-11-20 | L0 实测 |
| React / React DOM | `19.3.1` | `bun.lock` | 2026-11-20 | L0 实测 |
| Vite | `6.4.6` | `bun.lock` | 2026-11-20 | L0 实测 |
| ECharts | `5.6.0` | `bun.lock` | 2026-11-20 | L0 实测 |
| GHC | `9.10.3`（Docker 构建镜像 `haskell:9.10.3-slim-bookworm@sha256:683f74f48dcc5a40081628d12ebe8f3bb379bf3fefa46d74e785b5fbb9f21b32`） | `core/health-engine/cabal.project`、`deploy/docker/Dockerfile.health-engine` | 2026-11-20 | L0 + L3 容器实测 |
| Cabal | `3.16.1.0` | `core/health-engine/cabal.project.freeze` | 2026-11-20 | L0 实测 |
| Tauri | 2.x 待阶段 6 验证 | — | — | 阶段 6 |
| smartmontools | `smartctl 7.4` | L3 系统包 | 2026-11-20 | 支持 `--json` 与 `-n standby` |
| nvme-cli | `2.13` | L3 系统包 | 2026-11-20 | 支持 JSON 输出 |
| Docker / Compose | `29.7.2` / `v5.5.0` | L3 系统包 | 2026-11-20 | L3 实体机实测 |
| Nginx 镜像 | `nginxinc/nginx-unprivileged:1.28-alpine-slim@sha256:47288214e27cc88b5b3c5277f4fcdb58bc29059f86121b59b9c1e1171938216e` | `deploy/docker/Dockerfile.web` | 2026-11-20 | 非 root 容器，L3 实测拉取 |
| 运行时精简基础镜像 | `debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc` | `deploy/docker/Dockerfile.health-engine` | 2026-11-20 | Haskell 引擎非 root 运行时，L3 实测拉取 |

## 升级规则

1. 核心依赖升级必须单独提交，说明原因、兼容性影响与测试结果。
2. 升级后更新本表与锁文件。
3. 不得在不同开发环境中各自升级。
