# 测试规范

## 1. 各模块最低要求

| 模块 | 必须包含 |
| ---- | -------- |
| Rust | 单元测试、传感器解析、单位换算、设备识别与稳定 ID、SMART / NVMe JSON 解析、IPC 分帧与重连、采集超时、权限错误、设备离线、HDD standby 跳过、单采集器 panic 隔离 |
| Bun | API、认证与权限、IPC 接收与去重、协议校验、数据库与 Repository、Migration、聚合与保留、WebSocket |
| Haskell | 规则、阈值来源优先级、趋势、状态机、评分、边界值（含 0 值、null、stale） |
| React | 页面渲染、组件、空数据、加载、错误、WebSocket 断开、权限不足、null 不渲染为 0 |
| 协议 | 所有示例通过 Schema；各语言对同一示例序列化 / 反序列化结果一致；大整数字符串往返无精度损失 |

## 2. 硬件模拟

必须建立模拟环境（`tests/hardware-simulation/`，fixtures 放 `tests/fixtures/`）：

- 模拟 sysfs 目录树：hwmon、thermal zone、DRM。
- CPU / GPU 温度、风扇、电压。
- smartctl / nvme-cli 的 JSON 输出样本（标注来源设备型号与工具版本）。
- 设备缺失、权限不足、设备拔除、HDD 待机、传感器返回异常值。

Rust 采集器必须支持可注入的 sysfs 根路径与命令执行器，以便使用模拟数据测试。

## 3. 结果标注

- 模拟数据必须明确标记为测试数据。
- 测试报告必须注明环境级别（见 [../development/environment.md](../development/environment.md) L0–L3）。
- 禁止把模拟测试描述为真实硬件测试；禁止把未执行的测试写成已通过。

## 4. 真实硬件样本

在 L3 实体机上采集的真实输出（脱敏序列号后）可加入 fixtures，作为回归样本，并记录硬件型号、驱动与工具版本。
