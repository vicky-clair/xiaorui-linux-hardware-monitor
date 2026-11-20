# AGENTS.md — Linux Hardware Monitor

> AI 编程代理执行规范（入口文件）｜版本 2.0.0｜目标平台 Debian 13
> 本文件只包含**强制规则与索引**，细节在 `docs/`（见 §9）。本文件须保持在 15 KB 以内，新增细节写入 `docs/`。
> 旧版完整规范存档于 `docs/archive/AGENTS.v1.0.0.md`，仅供参考，与本文件冲突时以本文件为准。

## 0. 每次任务开始前（强制）

1. 阅读本文件与 [docs/status.md](docs/status.md)，确认当前阶段与 ADR 状态。
2. 按 §9 读取与任务相关的 `docs/` 规范及模块 README。
3. 检查目录结构、现有实现、Git 分支与工作区状态。
4. 明确涉及模块，判断是否影响协议、数据库或部署配置。
5. 不得在未读现有代码的情况下重写文件；不得假设功能尚未实现。

## 1. 最高原则（冲突时按顺序取舍）

正确性 > 开发速度；安全性 > 功能便利；实际硬件能力 > 理论假设；统一协议 > 模块各自定义；可测试性 > 一次性实现；数据完整性 > 激进重构；模块隔离 > 功能耦合；最小权限 > 简单提权；真实测试 > 模拟成功；可维护性 > 代码数量。

任务要求与本规范冲突时：暂停冲突部分，向项目所有者说明冲突内容、技术影响与建议方案，等待明确决定。

## 2. 红线（任何情况下禁止）

**事实**
- 虚构 Linux 接口、硬件传感器、GPU 支持能力、SMART 属性、命令输出、测试结果、性能数据。
- 把未验证功能写成已实现；把理论兼容写成测试通过；把模拟测试写成真实硬件测试。无法确认时标注"待验证"。

**数据**
- 用 0 表示无数据（0 是有效值，缺失用 `null`）。
- 前端推断健康状态；伪造成功状态；静默吞异常；无限重试。
- 把权限不足当作硬件故障；把传感器故障当作硬件故障；把数据过期当作健康。

**架构**
- 擅自更换技术栈（§3）或改变 Agent 原生运行架构。
- Rust 或 Haskell 访问 SQLite；前端绕过 API；API 容器访问宿主机 `/sys`、`/proc`、`/dev`。
- 只修改一种语言的协议定义；绕过 Migration 修改表结构。
- 在 ADR 批准前实现依赖该 ADR 的接口（可写原型，须标注"原型，待 ADR 批准"）。

**安全**
- 任意 Shell 执行、任意文件读取 / 写入接口；拼接 Shell 命令；无超时的外部命令。
- 未经 ADR 论证使用 `privileged: true`、host network、Docker socket 挂载、宿主机根目录挂载、root 容器。
- 在源码中存储密钥；不必要的 root 权限。

**运维（须先说明影响并取得用户明确授权）**
- 重启 / 关机、格式化 / 分区、删除数据库或执行 DROP TABLE、删除容器数据目录、停用 systemd 服务、Docker 数据清理、覆盖生产配置、修改宿主机配置、修改密钥、删除用户已有配置或数据。

## 3. 技术栈（正式决策，变更需 ADR + 项目所有者批准）

| 层 | 方案 | 层 | 方案 |
| -- | ---- | -- | ---- |
| 系统 | Debian 13 | 采集 Agent | Rust（systemd 管理） |
| 结构 | Monorepo | 健康分析 | Haskell + Cabal |
| 前端 | React + TypeScript + Vite + ECharts | 桌面端 | Tauri 2（阶段 6） |
| 运行时 | Bun | Web/API 部署 | Docker Compose + Nginx |
| API | Elysia | Agent 通信 | Unix Domain Socket |
| ORM / 库 | Drizzle ORM + SQLite | Web 通信 | REST + WebSocket，JSON |
| 协议 | JSON Schema | | |

