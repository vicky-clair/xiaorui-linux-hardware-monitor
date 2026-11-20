# 版本矩阵

> 状态：**部分已实测（工具链），第三方依赖待阶段 0 初始化锁文件后补全**（对应 [ADR-0001](../decisions/0001-version-matrix.md)）。
> 填写规则：每一项必须在开发环境与 Debian 13 目标环境中实际验证后填写，并注明验证日期。禁止填写 `latest`，禁止凭记忆填写。

| 组件 | 锁定版本 | 锁文件 / 声明位置 | 验证日期 | 备注 |
| ---- | -------- | ----------------- | -------- | ---- |
| Debian | `13.6`（内核 `6.12.107+deb13-amd64`） | — | 2026-11-20 | L3 实体机实测 |
| Rust 工具链 | MSRV `1.90.0`（Edition `2024`） | `agents/linux-agent/Cargo.toml` | 2026-11-20 | L3 `1.90.0` / L0 `1.91.1` 实测 |
| Bun | `1.4.4` | `package.json` `packageManager` | 2026-11-20 | L0 实测 |
| Elysia | 待阶段 0 初始化安装后填写 | `bun.lock` | — | |
| Drizzle ORM / drizzle-kit | 待阶段 0 初始化安装后填写 | `bun.lock` | — | |
| React | 待阶段 0 初始化安装后填写 | `bun.lock` | — | |
| Vite | 待阶段 0 初始化安装后填写 | `bun.lock` | — | |
| ECharts | 待阶段 0 初始化安装后填写 | `bun.lock` | — | |
| GHC | `9.10.3` | `core/health-engine/cabal.project` | 2026-11-20 | L0 实测 |
| Cabal | `3.16.1.0` | `core/health-engine/cabal.project.freeze` | 2026-11-20 | L0 实测 |
| Tauri | 2.x 待阶段 6 验证 | — | — | 阶段 6 |
| smartmontools | `smartctl 7.4` | L3 系统包 | 2026-11-20 | 支持 `--json` 与 `-n standby` |
| nvme-cli | `2.13` | L3 系统包 | 2026-11-20 | 支持 JSON 输出 |
| Docker / Compose | `29.7.2` / `v5.5.0` | L3 系统包 | 2026-11-20 | L3 实体机实测 |
| Nginx 镜像 | 待阶段 5 固定 tag 或 digest | Compose 文件 | — | 禁止 `latest` |

## 升级规则

1. 核心依赖升级必须单独提交，说明原因、兼容性影响与测试结果。
2. 升级后更新本表与锁文件。
3. 不得在不同开发环境中各自升级。
