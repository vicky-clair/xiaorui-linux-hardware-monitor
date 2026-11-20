# ADR-0008：Rust Agent Crate 划分与 Collector 接口设计

- **状态**：proposed
- **日期**：2026-11-20
- **提出者**：Antigravity
- **批准者**：待项目所有者批准

## 背景

进入阶段 1（Rust Agent）前，需要确定 `agents/linux-agent/crates/` 的 crate 边界、核心 `Collector` trait 签名（支持同一设备不同指标的不同采集周期、panic/错误隔离、可注入模拟 sysfs 与外部命令执行器），并避免过早拆分成十余个细碎 crate 导致低功耗 L3 主机（N5095A）编译缓慢与维护负担过重。

## 可选方案

### 方案 A（推荐）：精简 4 个 Agent Crate + 共享 `lhm-protocol`（模块化内部组织）

在根 `Cargo.toml` workspace 下维护：

| Crate | 路径 | 职责 |
| ----- | ---- | ---- |
| `lhm-protocol` | `packages/protocol/rust` | 共享协议类型、不变式校验、4 字节大端分帧编解码（阶段 0 已完成） |
| `agent-core` | `agents/linux-agent/crates/agent-core` | `SysFs` 与 `CommandRunner` 可注入抽象、`Collector` trait、稳定设备/传感器 ID 生成、任务级调度器（单调时钟 + 退避 + panic 隔离）、传感器覆盖率与诊断汇总 |
| `agent-collectors` | `agents/linux-agent/crates/agent-collectors` | 按子模块组织的采集器：`hwmon`、`thermal`、`cpu`、`memory`、`storage`、`smart`、`nvme`、`gpu/{mod,intel,amd,nvidia}`（NVML 运行时 `dlopen`） |
| `agent-ipc` | `agents/linux-agent/crates/agent-ipc` | Unix Domain Socket 客户端（`#[cfg(unix)]` + 跨平台内存传输抽象用于 L0 单测）、`hello`/`heartbeat`/`ack` 协议、指数退避重连、有界内存缓冲与丢弃诊断（ADR-0003） |
| `lhm-agent` | `agents/linux-agent/crates/agent-bin` | 二进制入口、配置加载、`--once` 只读自检输出模式、结构化 JSON 日志、优雅退出 |

#### 核心抽象设计

1. **`Collector` trait（使用 `BoxFuture`，无需 `async-trait` 过程宏）**：
   - `name(&self) -> &'static str`
   - `capabilities(&self) -> CapabilityStatus`
   - `discover(&self, ctx: &CollectorContext) -> BoxFuture<'_, DiscoveryResult>`：返回发现的 `Device`、`Sensor`、按周期划分的 `CollectionTask`（设备 × 指标组）及 `Diagnostic`。
   - `collect(&self, task: &CollectionTask, ctx: &CollectorContext) -> BoxFuture<'_, CollectResult>`：按任务粒度采集，天然支持同一块磁盘 SMART 温度 30 秒 / 全量属性 15 分钟双频率调度。
   - `health_check(&self) -> CollectorStatus` / `diagnostics(&self) -> Vec<Diagnostic>` / `shutdown(&self) -> BoxFuture<'_, ()>`。
2. **故障与 Panic 隔离**：每个采集任务在独立 `tokio::spawn` 中执行并带超时；任何错误、超时或任务 panic 仅更新该采集器的 `CollectorStatus` 与 `Diagnostic`，绝不导致 Agent 进程退出。
3. **可测试性**：所有采集器只通过 `SysFs`（可指向 `tests/hardware-simulation/` 目录树）和 `CommandRunner`（带绝对路径白名单、参数数组、超时、输出大小上限，可替换为 Mock）访问系统资源，确保 L0 Windows 与 L3 Linux 均可运行全部模拟测试。
4. **NVML 动态加载**：`gpu::nvidia` 通过运行时动态加载 `libnvidia-ml.so.1`（`dlopen`）探测 NVIDIA GPU，编译期不链接任何 NVIDIA 库；在无 NVIDIA 驱动的机器上返回 `CapabilityStatus::Unsupported`。

优点：依赖图清晰、编译快、L0/L3 均可运行单元测试；内部子模块边界清晰，未来任一采集器变复杂时可平滑拆分为独立 crate。
缺点：所有采集器位于同一个 crate，改动某一采集器会重编 `agent-collectors`（体量较小，可接受）。

### 方案 B：按采集器拆分为 15+ 独立 crate

优点：极端细粒度的编译单元。
缺点：首版维护成本高、Cargo 依赖和公共测试夹具样板过多，且在 4 核 N5095A 上链接与元数据开销更大。

## 决定

采用 **方案 A**。

## 影响

- 受影响的模块与文件：`Cargo.toml`、`agents/linux-agent/crates/*`、`tests/hardware-simulation/`、`tests/fixtures/`。
- 协议 / 数据库 / 部署是否变更：否（复用阶段 0 协议 v1.0）。
- 需要更新的文档：`docs/decisions/README.md`、`docs/collectors/hardware-scope.md`（若需补充实现细节）。

## 验证方式

- L0（Windows）与 L3（Debian 13.6）：全量 `cargo fmt`、`cargo clippy -- -D warnings`、`cargo test --workspace`（涵盖模拟 sysfs、HDD standby、SMART 位掩码退出码、NVMe 128 位计数、NVIDIA/AMD/Intel GPU 模拟、单采集器 panic 隔离、IPC 重连与缓冲淘汰）。
- L3（Debian 13.6 实体机）：以非 root 用户运行 `lhm-agent --once` 与真实 Unix Socket 模拟服务端联调，实测发现本机 `coretemp`/`acpitz`/Intel UHD Graphics/`sda`/`sdb` 并验证受限设备准确报 `permission_denied`、HDD 不被唤醒。
