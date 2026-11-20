# Linux Hardware Monitor

面向 Debian 13 Linux 主机的硬件监控与健康分析平台。

## 架构概览

```
Linux 硬件 → Rust Agent（宿主机原生，systemd）→ Unix Socket → Bun API（唯一 DB 写入者）→ SQLite
React + Vite + ECharts ⇄ REST / WebSocket ⇄ Bun API ⇄ Haskell Health Engine（纯计算）
```

详细规范与设计请阅读：
- [AGENTS.md](AGENTS.md) — 项目总规范与强制红线
- [docs/status.md](docs/status.md) — 当前开发阶段与验收状态
- [docs/architecture/overview.md](docs/architecture/overview.md) — 总体架构
- [docs/decisions/README.md](docs/decisions/README.md) — 架构决策记录（ADR）
- [docs/development/environment.md](docs/development/environment.md) — 开发与验证环境分级（L0–L3）

## 目录结构

- `packages/protocol/`：JSON Schema（Draft 2020-12，唯一事实来源）、黄金样例及 TypeScript / Rust / Haskell 绑定
- `agents/linux-agent/`：Rust 硬件采集 Agent Workspace
- `apps/api/`：Bun + Elysia + Drizzle ORM 后端 API
- `apps/web/`：React + TypeScript + Vite + ECharts Web 控制台
- `core/health-engine/`：Haskell + Cabal 纯计算健康分析引擎
- `tests/`：集成测试、模拟硬件环境与共享 fixtures
- `scripts/`：本地与 CI 验证脚本

## 快速检查（阶段 0）

Windows 开发机（L0）：

```powershell
pwsh -File scripts/ci.ps1
```

Linux 环境（L1 / L3）：

```bash
bash scripts/ci.sh
```
