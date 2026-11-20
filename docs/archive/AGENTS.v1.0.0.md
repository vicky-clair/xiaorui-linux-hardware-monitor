# AGENTS.md

# Linux Hardware Monitor 项目开发总规范

> 文档性质：项目级 AI 编程代理执行规范
> 项目名称：Linux Hardware Monitor
> 项目定位：Linux 全硬件监控与健康分析平台
> 当前目标平台：Debian 13
> 文档版本：1.0.0
> 适用对象：Codex、Claude Code、OpenAI Codex CLI、其他 AI Coding Agent，以及参与项目开发的工程师

# 1. 项目基本信息

## 1.1 项目目标

本项目旨在开发一套面向 Linux 主机的完整硬件监控与健康分析平台。

项目以 Scrutiny 的硬盘 SMART 监控能力为参考，在此基础上扩展 CPU、GPU、主板、内存、存储设备、风扇、电压、功耗和系统资源监控。

平台必须支持：

- Linux 硬件自动发现。
- 硬件设备身份识别。
- 温度传感器自动发现。
- CPU、GPU、主板温度监控。
- NVIDIA、AMD、Intel GPU 自动识别。
- HDD、SATA SSD、NVMe 健康监控。
- SMART 属性采集。
- 风扇转速监控。
- 电压和功耗监控（硬件支持时）。
- 内存使用情况及硬件错误监控（接口支持时）。
- 系统资源监控。
- 历史数据存储。
- 实时数据推送。
- 健康分析。
- 异常检测。
- 告警管理。
- 传感器覆盖率报告。
- 采集器故障诊断。
- 局域网 Web 管理界面。

项目不以简单复制 Scrutiny 为目标，而是建立一个可扩展的 Linux Hardware Monitoring & Health Analytics 平台。

## 1.2 已确定的技术栈

以下技术栈属于项目正式架构决策。

除非项目所有者明确批准，否则 AI 编程代理不得擅自替换。

| 技术层             | 确定方案             |
| ------------------ | -------------------- |
| 操作系统           | Debian 13            |
| 项目结构           | Monorepo             |
| 前端框架           | React                |
| 前端语言           | TypeScript           |
| 前端构建           | Vite                 |
| JavaScript Runtime | Bun                  |
| API 框架           | Elysia               |
| ORM                | Drizzle ORM          |
| 数据库             | SQLite               |
| 系统采集           | Rust                 |
| 健康分析           | Haskell              |
| Haskell 构建       | Cabal                |
| 桌面客户端         | Tauri 2              |
| 图表               | ECharts              |
| Agent 服务管理     | systemd              |
| Web/API 部署       | Docker Compose       |
| 反向代理           | Nginx                |
| Agent 通信         | Unix Domain Socket   |
| Web 通信           | REST API + WebSocket |
| 数据格式           | JSON                 |
| 协议定义           | JSON Schema          |

版本管理原则：

1. 使用稳定版本。
2. 依赖版本必须经过实际验证。
3. 必须提交对应锁文件。
4. 禁止依赖未经验证的 `latest` 镜像。
5. 禁止在不同开发环境中随意升级核心依赖。
6. 核心依赖升级必须记录变更原因、兼容性和测试结果。

## 1.3 语言职责边界

### Rust

Rust 是 Linux 硬件采集 Agent 的核心语言。

负责：

- 硬件自动发现。
- 设备身份识别。
- 传感器发现。
- hwmon 读取。
- thermal 读取。
- CPU 数据采集。
- GPU 数据采集。
- 内存数据采集。
- HDD / SSD / NVMe 数据采集。
- SMART 查询和解析。
- 风扇及电压采集。
- IPMI / BMC 适配。
- 采集调度。
- 采集错误处理。
- 设备状态管理。
- IPC 通信。

禁止：

- 将 Web API 业务逻辑写入 Agent。
- 将用户管理功能写入 Agent。
- 将数据库业务写入逻辑分散到多个采集器。
- 让单个采集器故障导致整个 Agent 退出。

### Bun + TypeScript

负责：

- REST API。
- WebSocket。
- 用户认证。
- 权限管理。
- 配置管理。
- Agent IPC 接收。
- 采样数据处理。
- SQLite 数据写入。
- 历史数据查询。
- 设备管理。
- 告警管理。
- 通知管理。
- 数据保留策略。
- 审计日志。

禁止：

- 直接访问 Linux 底层硬件接口。
- 直接扫描宿主机设备。
- 通过任意 Shell 命令控制硬件。
- 将高权限设备访问能力暴露给 Web 请求。

### React + TypeScript

负责：

- Web 控制台。
- 系统总览。
- 硬件设备展示。
- 传感器展示。
- 温度曲线。
- 历史趋势。
- SMART 信息。
- 告警展示。
- 配置管理。
- 采集器诊断。

禁止：

- 在前端自行推断硬件健康状态。
- 伪造缺失的传感器数据。
- 将前端计算结果作为权威健康评分。
- 绕过 API 直接访问 Agent。

### Haskell

负责：

- 健康分析。
- 规则计算。
- 阈值判断。
- 温度趋势分析。
- SMART 变化分析。
- 异常检测。
- 多指标关联。
- 健康评分。
- 告警状态机。