版本锁定见 [docs/architecture/versions.md](docs/architecture/versions.md)：使用稳定版本、实测后填写、提交锁文件，禁止 `latest`。

## 4. 语言职责边界

| 组件 | 负责 | 禁止 |
| ---- | ---- | ---- |
| Rust Agent | 硬件发现、设备身份、传感器发现、采集（hwmon / thermal / CPU / GPU / 内存 / 存储 / SMART / NVMe / 风扇电压）、数据标准化、调度、诊断、IPC 发送 | Web 业务、用户管理、数据库写入；单个采集器故障导致 Agent 退出 |
| Bun API | REST / WebSocket、认证权限、配置、IPC 接收与校验、**唯一 SQLite 写入者**、历史查询、聚合与保留、告警生命周期、审计 | 访问硬件接口、扫描宿主机设备、执行硬件命令 |
| Haskell | 规则、阈值、趋势、异常、关联、评分、告警状态判定（纯计算） | 读 `/sys` `/proc`、执行采集、读写 SQLite |
| React | 展示与交互 | 推断健康、伪造或补零数据、绕过 API |
| Tauri 2 | 桌面客户端（阶段 6） | 服务端采集 |

## 5. 架构

```
Linux 硬件 → Rust Agent（宿主机原生）→ Unix Socket → Bun API → SQLite
React ⇄ REST / WebSocket ⇄ Bun API ⇄ Haskell Health Engine
```

- v1 仅支持单主机；数据模型保留 `host_id`。
- 以下接口**必须先通过 ADR 确定**：Agent↔API 连接方向 / 分帧 / 缓冲重放（0003）、Bun↔Haskell 接口（0004）、协议代码生成（0005）、Agent 权限模型（0006）、告警职责划分（0007）。清单见 [docs/decisions/README.md](docs/decisions/README.md)。
- 详见 [docs/architecture/overview.md](docs/architecture/overview.md)。

## 6. 目录地图

```
AGENTS.md  GEMINI.md  README.md  .gitattributes  .gitignore  .gemini/settings.json
package.json  bun.lock  tsconfig.base.json  Cargo.toml  Cargo.lock
apps/api/          Bun + Elysia API（src/{routes,services,repositories,auth,middleware,websocket,ipc,config}, drizzle/, tests/）
apps/web/          React + Vite 控制台
apps/desktop/      Tauri 2（阶段 6）
agents/linux-agent/  Rust Agent crates（crates/ 划分见 ADR-0008；由根 Cargo.toml 统一 workspace）
core/health-engine/  Haskell（cabal.project、cabal.project.freeze、src/Health/, app/, test/）
packages/protocol/   JSON Schema（schemas/）、examples/{valid,invalid}/、typescript/、rust/、haskell/、CHANGELOG.md
deploy/            docker/、systemd/、nginx/、scripts/
docs/              architecture/ api/ protocol/ collectors/ database/ security/ testing/ web/ development/ decisions/ archive/ status.md
scripts/           开发、构建、同步、维护脚本
tests/             integration/、fixtures/、hardware-simulation/、protocol/
.github/workflows/ CI 配置
```

新增目录须符合职责边界并更新本节。

## 7. 核心数据规则（详见 [docs/protocol/data-model.md](docs/protocol/data-model.md)）

- 四个**独立**状态维度，禁止混用：
  - `capability_status`：supported / unsupported / permission_denied / unavailable / unknown
  - `quality`：valid / stale / sensor_fault / out_of_range / missing
  - `device_status`：online / standby / offline / unknown
  - `severity`（仅分析与告警）：normal / warning / critical / unknown
- 缺失值：`value: null` + 非 `valid` 的 `quality`。
- 稳定 ID：如 `gpu-pci-0000-01-00-0`；禁止 `gpu-001`、`hwmon3` 等临时序号。
- 超过 2^53 的整数用十进制字符串传输。时间统一 UTC RFC 3339。
- JSON Schema 是唯一事实来源；协议变更须同步 Schema、Rust、TS、Haskell、示例、测试、CHANGELOG。
- HDD 采集必须不唤醒待机硬盘；SMART / NVMe 使用 JSON 输出；NVML 运行时动态加载（详见 [docs/collectors/hardware-scope.md](docs/collectors/hardware-scope.md)）。

