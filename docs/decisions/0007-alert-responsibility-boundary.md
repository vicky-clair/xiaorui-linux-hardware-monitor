# ADR-0007：告警判定与告警生命周期职责划分

- **状态**：accepted
- **日期**：2026-11-20
- **提出者**：Antigravity
- **批准者**：项目所有者（2026-11-20）

## 背景

原规范同时赋予 Bun API“告警管理”与 Haskell“告警状态机”职责，但未界定生成、去重、确认、恢复、静默的边界。需要在阶段 0 明确分工，避免阶段 2/4 出现重复逻辑或状态不一致。

## 可选方案

### 方案 A（推荐）：Haskell 负责纯计算“状态判定”，Bun 负责持久化“生命周期管理”

| 职责 | 归属 | 说明 |
| ---- | ---- | ---- |
| 规则匹配、阈值优先级判定、持续时间 `duration`、迟滞恢复、关联分析、健康评分 | Haskell | 纯函数，输入 `(readings, window, rules, prev_alert_states)`，输出 `(analysis_results, transitions, next_alert_states)` |
| 状态快照 `alert_states` 持久化 | Bun | 每次分析结束后与 `analysis_results` 同事务写入 SQLite |
| 告警实例创建 / 升级 / 自动关闭 | Bun | 仅根据 Haskell 返回的 `transitions`（`trigger` / `escalate` / `resolve`）操作 `alert_history` |
| 活动告警去重 | Bun | 同一 `(host_id, device_id, rule_id)` 仅保留一条未关闭告警实例，不重复创建 |
| 告警确认（`ack`）、维护静默（`silence`）、审计日志 | Bun | 面向用户的运维动作，不回流影响 Haskell 的纯状态计算（展示与通知层抑制） |
| 告警规则 CRUD 与阈值安全校验 | Bun | 用户阈值若宽于已知硬件临界值，保存时返回警告并写审计日志 |
| 实时推送与未来通知分发（阶段 6） | Bun | 通过 WebSocket 推送状态变更 |

优点：严格遵守“Haskell 纯计算不碰 DB、Bun 唯一 DB 写入者”的架构原则；Haskell 100% 确定性可单测；边界零重叠。
缺点：Bun 需维护 `alert_states` 表并在每次调用时传入。

### 方案 B：Haskell 常驻内存持有告警状态并自行维护历史

缺点：Haskell 重启即丢失状态，且与“Haskell 不读写 SQLite”原则冲突。

## 决定

采用 **方案 A**。

## 影响

- 受影响的模块与文件：`packages/protocol/`、`apps/api/`、`core/health-engine/`、`docs/database/schema.md`、`docs/architecture/health-engine.md`。
- 协议 / 数据库 / 部署是否变更：数据库新增 `alert_states` 表（保存每条规则-设备的状态机快照）。
- 需要更新的文档：`docs/database/schema.md`、`docs/architecture/health-engine.md`。

## 验证方式

阶段 4 编写状态机纯函数测试（覆盖瞬时抖动不触发、达到 `duration` 触发、升级、迟滞恢复、缺失/过期数据不误报正常）及 Bun 端去重/确认/事务回滚测试。