禁止：

- 直接读取 Linux `/sys`。
- 直接读取 Linux `/proc`。
- 直接执行硬件采集命令。
- 直接修改 SQLite 业务数据。
- 重新实现 Rust 已经完成的硬件采集功能。

### Tauri 2

作为后续可选桌面客户端。

负责：

- 桌面应用。
- 系统托盘。
- 桌面通知。
- 多主机切换。
- Web 控制台复用。

不负责 Linux 服务端硬件采集。

# 2. 项目总体架构

## 2.1 架构原则

项目采用以下数据流：

Linux Hardware
→ Rust Agent
→ Unix Domain Socket
→ Bun API
→ SQLite
→ React Web Console

健康分析：

Bun API
→ Haskell Health Engine
→ 分析结果
→ Bun API
→ SQLite

浏览器：

React
→ REST API
→ Bun API

实时数据：

Bun API
→ WebSocket
→ React

## 2.2 强制架构约束

1. Rust Agent 必须原生运行在 Linux 宿主机。
2. Rust Agent 使用 systemd 管理。
3. Bun API 使用 Docker 部署。
4. React Web 使用 Docker 部署。
5. Haskell 分析引擎使用独立进程或容器运行。
6. API 容器不直接访问宿主机 `/sys`、`/proc` 和 `/dev`。
7. 不得通过 `privileged: true` 解决普通权限问题。
8. Agent 和 API 通过受控 Unix Socket 通信。
9. SQLite 业务写入者必须是 Bun API。
10. Rust 和 Haskell 不得绕过 API 直接写入业务数据库。
11. Agent 与 API 之间必须使用版本化协议。
12. 前端不得绕过 API 访问内部服务。

## 2.3 数据流责任

| 数据处理         | 责任组件 |
| ---------------- | -------- |
| 设备发现         | Rust     |
| 传感器发现       | Rust     |
| 硬件原始数据读取 | Rust     |
| 数据标准化       | Rust     |
| IPC 传输         | Rust     |
| 数据验证         | Bun      |
| 业务数据写入     | Bun      |
| 历史数据查询     | Bun      |
| 健康分析         | Haskell  |
| 分析结果存储     | Bun      |
| 数据展示         | React    |
| 用户交互         | React    |

# 3. 项目目录规范

项目采用 Monorepo。

正式目录结构：

```
linux-hardware-monitor/
│
├── AGENTS.md
├── README.md
├── LICENSE
├── .gitignore
│
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   ├── repositories/
│   │   │   ├── auth/
│   │   │   ├── middleware/
│   │   │   ├── websocket/
│   │   │   ├── ipc/
│   │   │   ├── config/
│   │   │   └── index.ts
│   │   ├── drizzle/
│   │   ├── tests/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── web/
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── pages/
│   │   │   ├── layouts/
│   │   │   ├── hooks/
│   │   │   ├── services/
│   │   │   ├── stores/
│   │   │   ├── charts/
│   │   │   ├── types/
│   │   │   └── utils/
│   │   ├── public/
│   │   ├── tests/
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   └── desktop/
│       └── README.md
│
├── agents/
│   └── linux-agent/
│       ├── Cargo.toml
│       ├── crates/
│       │   ├── agent-core/
│       │   ├── hardware-discovery/
│       │   ├── sensor-model/
│       │   ├── collector-hwmon/
│       │   ├── collector-thermal/
│       │   ├── collector-cpu/
│       │   ├── collector-memory/
│       │   ├── collector-storage/
│       │   ├── collector-smart/
│       │   ├── collector-nvme/
│       │   ├── collector-gpu/
│       │   ├── collector-gpu-nvidia/
│       │   ├── collector-gpu-amd/
│       │   ├── collector-gpu-intel/
│       │   ├── collector-ipmi/
│       │   ├── collector-system/
│       │   ├── agent-ipc/
│       │   └── agent-diagnostics/
│       └── tests/
│
├── core/
│   └── health-engine/
│       ├── src/
│       │   ├── Health/
│       │   └── Main.hs
│       ├── test/
│       ├── health-engine.cabal
│       └── cabal.project
│
├── packages/
│   └── protocol/
│       ├── json-schema/
│       ├── examples/
│       ├── typescript/
│       ├── rust/
│       ├── haskell/
│       └── README.md
│
├── deploy/
│   ├── docker/
│   ├── systemd/
│   ├── nginx/
│   └── scripts/
│
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── protocol/
│   ├── collectors/
│   ├── security/
│   ├── database/
│   ├── deployment/
│   └── decisions/
│
├── scripts/
│
└── tests/
    ├── integration/
    ├── fixtures/
    ├── hardware-simulation/
    └── protocol/
```

目录职责：

- `apps/`：用户可见应用。
- `agents/`：Linux 原生采集程序。
- `core/`：独立分析核心。
- `packages/`：跨语言共享协议。
- `deploy/`：部署相关文件。
- `docs/`：项目文档。
- `scripts/`：开发、构建、维护脚本。
- `tests/`：跨模块测试。

如果实际开发需要新增目录，必须遵循现有职责边界，并更新对应文档。

