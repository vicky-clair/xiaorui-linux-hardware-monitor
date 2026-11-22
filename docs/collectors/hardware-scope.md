# 硬件监控范围与 Rust 采集器规范

> 所有"支持时 / 接口支持时"的指标必须通过运行时能力检测决定是否采集，不得按厂商或型号推断。

## 1. 监控范围

### 1.1 CPU

温度（Package / Core / CCD，支持时）、频率、使用率、负载、功耗（支持时，如 Intel RAPL；间隔 > 60s 时自动采用 500ms 短双采样避免 32-bit 计数器回绕）、过热降频计数（`/sys/devices/system/cpu/*/thermal_throttle/{package,core}_throttle_count`，接口支持时）。

数据源：`/sys/class/hwmon/`、`/sys/class/thermal/`、`/sys/class/powercap/intel-rapl:0/`、`/sys/devices/system/cpu/*/thermal_throttle/`、`/proc/stat`、`/proc/loadavg`、CPU 驱动接口（如 coretemp、k10temp）。

### 1.2 GPU

必须自动识别 NVIDIA、AMD、Intel。

| 厂商 | 主要接口 | 指标 |
| ---- | -------- | ---- |
| NVIDIA | NVML（主），nvidia-smi（仅诊断备用） | 温度、利用率、显存使用/总量、功耗、核心/显存频率、风扇、温度限制状态 |
| AMD | amdgpu hwmon、DRM sysfs，ROCm SMI（适用时） | 温度、Hotspot（支持时）、利用率、显存、频率、功耗、风扇 |
| Intel | i915 / xe、DRM sysfs、hwmon | 温度、利用率、频率、显存/共享显存、功耗（均为支持时） |

规则：

- **NVML 必须运行时动态加载**（`dlopen`），不得在编译期链接 `libnvidia-ml`；库不存在时报告 `unsupported`，Agent 正常运行。
- Intel GPU 利用率可能依赖 perf PMU 及 `CAP_PERFMON`，权限不足时报告 `permission_denied`。
- 不得把 NVIDIA 专用接口当作通用接口；不得用单一型号推断整个厂商的支持情况；设备不存在时不得报告正常；厂商未提供的指标不得填 0。

### 1.3 主板

主板 / 芯片组 / VRM 温度（支持时）、电压、风扇转速。接口：hwmon（Super I/O 驱动等）、驱动专用接口。lm-sensors 的配置（标签、换算）可作为参考，但采集直接读 sysfs。

### 1.4 内存

总量、已用、可用、Swap、使用率、EDAC 错误统计（支持时）、DIMM 温度（需内存模块传感器与平台驱动支持，不保证可读）。

### 1.5 存储与持久化分区容量

- **块设备与 SMART / NVMe**：HDD、SATA SSD、NVMe 的型号、容量、温度、SMART 总体状态、固件版本、序列号、转速、SATA 协商速率、当前 APM 档位、写缓存/TRIM、最近盘内自检状态与小时数、错误日志计数、全部 SMART 原始属性（含 `raw_value` 与 `raw_string`）、通电时间/次数、重映射/待映射/不可校正/CRC 错误，以及 NVMe `critical_warning`、`media_errors`、`num_err_log_entries`、`unsafe_shutdowns`、`percentage_used`、`available_spare`、过热/严重高温时长与多点温度传感器。
- **持久化挂载点空间**：通过白名单只读 `/usr/bin/df -B1 -T -P` 采集持久化挂载点（如 `/`、`/media/usb`，过滤 `tmpfs`/`overlay`/Docker 挂载）的总容量、已用、可用与使用率 `%`，并绑定至所属物理磁盘稳定 ID（仅读内核超级块元数据，不唤醒待机机械盘）。

规则：

- 使用 **`smartctl -n standby --json=c -i -H -A -l selftest -l error -g all`**（smartmontools ≥ 7.0，跳过慢速 `-x` 扩展页）与 **nvme-cli JSON 输出**，不得解析人类可读文本。
- **HDD 必须使用 `smartctl -n standby`**（或等效机制）：处于待机的硬盘跳过本次采集，报告 `device_status = standby`，不得唤醒硬盘，不得报告为离线或故障。
- 必须保留 SMART 原始属性（含 raw 值与 `raw_string`），不得只保存健康百分比。
- NVMe 128 位计数器（如 Data Units Read/Written、`media_errors`、`unsafe_shutdowns`）按协议规定以十进制字符串传输。

