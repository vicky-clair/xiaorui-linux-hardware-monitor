# SQLite 数据库规范

## 1. 写入规则

- Bun API 是唯一业务写入者；所有操作经 Repository 层。
- 所有结构变更通过 Drizzle 版本化 Migration；禁止手工修改生产表结构。
- Rust、Haskell、React 均不得访问数据库。

## 2. 表清单（第一版）

| 表 | 用途 |
| -- | ---- |
| hosts | 主机 |
| devices | 设备 |
| device_identities | 设备身份（PCI BDF、WWN、序列号等） |
| sensors | 传感器定义与能力状态 |
| sensor_readings | 原始采样 |
| sensor_readings_1m | 1 分钟聚合（min / max / avg / count） |
| sensor_readings_1h | 1 小时聚合 |
| smart_devices | SMART 设备 |
| smart_attributes | SMART 属性历史（保留 raw 值） |
| collector_status | 采集器状态 |
| ipc_cursors | 每个 Agent 实例最近处理的 sequence（用于去重） |
| health_events | 设备状态变化等事件 |
| analysis_results | Haskell 分析结果（含引擎版本、规则版本、阈值来源） |
| alert_rules | 告警规则 |
| alert_states | Haskell 告警状态机快照（按设备与规则，由 Bun 持久化，见 ADR-0004 / ADR-0007） |
| alert_history | 告警生命周期记录 |
| app_users | 用户 |
| app_sessions | 会话 |
| login_attempts | 登录失败记录（限流） |
| app_settings | 配置 |
| audit_logs | 审计日志 |

## 3. 原则

- WAL 模式、合理 busy timeout、启用外键约束。
- 采样批量写入（单事务批量插入），避免逐条提交。
- 统一 UTC 时间。
- 关键字段索引；采样表至少建立 `(sensor_id, collected_at)` 联合索引，聚合表同理。
- 数据库文件放在本地卷，不放网络文件系统。

## 4. 数据量估算与实测基准

以 100 个传感器、平均 5 秒周期估算：约 170 万行 / 天，14 天约 2,400 万行。

**阶段 2 实测基准（2026-11-20，L0 Windows 本机模拟数据，5,000 条采样 / 100 传感器，单事务批量写入 + WAL + 索引）**：

- 批量写入速率：`5,954 行/秒`（5,000 行耗时 `839.84 ms`，含首次自动建传感器；相对 ~20 行/秒目标余量 > 250×）
- 单传感器历史查询延迟（联合索引 `(sensor_id, collected_at)`）：`3.45 ms`
- 1 分钟聚合（5,000 行）：`7.46 ms`
- 库体积（含索引与 1m 聚合表）：`1,448 KiB`（约 `296 字节/行`）
- 注：L3（Debian 13.6 / N5095A）长期运行写入与空间基准将在阶段 5 实测补充。

实现约束：

- 聚合任务由 Bun 定时执行，处理窗口可重入（重复执行结果一致）。
- 清理采用分批 DELETE，避免长事务锁库；已启用 `auto_vacuum = INCREMENTAL`。
- 历史查询支持 `raw` / `1m` / `1h` 粒度切换。

## 5. 数据保留（默认值，可配置）

| 数据 | 保留时间 |
| ---- | -------- |
| 原始采样 | 14 天 |
| 1 分钟聚合 | 90 天 |
| 1 小时聚合 | 365 天 |
| SMART 历史 | 365 天 |
| 告警事件 | 长期 |
| 设备档案 | 长期 |

## 6. 备份与清理

- **例行保留清理**（按上表删除过期采样）是正常运行行为，不需要每次清理前备份，但必须：只删除已完成聚合的数据、记录清理日志。
- **非例行破坏性操作**（删表、批量删除业务数据、缩短保留期导致大量删除、Migration 中删除列/表）必须先备份，并取得项目所有者授权。
- 备份使用 SQLite 在线备份机制（如 `VACUUM INTO` 或 backup API），不得直接复制正在写入的数据库文件。
- 定期进行备份恢复演练。