禁止无理由随意调整项目目录结构。

# 4. 硬件监控范围

## 4.1 CPU

采集指标：

- CPU 温度。
- CPU Package 温度。
- CPU Core 温度。
- CPU CCD 温度（支持时）。
- CPU 频率。
- CPU 使用率。
- CPU 负载。
- CPU 功耗（支持时）。
- CPU 节流或温度限制状态（接口支持时）。

数据源：

- `/sys/class/hwmon/`
- `/sys/class/thermal/`
- `/proc/stat`
- `/proc/loadavg`
- CPU 驱动接口。

不同 CPU 平台支持的指标不同，必须通过能力检测决定实际采集内容。

## 4.2 GPU

必须具备 NVIDIA、AMD、Intel 三种 GPU 的自动识别能力。

### NVIDIA

优先使用 NVML。

备用诊断接口：

- nvidia-smi。

监控指标：

- GPU 温度。
- GPU 利用率。
- 显存使用量。
- 显存总量。
- GPU 功耗。
- GPU 核心频率。
- 显存频率。
- 风扇转速。
- 温度限制状态（支持时）。

### AMD

主要使用：

- amdgpu hwmon。
- ROCm SMI（适用时）。

监控指标：

- GPU 温度。
- Hotspot 温度（支持时）。
- GPU 利用率。
- 显存信息。
- GPU 频率。
- 功耗。
- 风扇转速。

### Intel

主要使用：

- i915。
- xe。
- DRM sysfs。
- hwmon。

监控指标：

- GPU 温度（支持时）。
- GPU 利用率（接口支持时）。
- GPU 频率。
- 显存或共享显存相关信息（接口支持时）。
- GPU 功耗（支持时）。

禁止：

- 将 NVIDIA 专用接口当作通用 GPU 接口。
- 将某一 GPU 型号的支持情况推断为整个厂商都支持。
- 在设备不存在时报告虚假的正常状态。
- 将厂商未提供的指标填成 0。

## 4.3 主板

采集：

- 主板温度。
- 芯片组温度。
- VRM 温度（支持时）。
- 电压。
- 风扇转速。

主要接口：

- hwmon。
- lm-sensors。
- 驱动提供的专用接口。

## 4.4 内存

采集：

- 总内存。
- 已使用内存。
- 可用内存。
- Swap。
- 内存使用率。
- EDAC 错误统计（支持时）。
- DIMM 温度（支持时）。

必须明确：

DIMM 温度需要内存模块传感器和平台驱动支持，不能保证所有内存条都可以读取。

## 4.5 存储设备

支持：

- HDD。
- SATA SSD。
- NVMe SSD。

采集：

- 设备型号。
- 容量。
- 温度。
- SMART 总体状态。
- SMART 属性。
- 通电时间。
- 通电次数。
- 重映射扇区。
- 待映射扇区。
- 不可校正错误。
- CRC 错误。
- NVMe Critical Warning。
- NVMe Media Errors。
- NVMe Percentage Used。
- NVMe Available Spare。

主要工具：

- smartctl。
- nvme-cli。
- Linux block sysfs。

必须保留 SMART 原始属性，不能只保存健康百分比。

## 4.6 风扇和电压

采集：

- 风扇转速。
- 最低转速。
- 风扇状态。
- 电压。
- 电压上下限。
- 电源功率（支持时）。

主要接口：

- hwmon。
- IPMI。
- Redfish。

普通电源不一定提供数字遥测数据。

## 4.7 系统资源

采集：

- CPU 使用率。
- 内存使用率。
- 磁盘读写。
- 网络流量。
- 系统运行时间。
- 系统负载。
- 系统版本。
- 内核版本。

主要接口：

- procfs。
- sysfs。

# 5. 硬件发现与传感器规则

## 5.1 自动发现

Agent 启动后必须执行：

1. 主机身份初始化。
2. CPU 设备发现。
3. GPU 设备发现。
4. PCI 设备发现。
5. 内存设备发现。
6. 块设备发现。
7. hwmon 设备发现。
8. thermal zone 发现。
9. NVMe 设备发现。
10. SMART 设备发现。
11. 风扇和电压传感器发现。
12. 采集器能力检查。

## 5.2 传感器识别

不能仅通过临时路径识别传感器。

例如：

```
/sys/class/hwmon/hwmon3
```

可能在系统重启后变为：

```
/sys/class/hwmon/hwmon5
```

因此必须保存：

- 设备身份。
- 驱动名称。
- 传感器类型。
- 传感器标签。
- 原始路径。
- 设备拓扑信息。
- 传感器来源。

## 5.3 稳定 ID

设备 ID 优先使用：

- PCI BDF。
- WWN。
- NVMe 序列号。
- 设备序列号。
- 其他可稳定识别的硬件身份。

传感器 ID 必须关联设备 ID，并且应尽量保持稳定。

不能把临时 hwmon 索引直接作为数据库主键。

## 5.4 传感器覆盖率

必须建立传感器覆盖率统计。

状态包括：

- supported
- unsupported
- unavailable
- permission_denied
- device_offline
- sensor_fault
- unknown

