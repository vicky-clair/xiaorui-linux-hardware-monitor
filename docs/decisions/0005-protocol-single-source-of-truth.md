# ADR-0005：协议单一事实来源与跨语言一致性策略

- **状态**：proposed
- **日期**：2026-11-20
- **提出者**：Antigravity
- **批准者**：待项目所有者批准

## 背景

共享协议同时被 Rust、TypeScript（Bun + React）、Haskell 三种语言消费。若各语言独立维护类型且缺乏自动校验，极易产生字段名、枚举值、可选性或大整数精度的漂移。

## 可选方案

### 方案 A（推荐）：JSON Schema（Draft 2020-12）作为唯一事实来源 + 黄金样例跨语言 Round-trip 校验

- **权威定义**：所有协议实体、枚举、IPC 消息、分析请求/响应统一在 `packages/protocol/schemas/*.schema.json` 中用 JSON Schema Draft 2020-12 定义。
- **语言绑定**：`packages/protocol/typescript/`、`packages/protocol/rust/`、`packages/protocol/haskell/` 维护简洁、惯用的强类型定义（分别使用 TypeScript + Ajv、`serde`、`aeson`）。
- **一致性门禁（CI 强制执行）**：
  1. 维护共享正例（`packages/protocol/examples/valid/`）与反例（`packages/protocol/examples/invalid/`），覆盖所有状态枚举、`0` 值、`null` 缺失值、大整数十进制字符串（`> 2^53`）、必填字段缺失、非法枚举等。
  2. TypeScript 侧用 **Ajv（Draft 2020-12）** 校验所有 Schema 自身合法性及所有正/反例，并验证 TS 校验函数行为一致。
  3. Rust 与 Haskell 测试套件直接读取同一套 `examples/`：所有正例必须成功反序列化并重新序列化后等价（且无大整数精度丢失）；所有反例必须反序列化/校验失败。

优点：各语言保持地道、无冗余且易审计的类型代码；无第三方代码生成器的边缘语法 Bug（尤其 Haskell `aeson` + Rust `serde` 组合）；100% 离线、确定性可验证。
缺点：修改协议时需同步更新 Schema 与三语言类型（但任何遗漏都会被 CI 的黄金样例测试立刻拦截）。

### 方案 B：使用 `quicktype` 等工具从 JSON Schema 全自动生成三语言代码

优点：改 Schema 后一键生成。
缺点：对 JSON Schema Draft 2020-12 特性（`$defs`、判别联合、string pattern、nullable）在 Haskell 与 Rust 端生成代码质量不稳定，常导致生成代码难维护或需手工补丁。

## 决定

采用 **方案 A**。

## 影响

- 受影响的模块与文件：`packages/protocol/`、CI 工作流、`tests/protocol/`。
- 协议 / 数据库 / 部署是否变更：确立阶段 0 协议工程结构。
- 需要更新的文档：`docs/protocol/data-model.md`。

## 验证方式

阶段 0 建立完整核心 Schema（Host、Device、Sensor、SensorReading、CollectorStatus、Diagnostic、IpcMessage）及正反例，在 L0/L3 通过 Bun（Ajv）、Rust（`cargo test`）、Haskell（`cabal test`）三端一致性测试。