## 8. 常用命令

> Linux 侧命令不得在 Windows pwsh 中执行，L3 远程执行方式见 [docs/development/environment.md](docs/development/environment.md)。

| 用途 | 命令 | 执行环境 |
| ---- | ---- | -------- |
| 安装 JS/TS 依赖 | `bun install --frozen-lockfile` | L0+ |
| Rust 格式 / Lint / 测试 | `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace` | L0 / L3 |
| Bun API 测试 / 类型检查 | `bun run typecheck && bun run test:api` | L0+ |
| Web 构建 / 测试 | `bun run test:web && bun run build:web` | L0+ |
| Haskell 构建 / 测试 | `cd core/health-engine && cabal build all && cabal test all --test-show-details=direct` | L0+ |
| 协议校验（三端） | `bun run test:protocol` + Rust `cargo test -p lhm-protocol` + Haskell `cabal test lhm-protocol` | L0 / L3 |
| 数据库 Migration | `bun --filter @lhm/api db:generate` | L0+ |
| 一键全量本地 CI | `pwsh -File scripts/ci.ps1`（L0） / `bash scripts/ci.sh`（L3） | L0 / L3 |

## 9. 文档索引

| 主题 | 文档 |
| ---- | ---- |
| 开发者完整指南 | [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) |
| 当前阶段与验收 | [docs/status.md](docs/status.md) |
| 总体架构 / 版本矩阵 | [docs/architecture/overview.md](docs/architecture/overview.md)、[versions.md](docs/architecture/versions.md) |
| 健康分析引擎 | [docs/architecture/health-engine.md](docs/architecture/health-engine.md) |
| 硬件范围与采集器 | [docs/collectors/hardware-scope.md](docs/collectors/hardware-scope.md) |
| 数据协议与 IPC | [docs/protocol/data-model.md](docs/protocol/data-model.md) |
| API | [docs/api/api-spec.md](docs/api/api-spec.md) |
| 数据库 | [docs/database/schema.md](docs/database/schema.md) |
| Web 控制台 | [docs/web/ui-spec.md](docs/web/ui-spec.md) |
| 安全、日志与错误 | [docs/security/security.md](docs/security/security.md) |
| 生产部署与运维 | [docs/deployment/deployment.md](docs/deployment/deployment.md) |
| 测试与硬件模拟 | [docs/testing/testing.md](docs/testing/testing.md) |
| 开发环境 | [docs/development/environment.md](docs/development/environment.md) |
| 阶段、Git、性能目标 | [docs/development/workflow.md](docs/development/workflow.md) |
| 架构决策 | [docs/decisions/README.md](docs/decisions/README.md) |

## 10. 开发流程

- 阶段：0 基础工程 → 1 Rust Agent → 2 Bun API → 3 React Web → 4 Haskell 分析与告警 → 5 生产部署 → 6 扩展。任务与验收标准见 workflow.md。
- 只有项目所有者能确认阶段验收；代理不得自行宣布进入下一阶段。
- 修改后：查看 diff → 格式化 → 相关测试 → 构建 → 更新文档。
- 数据库变更：必须 Migration，考虑兼容、回滚与备份。
- Git：Conventional Commits（如 `feat(agent): add hwmon discovery`）；提交锁文件；不提交数据库、密钥、生产日志、构建产物。

## 11. 任务完成报告（强制格式）

1. **本次完成内容**：新增与修改的功能。
2. **修改文件**：实际修改的文件及用途。
3. **技术实现**：核心实现与架构边界。
4. **测试结果**：分别列出已通过 / 未通过 / 未执行 / 仅模拟验证 / 尚未在真实硬件验证，并注明环境级别（L0–L3）。
5. **风险与限制**：已知问题与待解决事项。
6. **下一步**：符合当前阶段的后续任务。

不得把未执行的测试写成已通过。