每个设备都必须能够说明：

- 是否被发现。
- 是否具备温度能力。
- 是否成功读取。
- 哪些指标不支持。
- 哪些指标因权限不足无法读取。
- 最近一次成功采集时间。

# 6. Rust Agent 开发规范

## 6.1 采集器接口

每个采集器必须实现统一的生命周期。

逻辑接口：

```
trait Collector {
    fn name(&self) -> &'static str;

    async fn discover(&self) -> Result<Vec<Device>>;

    async fn capabilities(
        &self,
        device: &Device
    ) -> Result<Vec<Capability>>;

    async fn collect(
        &self,
        device: &Device
    ) -> Result<Vec<SensorReading>>;

    async fn health_check(&self) -> CollectorHealth;

    async fn diagnostics(&self) -> Vec<Diagnostic>;

    async fn shutdown(&self) -> Result<()>;
}
```

上述代码是接口设计示意。正式实现时，应根据选定的 Rust async runtime、错误类型和对象生命周期确定实际 Trait 形式。

## 6.2 采集器隔离

每个采集器必须独立运行。

要求：

- 独立错误处理。
- 独立超时。
- 独立重试。
- 独立运行状态。
- 独立日志上下文。
- 独立采集频率。

一个采集器失败不能导致其他采集器停止。

## 6.3 采集频率

默认建议：

| 对象                  | 频率             |
| --------------------- | ---------------- |
| CPU 温度              | 3 秒             |
| GPU 温度              | 3 秒             |
| GPU 利用率            | 3 秒             |
| 主板温度              | 5 秒             |
| 风扇转速              | 5 秒             |
| 内存资源              | 5 秒             |
| NVMe 温度             | 5 秒             |
| HDD / SATA SMART 温度 | 30 秒            |
| SMART 全量属性        | 15 分钟          |
| 设备重新发现          | 60 秒            |
| 硬件身份信息          | 启动和设备变化时 |

频率必须可配置。

不得为所有传感器使用同一个采集周期。

## 6.4 外部命令执行

调用 smartctl、nvme、nvidia-smi 等外部程序时：

- 必须使用参数数组。
- 禁止将未经验证的用户输入拼接到 Shell 命令。
- 必须设置超时。
- 必须限制标准输出和错误输出大小。
- 必须检查退出状态。
- 必须记录必要的诊断信息。
- 必须处理命令不存在的情况。
- 必须处理设备不存在的情况。
- 必须处理权限不足的情况。

禁止使用无边界等待的外部进程调用。

## 6.5 采集性能

必须避免：

- 无限创建异步任务。
- 重复并发扫描同一设备。
- 高频执行完整 SMART 检查。
- 不必要的磁盘写入。
- 无限制的错误重试。
- 过量日志输出。

Agent 应具有资源保护和采集退避机制。

# 7. 统一数据协议

## 7.1 协议原则

所有组件必须遵循共享协议。

协议定义统一存放于：

```
packages/protocol/
```

必须包含：

- JSON Schema。
- Rust 类型。
- TypeScript 类型。
- Haskell 类型。
- 测试数据。
- 协议版本说明。

修改协议必须同步更新对应语言实现和测试样例。

## 7.2 Device

```
{
  "device_id": "gpu-pci-0000-01-00-0",
  "host_id": "debian-host-01",
  "device_type": "gpu",
  "vendor": "nvidia",
  "model": "GPU Model",
  "name": "NVIDIA GPU",
  "identity": {
    "pci_bus_id": "0000:01:00.0",
    "vendor_id": "10de",
    "device_id": "0000"
  },
  "capabilities": [
    "temperature",
    "utilization",
    "memory",
    "power"
  ],
  "status": "online"
}
```

## 7.3 Sensor

```
{
  "sensor_id": "gpu-001-temp-edge",
  "device_id": "gpu-001",
  "sensor_type": "temperature",
  "sensor_name": "GPU Edge",
  "source": "nvml",
  "unit": "celsius",
  "capability_status": "supported",
  "enabled": true
}
```

## 7.4 SensorReading

```
{
  "schema_version": "1.0",
  "host_id": "debian-host-01",
  "device_id": "gpu-001",
  "sensor_id": "gpu-001-temp-edge",
  "metric": "temperature",
  "value": 56.5,
  "unit": "celsius",
  "quality": "valid",
  "source": "nvml",
  "collected_at": "2026-11-20T10:00:00Z",
  "sequence": 1024
}
```

示例中的数据仅用于说明协议格式。

## 7.5 质量和状态

至少支持：

- normal
- warning
- critical
- unsupported
- unavailable
- permission_denied
- device_offline
- sensor_fault
- stale
- unknown

必须区分：

1. 指标值。
2. 数据质量。
3. 设备状态。
4. 告警状态。

不能将这四种不同概念混为一个字段。

0℃是有效温度值，禁止用 0 代表没有数据。

## 7.6 IPC

Unix Socket：

```
/run/linux-hardware-monitor/agent.sock
```

消息结构：

```
{
  "protocol": "lhm-ipc",
  "schema_version": "1.0",
  "message_id": "msg-000001",
  "message_type": "sensor_readings",
  "host_id": "debian-host-01",
  "sequence": 1024,
  "sent_at": "2026-11-20T10:00:00Z",
  "payload": {
    "readings": []
  }
}
```

