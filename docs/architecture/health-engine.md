# Haskell 健康分析引擎

## 1. 职责

纯计算组件：规则计算、阈值判断、温度趋势、SMART 变化、异常检测、多指标关联、健康评分、告警状态判定。

禁止：读取 `/sys`、`/proc`，执行采集命令，读写 SQLite，重复实现 Rust 的采集功能。

## 2. 与 Bun 的接口

已由 [ADR-0004](../decisions/0004-bun-haskell-interface.md)（accepted）确定：

- 通信方式：常驻、完全无状态的内部 HTTP JSON 服务（`GET /health`、`POST /v1/analyze`），仅监听 Docker 内网或本地回环地址，不对外暴露。
- 输入：Bun 从 SQLite 读取最新采样、规则所需历史窗口、规则与阈值配置及上次持久化的 `alert_states`，一次打包传入。
- 输出：返回 `analysis_results`、`alert_transitions` 与更新后的 `alert_states`，由 Bun 单事务写回 SQLite（引擎重启零状态丢失）。
- 超时与降级：默认超时 5 秒；Haskell 不可用或超时时，Bun 记录诊断并将分析状态标注为 `unknown`（`engine_unavailable`），绝不展示为健康。
- 输入输出均使用 `packages/protocol` 中定义的 Schema。

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
