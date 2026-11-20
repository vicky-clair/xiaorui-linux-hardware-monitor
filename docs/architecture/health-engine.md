# Haskell 健康分析引擎

## 1. 职责

纯计算组件：规则计算、阈值判断、温度趋势、SMART 变化、异常检测、多指标关联、健康评分、告警状态判定。

禁止：读取 `/sys`、`/proc`，执行采集命令，读写 SQLite，重复实现 Rust 的采集功能。

## 2. 与 Bun 的接口

**待 ADR-0004 确定**，需要回答：

- 通信方式（stdin/stdout JSON Lines、HTTP、Unix Socket 等）。
- 调用模式：常驻服务还是按批次调用。
- 输入：Bun 每次提供多少历史窗口（原始采样 / 聚合数据），如何避免大批量传输。
- 状态：告警状态机的状态由谁持久化（建议 Haskell 无状态，状态由 Bun 存储并随请求传入，结果中返回新状态）。
- 超时与失败：Haskell 不可用时 Bun 的降级行为（不得把"未分析"展示为"健康"）。
- 输入输出都必须使用 `packages/protocol` 中定义的 Schema。

## 3. 模块

至少包含：`Health.Types`、`Health.Protocol`、`Health.Rules`、`Health.Thresholds`、`Health.Trends`、`Health.Anomaly`、`Health.Correlation`、`Health.Scoring`、`Health.StateMachine`、`Health.Engine`。

## 4. 规则

规则必须可配置，每条规则至少包含：`rule_id`、`metric`、`device_type`、`operator`、`threshold`、`unit`、`duration`、`severity`、`enabled`。

## 5. 阈值来源

不得把某个硬件型号的阈值推广到所有设备。阈值按以下方式确定：

1. **硬件临界值**（厂商或驱动/设备暴露的 crit/max）——作为安全上限参考。
2. **用户针对具体设备设置的阈值**——优先生效。若用户阈值比硬件临界值更宽松，必须在配置时给出警告并记录审计日志。
3. **有明确依据的通用默认阈值**——仅在以上都缺失时使用，并注明来源。
4. 无法获得可靠阈值时，结果中明确标记"无可靠阈值"，不得静默使用猜测值。

每个分析结果必须记录所用阈值的来源。

## 6. 健康评分

- 有可解释的计算依据，输出评分因素与原因。
- 区分硬件类别。
- 保留原始指标引用，记录分析引擎版本与规则版本。
- 不支持的指标不扣分。
- 数据过期（stale）不代表健康，应输出"数据不足"。
- 传感器故障不等于硬件故障。
- 禁止只输出一个百分比而不说明依据。