要求：

- UTF-8。
- 消息长度限制。
- 协议版本校验。
- 消息类型校验。
- JSON Schema 校验。
- 序列号管理。
- 错误消息处理。
- 心跳。
- 断线重连。
- 重复消息检测。

具体采用 JSON Lines、长度前缀或其他消息分帧方式，必须在协议实现前形成明确设计，不能假定 Unix Socket 的一次 read 就等于一条完整 JSON 消息。

# 8. Bun API 开发规范

## 8.1 API 路径

统一使用：

```
/api/v1
```

核心 API：

| 方法 | 路径                         | 用途       |
| ---- | ---------------------------- | ---------- |
| GET  | /api/v1/system/overview      | 总览       |
| GET  | /api/v1/hosts                | 主机列表   |
| GET  | /api/v1/devices              | 设备列表   |
| GET  | /api/v1/devices/:id          | 设备详情   |
| GET  | /api/v1/sensors              | 传感器列表 |
| GET  | /api/v1/sensors/:id/readings | 历史采样   |
| GET  | /api/v1/storage              | 存储健康   |
| GET  | /api/v1/alerts               | 告警列表   |
| GET  | /api/v1/collectors           | 采集器状态 |
| GET  | /api/v1/diagnostics          | 诊断       |
| GET  | /api/v1/config               | 配置       |
| PUT  | /api/v1/config               | 更新配置   |
| GET  | /api/v1/stream               | WebSocket  |

实际实现时应补充分页、过滤、排序、时间范围和错误码定义。

## 8.2 API 统一响应

```
{
  "success": true,
  "data": {},
  "error": null,
  "request_id": "req-000001",
  "timestamp": "2026-11-20T10:00:00Z"
}
```

错误响应必须包含稳定的错误代码，不得仅依赖自然语言错误信息。

## 8.3 数据库写入规则

Bun 是唯一业务写入者。

所有数据库操作通过 Repository 层完成。

禁止：

- 在 HTTP Route 内直接编写复杂 SQL。
- 在 React 前端直接访问数据库。
- 让 Rust 直接写入 SQLite。
- 让 Haskell 直接写入 SQLite。
- 绕过数据库迁移机制修改生产表结构。

所有数据库变更必须通过版本化 Migration。

# 9. SQLite 数据库规范

## 9.1 数据表

第一版至少需要：

- hosts
- devices
- device_identities
- sensors
- sensor_readings
- smart_devices
- smart_attributes
- collector_status
- health_events
- alert_rules
- alert_history
- analysis_results
- app_users
- app_settings
- audit_logs

## 9.2 数据库原则

- WAL 模式。
- 合理设置 busy timeout。
- 批量写入。
- 事务控制。
- 外键约束。
- 关键字段索引。
- 统一 UTC 时间。
- 版本化 Migration。
- 定期备份。
- 备份恢复测试。

采样记录至少建立：

```
(sensor_id, collected_at)
```

联合索引。

## 9.3 数据保留

初始默认值：

| 数据       | 保留时间 |
| ---------- | -------- |
| 原始采样   | 14 天    |
| 1 分钟聚合 | 90 天    |
| 1 小时聚合 | 365 天   |
| SMART 历史 | 365 天   |
| 告警事件   | 长期     |
| 设备档案   | 长期     |

保留策略必须可配置。

禁止在没有备份的情况下执行破坏性清理。

# 10. Haskell 健康分析规范

## 10.1 模块

至少包含：

- Health.Types
- Health.Protocol
- Health.Rules
- Health.Thresholds
- Health.Trends
- Health.Anomaly
- Health.Correlation
- Health.Scoring
- Health.StateMachine
- Health.Engine

## 10.2 分析规则

规则必须可配置。

每条规则至少包含：

- rule_id
- metric
- device_type
- operator
- threshold
- unit
- duration
- severity
- enabled

## 10.3 阈值规则

不得把某个硬件型号的温度阈值直接推广到所有设备。

优先级：

1. 硬件厂商提供的限制。
2. 驱动或设备暴露的限制。
3. 用户针对具体设备设置的阈值。
4. 有明确依据的通用默认阈值。

无法获得可靠阈值时，必须明确说明。

## 10.4 健康评分

健康评分必须：

- 有可解释的计算依据。
- 区分硬件类别。
- 保留原始指标。
- 记录分析版本。
- 不支持的指标不扣分。
- 数据过期不代表健康。
- 传感器故障不等于硬件故障。
- 输出评分因素和原因。

禁止只输出一个百分比而不说明依据。

# 11. React Web 开发规范

## 11.1 页面规划

第一版至少包括：

1. 系统总览。
2. CPU 监控。
3. GPU 监控。
4. 主板传感器。
5. 内存监控。
6. 存储健康。
7. NVMe 监控。
8. 温度历史。
9. 风扇和电压。
10. 告警中心。
11. 硬件设备列表。
12. 传感器覆盖率。
13. 采集器诊断。
14. 系统配置。

## 11.2 UI 规则

