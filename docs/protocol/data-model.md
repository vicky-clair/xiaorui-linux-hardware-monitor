# 统一数据协议

## 1. 原则

- 协议定义位于 `packages/protocol/`，包含 JSON Schema、Rust / TypeScript / Haskell 类型、示例、测试、版本说明。
- **JSON Schema 是唯一事实来源**。其他语言类型通过代码生成或 CI 一致性校验保证同步（工具由 ADR-0005 确定）。
- 修改协议必须同步更新：Schema、三种语言类型、示例、测试、版本说明。禁止只改一种语言。
- 时间一律为 UTC、RFC 3339 格式（如 `2026-11-20T10:00:00Z`）。
- 本文示例仅说明格式，不代表真实硬件数据。

## 2. 状态模型（四个独立维度，禁止混用）

| 字段 | 含义 | 取值 |
| ---- | ---- | ---- |
| `capability_status` | 传感器 / 指标能否读取 | `supported`、`unsupported`、`permission_denied`、`unavailable`、`unknown` |
| `quality` | 单条读数的数据质量 | `valid`、`stale`、`sensor_fault`、`out_of_range`、`missing` |
| `device_status` | 设备当前状态 | `online`、`standby`、`offline`、`unknown` |
| `severity` | 分析 / 告警级别（仅 Haskell 输出与告警使用） | `normal`、`warning`、`critical`、`unknown` |

规则：

- 采集层（Rust）不得输出 `severity`。
- `stale` 由 Bun 根据最近采集时间判定，不由 Agent 自报。
- 新增取值属于协议变更。

## 3. 缺失值与数值

- **0 是有效值**（0 ℃、0 RPM 都是合法读数）。缺失时 `value` 为 `null`，同时 `quality` 不为 `valid`。
- 超过 2^53 的整数（如 NVMe 128 位计数器、部分 SMART raw 值）以**十进制字符串**传输，Schema 中声明为 `string` + `pattern: "^[0-9]+$"`。
- 单位使用固定枚举：`celsius`、`rpm`、`volt`、`watt`、`ampere`、`percent`、`hertz`、`byte`、`byte_per_second`、`second`、`count`。原始读数单位换算（如 hwmon 的毫摄氏度）由 Rust 完成。

## 4. ID 规则

- 格式：`<类型>-<身份来源>-<规范化身份>`，只含小写字母、数字和 `-`。
- 示例：设备 `gpu-pci-0000-01-00-0`、`disk-wwn-5000c500a1b2c3d4`；传感器 `gpu-pci-0000-01-00-0-temp-edge`。
- 禁止使用临时序号（如 `gpu-001`、`hwmon3`）。
- 无稳定身份可用时，必须在 `identity` 中标记 `stable: false`，并在诊断中说明。

## 5. 实体

### 5.1 Device

```json
{
  "device_id": "gpu-pci-0000-01-00-0",
  "host_id": "debian-host-01",
  "device_type": "gpu",
  "vendor": "nvidia",
  "model": "GPU Model",
  "name": "NVIDIA GPU",
  "identity": {
    "stable": true,
    "pci_bus_id": "0000:01:00.0",
    "pci_vendor_id": "10de",
    "pci_device_id": "0000"
  },
  "capabilities": ["temperature", "utilization", "memory", "power"],
  "device_status": "online"
}
```

### 5.2 Sensor

```json
{
  "sensor_id": "gpu-pci-0000-01-00-0-temp-edge",
  "device_id": "gpu-pci-0000-01-00-0",
  "sensor_type": "temperature",
  "sensor_name": "GPU Edge",
  "source": "nvml",
  "unit": "celsius",
  "capability_status": "supported",
  "enabled": true
}
```

### 5.3 SensorReading

```json
{
  "schema_version": "1.0",
  "host_id": "debian-host-01",
  "device_id": "gpu-pci-0000-01-00-0",
  "sensor_id": "gpu-pci-0000-01-00-0-temp-edge",
  "metric": "temperature",
  "value": 56.5,
  "unit": "celsius",
  "quality": "valid",
  "source": "nvml",
  "collected_at": "2026-11-20T10:00:00Z"
}
```

阶段 0 还需定义：Host、CollectorStatus、Diagnostic、SmartReport（保留原始属性表）。

## 6. IPC 消息

```json
{
  "protocol": "lhm-ipc",
  "schema_version": "1.0",
  "message_id": "01JD...（ULID 或 UUID）",
  "message_type": "sensor_readings",
  "host_id": "debian-host-01",
  "agent_instance_id": "每次 Agent 启动生成的唯一 ID",
  "sequence": 1024,
  "sent_at": "2026-11-20T10:00:00Z",
  "payload": { "readings": [] }
}
```

要求：

- UTF-8；单条消息长度上限（具体值在 ADR-0003 中确定）。
- **分帧方式必须在 ADR-0003 中明确**（JSON Lines 或长度前缀）。不得假设一次 `read` 等于一条完整消息。
- 去重键为 `(agent_instance_id, sequence)`：`sequence` 在单个 Agent 实例内单调递增，Agent 重启后生成新的 `agent_instance_id`。
- 校验：协议名、版本、消息类型、JSON Schema。
- 心跳、断线重连、错误消息、API 不可用时的缓冲与重放策略在 ADR-0003 中确定。
- 消息类型至少包括：`hello`（握手与版本协商）、`heartbeat`、`inventory`（设备 / 传感器清单）、`sensor_readings`、`smart_report`、`collector_status`、`diagnostic`、`error`。

## 7. 版本兼容

- `schema_version` 采用 `主版本.次版本`。
- 次版本只允许向后兼容的新增（新增可选字段、新增消息类型）；接收方必须忽略未知字段。
- 主版本变更表示不兼容，`hello` 握手时版本不兼容则拒绝连接并记录诊断。
- 每次变更记录在 `packages/protocol/CHANGELOG.md`。