### 1.6 风扇、电压、功耗

转速、最低转速、风扇状态、电压及上下限、电源功率（支持时）。接口：hwmon；IPMI / Redfish 属于阶段 6（ADR-0010 草案）。普通电源通常不提供数字遥测。

### 1.7 物理网络接口与系统资源

- **物理网卡（`network` 采集器）**：只读 `/sys/class/net/<iface>`，通过物理设备节点存在性过滤 `lo`/`docker*`/`br-*`/`veth*` 等虚拟接口，采集在线状态（`operstate`）、协商速率（`speed`，离线或无速率时上报 `null`）与 `statistics/{rx_errors,tx_errors,rx_dropped,tx_dropped,rx_crc_errors}`，以 PCI BDF 或接口名生成稳定 ID。
- **系统资源**：CPU / 内存使用率、运行时间、负载、系统版本、内核版本。接口：procfs、sysfs。

## 2. 硬件发现

Agent 启动时依次执行：主机身份初始化 → CPU → GPU → PCI → 内存 → 块设备 → hwmon → thermal zone → NVMe → SMART 设备 → 风扇 / 电压传感器 → 采集器能力检查。之后每 60 秒（可配置）重新发现，设备变化时更新身份信息。

## 3. 设备与传感器身份

- 不得把临时路径（如 `/sys/class/hwmon/hwmon3`，重启后可能变为 `hwmon5`）作为 ID。
- 设备 ID 优先依据：PCI BDF、WWN、NVMe 序列号、设备序列号、其他稳定硬件身份。
- 传感器 ID 由设备 ID + 传感器类型 + 稳定标签构成。
- 必须保存：设备身份、驱动名称、传感器类型、标签、原始路径、设备拓扑、来源。
- ID 格式见 [../protocol/data-model.md](../protocol/data-model.md)。

## 4. 传感器覆盖率

每个设备必须能说明：是否被发现、是否具备温度能力、是否成功读取、哪些指标不支持、哪些因权限不足无法读取、最近一次成功采集时间。状态取值使用协议中的 `capability_status`。

## 5. 采集器规范

### 5.1 接口

每个采集器实现统一生命周期：`name`、`discover`、`capabilities`、`collect`、`health_check`、`diagnostics`、`shutdown`。

- 采集调度粒度是**采集任务**（设备 × 指标组），而非整个采集器，以支持同一设备不同指标使用不同周期（如 SMART 温度 30 秒、全量属性 15 分钟）。
- 若需要 `dyn Collector`，`async fn` in trait 不能直接用于 trait object，具体形式（`async-trait`、返回 `BoxFuture` 或枚举分发）在 ADR-0008 中确定。

### 5.2 隔离

每个采集器独立：错误处理、超时、重试（有上限并退避）、运行状态、日志上下文、采集频率。单个采集器失败或 panic 不得导致 Agent 退出。

### 5.3 默认采集频率（可配置）

| 对象 | 频率 |
| ---- | ---- |
| CPU 温度、GPU 温度与利用率 | 3 秒 |
| 主板温度、风扇、内存资源、NVMe 温度 | 5 秒 |
| HDD / SATA SMART 温度 | 30 秒（遵守 standby 规则） |
| SMART 全量属性 | 15 分钟 |
| 设备重新发现 | 60 秒 |
| 硬件身份信息 | 启动及设备变化时 |

### 5.4 外部命令

调用 smartctl、nvme、nvidia-smi 等：使用参数数组、禁止拼接 Shell、设置超时、限制 stdout/stderr 大小、检查退出码（注意 smartctl 退出码是位掩码，非 0 不一定是失败）、处理命令不存在 / 设备不存在 / 权限不足、记录诊断信息。禁止无边界等待。

### 5.5 性能保护

避免：无限创建任务、并发重复扫描同一设备、高频全量 SMART、不必要的磁盘写入、无限重试、过量日志。必须具备资源保护与退避机制。

### 5.6 时间

`collected_at` 使用 UTC 墙钟时间；采集间隔与超时使用单调时钟计算。检测到墙钟回拨时记录诊断。