- 使用统一设计系统。
- 组件职责单一。
- 统一加载状态。
- 统一空数据状态。
- 统一错误状态。
- 统一权限不足提示。
- 统一时间格式。
- 温度显示必须带单位。
- 不支持的指标必须明确展示。
- 不允许把缺失数据渲染成 0。
- 历史图表必须支持时间范围。
- WebSocket 断开时必须展示连接状态。

## 11.3 实时数据

使用 WebSocket 推送增量数据。

禁止每隔几秒重新加载所有历史数据。

历史数据使用 REST API 查询。

图表必须考虑大量采样点的聚合和降采样。

# 12. 安全规范

## 12.1 用户认证

必须具备：

- 用户名。
- 密码。
- Argon2id 密码哈希。
- 会话管理。
- 登录失败限制。
- 权限控制。
- 操作审计。

## 12.2 网络安全

- API 默认不直接暴露到不必要的网络接口。
- WebSocket 必须认证。
- 校验 Origin。
- 使用 HTTPS。
- 不在源码中存储密钥。
- 不向前端返回敏感配置。
- 不允许未认证用户修改配置。

## 12.3 Agent 安全

- 最小权限。
- Socket 访问控制。
- 采集器独立授权。
- 外部命令超时。
- 命令参数安全。
- 文件路径限制。
- 输入数据校验。

禁止：

- 任意 Shell 执行接口。
- 任意文件读取接口。
- 任意路径写入接口。
- 不必要的 root 权限。
- 无条件开放所有设备访问权限。

## 12.4 Docker 安全

禁止未经论证使用：

- privileged: true
- host network
- Docker socket 挂载
- 整个宿主机根目录挂载
- 无必要的设备映射
- 无必要的 root 容器

# 13. 日志和错误处理

## 13.1 日志级别

统一支持：

- TRACE
- DEBUG
- INFO
- WARN
- ERROR

生产环境默认 INFO。

## 13.2 日志内容

至少记录：

- 时间。
- 组件。
- 日志级别。
- 主机 ID。
- 设备 ID（适用时）。
- 采集器名称。
- 错误代码。
- 关联请求 ID（适用时）。

## 13.3 错误处理

每个错误必须尽可能包含：

- 稳定错误代码。
- 错误来源。
- 发生时间。
- 设备身份。
- 诊断信息。
- 可行的修复建议。

禁止：

- 静默吞掉异常。
- 伪造成功状态。
- 无限重试。
- 记录无意义的重复错误。
- 把权限不足当作硬件故障。

# 14. 测试规范

## 14.1 Rust 测试

至少包含：

- 单元测试。
- 传感器解析测试。
- 单位转换测试。
- 设备识别测试。
- SMART 解析测试。
- IPC 测试。
- 采集超时测试。
- 权限错误测试。
- 设备离线测试。

## 14.2 Bun 测试

至少包含：

- API 测试。
- 认证测试。
- IPC 接收测试。
- 协议校验测试。
- 数据库测试。
- Migration 测试。
- 数据保留测试。
- WebSocket 测试。

## 14.3 Haskell 测试

至少包含：

- 规则测试。
- 阈值测试。
- 趋势测试。
- 状态机测试。
- 评分测试。
- 边界值测试。

## 14.4 React 测试

至少包含：

- 页面渲染测试。
- 组件测试。
- 空数据测试。
- 加载状态测试。
- 错误状态测试。
- WebSocket 断开测试。
- 权限不足展示测试。

## 14.5 硬件模拟

必须建立模拟测试环境。

模拟：

- hwmon 目录。
- thermal zone。
- CPU 温度。
- GPU 温度。
- 风扇转速。
- 电压。
- SMART 输出。
- NVMe 数据。
- 设备缺失。
- 权限不足。
- 设备拔除。

模拟数据必须明确标记为测试数据。

禁止将模拟数据当作真实硬件测试结果。

# 15. 开发流程与阶段管理

项目严格采用阶段开发。

## 阶段 0：基础工程

任务：

- 创建 Monorepo。
- 创建 Rust workspace。
- 创建 Bun API。
- 创建 React Web。
- 创建 Haskell 工程。
- 建立协议目录。
- 建立测试框架。
- 建立 CI。
- 建立开发文档。

验收：

- 所有工程能够独立构建。
- 共享协议可被各语言解析。
- CI 能执行基础检查。

## 阶段 1：Rust Agent

任务：

- 设备发现。
- hwmon。
- thermal。
- CPU。
- 内存。
- 存储。
- SMART。
- NVMe。
- GPU 自动识别。
- 传感器覆盖率。
- 采集器诊断。
- IPC。

验收：

- Debian 13 原生运行。
- 设备能够自动发现。
- 支持的传感器能够正确采集。
- 不支持的传感器正确报告。
- 采集错误可诊断。
- 单个采集器故障不会导致 Agent 退出。

## 阶段 2：Bun API

任务：

- REST API。
- WebSocket。
- IPC。
- SQLite。
- 数据持久化。
- 设备管理。
- 历史数据。
- 认证。
- 配置。

验收：

- Agent 数据正常接收。
- 数据库正常写入。
- API 能查询历史数据。
- 服务重启后数据保留。

## 阶段 3：React Web

任务：

- 总览。
- CPU。
- GPU。
- 主板。
- 内存。
- 存储。
- SMART。
- 温度曲线。
- 告警。
- 设备诊断。

验收：

- 局域网可访问。
- 实时数据正常显示。
- 历史数据正常查询。
- 缺失数据正确显示。

## 阶段 4：Haskell

任务：

- 规则引擎。
- 阈值管理。
- 趋势分析。
- 异常检测。
- 关联分析。
- 健康评分。
- 告警状态机。

验收：

- 分析结果有明确依据。
- 规则可配置。
- 分析结果可追溯。

## 阶段 5：生产部署

任务：

- systemd。
- Docker Compose。
- Nginx。
- HTTPS。
- 数据备份。
- 数据恢复。
- 权限控制。
- 性能测试。
- 长期运行测试。

验收：

- 服务自动启动。
- 容器重建不丢数据。
- Agent 重启自动恢复。
- 数据库恢复成功。
- 连续运行测试通过。

## 阶段 6：扩展

任务：

- IPMI。
- Redfish。
- 多主机。
- 通知。
- Tauri。
- 数据导出。
- 高级异常检测。

不得在前一阶段尚未验收时，擅自宣布进入下一阶段。

# 16. AI 编程代理行为规范

本章节是所有 AI Coding Agent 必须遵守的强制规则。

## 16.1 开始任务前

每次开始开发任务前，必须：

1. 阅读本文件。
2. 阅读相关模块 README。
3. 检查现有目录结构。
4. 检查现有实现。
5. 检查当前分支和 Git 工作区。
6. 确认当前开发阶段。
7. 明确任务涉及哪些模块。
8. 确认是否会影响协议、数据库或部署配置。

不得在没有检查现有代码的情况下直接重写文件。

不得假设项目尚未实现某个功能。

## 16.2 技术栈纪律

禁止擅自：

- 更换 Rust 为 Go。
- 更换 Bun 为 Node.js。
- 更换 React 为 Vue。
- 更换 Haskell 为 Python。
- 更换 SQLite 为 PostgreSQL。
- 更换 Elysia 为其他 API 框架。
- 更换 Drizzle ORM。
- 删除 Tauri 2 规划。
- 改变 Agent 原生运行架构。

如果确实存在技术问题，必须先提出技术评估和替代方案，等待项目所有者批准。

## 16.3 事实准确性

必须遵守：

1. 不得虚构 Linux 接口。
2. 不得虚构硬件传感器。
3. 不得虚构 GPU 支持能力。
4. 不得虚构 SMART 属性。
5. 不得虚构命令输出。
6. 不得虚构测试结果。
7. 不得虚构性能数据。
8. 不得把未经验证的功能描述为已经实现。
9. 不得把理论兼容性描述为实际测试通过。
10. 不得把模拟测试描述为真实硬件测试。

涉及外部库、API、硬件驱动和系统接口时，应优先核对官方文档及当前版本。

无法确认时，必须明确标记为待验证。

## 16.4 文件修改纪律

修改文件前：

- 确认文件用途。
- 检查引用关系。
- 检查是否影响其他模块。
- 评估是否需要测试。
- 评估是否需要迁移。

禁止：

- 无理由重写整个项目。
- 删除未理解的代码。
- 修改无关文件。
- 删除用户已有配置。
- 覆盖用户数据。
- 删除数据库。
- 删除历史记录。
- 修改密钥。
- 修改宿主机配置而不告知用户。

修改后：

- 检查差异。
- 运行相关格式化。
- 运行相关测试。
- 检查构建结果。
- 更新相关文档。

## 16.5 数据库纪律

涉及数据库时：

1. 必须创建 Migration。
2. 不得直接修改生产数据库结构。
3. 必须考虑旧数据兼容。
4. 必须考虑回滚。
5. 必须考虑备份。
6. 不得删除现有数据。
7. 不得未经授权执行 DROP TABLE。
8. 不得在没有迁移说明时修改字段语义。

## 16.6 协议纪律

修改共享协议时：

- 更新 JSON Schema。
- 更新 Rust 类型。
- 更新 TypeScript 类型。
- 更新 Haskell 类型。
- 更新协议示例。
- 更新协议测试。
- 更新版本说明。

禁止只修改其中一种语言的定义。

## 16.7 命令执行纪律

在 Linux 主机上执行命令前，必须判断：

- 是否需要 sudo。
- 是否会修改系统。
- 是否会影响 Docker。
- 是否会影响 systemd。
- 是否会改变文件权限。
- 是否会造成数据丢失。
- 是否需要备份。

对于破坏性操作，必须先向用户解释影响并取得明确授权。

不得擅自执行：

- 系统重启。
- 系统关机。
- 磁盘格式化。
- 分区修改。
- 数据库删除。
- 容器数据目录删除。
- systemd 服务停用。
- Docker 数据清理。
- 生产配置覆盖。

## 16.8 任务完成报告

每个开发任务结束时，必须报告：

### 本次完成内容

列出新增和修改的功能。

### 修改文件

列出实际修改的文件及用途。

### 技术实现

说明核心实现和架构边界。

### 测试结果

分别列出：

- 已通过测试。
- 未通过测试。
- 未执行测试。
- 仅模拟验证的功能。
- 尚未在真实硬件上验证的功能。

### 风险与限制

列出已知问题和待解决事项。

### 下一步

给出符合当前阶段的后续任务。

不得把没有执行的测试写成已通过。

# 17. 文档规范

以下文档必须随着项目发展维护：

| 文档                     | 内容                   |
| ------------------------ | ---------------------- |
| README.md                | 项目介绍和快速开始     |
| AGENTS.md                | AI 开发总规范          |
| architecture/overview.md | 总体架构               |
| architecture/decisions/  | 架构决策记录           |
| protocol/                | 共享数据协议           |
| api/                     | API 说明               |
| collectors/              | 硬件采集器说明         |
| database/                | 数据库结构和迁移       |
| deployment/              | Docker 和 systemd 部署 |
| security/                | 安全设计               |
| testing/                 | 测试方案               |
| changelog.md             | 版本变化               |

文档必须与代码保持一致。

禁止保留明显过期的部署命令和配置示例。

# 18. Git 与版本管理

必须：

- 使用 Git。
- 保持清晰的提交记录。
- 使用有意义的提交信息。
- 重要阶段建立 Tag。
- 重大架构修改建立 ADR。
- 提交依赖锁文件。
- 不提交数据库文件。
- 不提交密钥。
- 不提交生产日志。
- 不提交临时构建产物。

建议提交格式：

```
feat(agent): add hwmon discovery
feat(api): add sensor history endpoint
feat(web): add hardware overview
fix(smart): handle permission denied
refactor(protocol): normalize sensor status
test(agent): add mock sysfs tests
docs(architecture): update data flow
```

# 19. 性能与可靠性目标

以下数值是待验证的工程目标，不是已实现的性能承诺。

| 指标             | 初始目标        |
| ---------------- | --------------- |
| CPU 高频采集周期 | 3 秒            |
| GPU 高频采集周期 | 3 秒            |
| Agent 心跳       | 10 秒           |
| 设备发现周期     | 60 秒           |
| API 实时推送     | 采集后尽快推送  |
| Agent CPU 占用   | 目标低于 2%     |
| Agent 内存占用   | 目标低于 150 MB |
| 长期运行测试     | 至少 7 天       |

必须通过实际测试验证：

- Agent CPU 使用率。
- Agent 内存使用量。
- 采集延迟。
- 数据库写入性能。
- WebSocket 延迟。
- 采集失败恢复时间。
- 长时间运行稳定性。

不得在没有测试的情况下宣称达到这些目标。

# 20. 第一阶段启动任务

项目创建后，AI 编程代理必须按照以下顺序执行。

## Task 001：项目结构检查

- 检查当前工作目录。
- 检查 Git 状态。
- 检查已有文件。
- 检查开发环境。
- 确认是否存在已有项目内容。

## Task 002：工程初始化

- 初始化 Monorepo。
- 初始化 Rust workspace。
- 初始化 Bun API。
- 初始化 React + Vite。
- 初始化 Haskell Cabal。
- 建立共享协议目录。

## Task 003：协议基础

- 定义 Host。
- 定义 Device。
- 定义 Sensor。
- 定义 SensorReading。
- 定义 CollectorStatus。
- 定义 Diagnostic。
- 定义 IPC Message。
- 建立 JSON Schema。
- 建立跨语言协议测试。

## Task 004：架构文档

建立：

- 总体架构。
- 目录结构。
- 数据流。
- 语言职责。
- IPC 设计。
- 数据库初步设计。
- 安全设计。

## Task 005：基础 CI

检查：

- Rust 格式。
- Rust 编译。
- Rust 测试。
- TypeScript 类型检查。
- Bun 测试。
- React 构建。
- Haskell 编译。
- Haskell 测试。
- 协议校验。

## Task 006：阶段验收

只有前面任务通过，才允许进入 Rust 硬件采集器的正式开发。

# 21. 最终强制原则

所有 AI 编程代理必须始终遵循以下原则：

1. 正确性优先于开发速度。
2. 安全性优先于功能便利。
3. 实际硬件能力优先于理论假设。
4. 统一协议优先于模块独立定义。
5. 可测试性优先于一次性实现。
6. 数据完整性优先于激进重构。
7. 模块隔离优先于功能耦合。
8. 最小权限优先于简单提权。
9. 真实测试优先于模拟成功。
10. 可维护性优先于短期代码数量。

项目必须始终保持：

- 架构明确。
- 模块边界清晰。
- 数据协议统一。
- 错误可诊断。
- 设备可追踪。
- 采集可恢复。
- 数据可备份。
- 结果可验证。
- 部署可重复。
- 升级可维护。

**任何 AI 编程代理不得为了快速完成任务而违反本规范。**

当任务要求与本规范冲突时，应暂停冲突部分，向项目所有者说明冲突内容、技术影响和建议方案，等待明确决定。

**文档结束**

项目名称：Linux Hardware Monitor
文档：AGENTS.md
版本：1.0.0