//! Linux hwmon 通用传感器采集器：读取 `/sys/class/hwmon/` 下的温度、风扇转速、电压、功耗与电流，按硬件拓扑生成稳定设备 ID（禁止临时 `hwmonN` 编号）。

use agent_core::collector::{
    BoxFuture, CollectResult, CollectionTask, Collector, CollectorContext, DiscoveryResult,
};
use agent_core::identity::{build_stable_id, extract_pci_bdf, normalize_slug, sensor_id};
use agent_core::sysfs::SysFsError;
use agent_core::utc_now_rfc3339;
use lhm_protocol::{
    CapabilityStatus, CollectorRunStatus, CollectorStatus, Device, DeviceIdentity, DeviceStatus,
    DeviceType, Diagnostic, DiagnosticLevel, ReadingQuality, SCHEMA_VERSION, Sensor, SensorReading,
    SensorType, Unit,
};
use std::collections::BTreeMap;
use std::sync::RwLock;
use std::time::Duration;
use uuid::Uuid;

#[derive(Debug, Clone)]
struct HwmonSensorEntry {
    sensor_id: String,
    device_id: String,
    input_path: String,
    metric: String,
    unit: Unit,
    scale_div: f64,
}

#[derive(Debug, Default)]
struct HwmonState {
    tasks: BTreeMap<String, Vec<HwmonSensorEntry>>,
    status: Option<CollectorStatus>,
    cap: Option<CapabilityStatus>,
    diagnostics: Vec<Diagnostic>,
}

pub struct HwmonCollector {
    host_id: String,
    state: RwLock<HwmonState>,
}

impl HwmonCollector {
    pub fn new(host_id: &str) -> Self {
        Self {
            host_id: host_id.to_owned(),
            state: RwLock::new(HwmonState::default()),
        }
    }

    fn classify_channel(file: &str) -> Option<(&str, SensorType, &'static str, Unit, f64)> {
        let prefix = file.strip_suffix("_input")?;
        if prefix.starts_with("temp") {
            Some((
                prefix,
                SensorType::Temperature,
                "temperature",
                Unit::Celsius,
                1000.0,
            ))
        } else if prefix.starts_with("fan") {
            Some((prefix, SensorType::FanSpeed, "fan_speed", Unit::Rpm, 1.0))
        } else if prefix.starts_with("in") {
            Some((prefix, SensorType::Voltage, "voltage", Unit::Volt, 1000.0))
        } else if prefix.starts_with("power") {
            Some((prefix, SensorType::Power, "power", Unit::Watt, 1_000_000.0))
        } else if prefix.starts_with("curr") {
            Some((prefix, SensorType::Current, "current", Unit::Ampere, 1000.0))
        } else {
            None
        }
    }

    fn infer_device_type(driver_name: &str) -> DeviceType {
        match driver_name {
            "coretemp" | "k10temp" | "zenpower" | "cpu_thermal" => DeviceType::Cpu,
            "amdgpu" | "nouveau" | "i915" | "xe" => DeviceType::Gpu,
            "nvme" | "drivetemp" => DeviceType::Storage,
            _ => DeviceType::Motherboard,
        }
    }
}

impl Collector for HwmonCollector {
    fn name(&self) -> &'static str {
        "hwmon"
    }

    fn capabilities(&self) -> CapabilityStatus {
        self.state
            .read()
            .expect("lock")
            .cap
            .unwrap_or(CapabilityStatus::Unknown)
    }

    fn discover<'a>(&'a self, ctx: &'a CollectorContext) -> BoxFuture<'a, DiscoveryResult> {
        Box::pin(async move {
            let mut result = DiscoveryResult::default();
            let mut task_map: BTreeMap<String, Vec<HwmonSensorEntry>> = BTreeMap::new();
            let mut diagnostics = Vec::new();

            let entries = match ctx.sysfs.read_dir_names("/sys/class/hwmon") {
                Ok(names) => names,
                Err(SysFsError::NotFound(_)) => {
                    let mut st = self.state.write().expect("lock");
                    st.cap = Some(CapabilityStatus::Unsupported);
                    st.status = Some(CollectorStatus {
                        collector_name: self.name().into(),
                        host_id: self.host_id.clone(),
                        status: CollectorRunStatus::Stopped,
                        capability_status: CapabilityStatus::Unsupported,
                        interval_seconds: 5,
                        last_run_at: Some(utc_now_rfc3339()),
                        last_success_at: None,
                        consecutive_failures: 0,
                        last_error_code: None,
                        last_error_message: None,
                    });
                    return result;
                }
                Err(e) => {
                    diagnostics.push(Diagnostic {
                        diagnostic_id: format!("diag-{}", Uuid::new_v4()),
                        host_id: ctx.host_id.clone(),
                        device_id: None,
                        collector_name: Some(self.name().into()),
                        level: DiagnosticLevel::Warn,
                        error_code: "HWMON_DISCOVERY_ERROR".into(),
                        source: "hwmon".into(),
                        message: e.to_string(),
                        remediation: Some("Verify /sys/class/hwmon readability".into()),
                        occurred_at: utc_now_rfc3339(),
                        details: None,
                    });
                    result.diagnostics = diagnostics;
                    return result;
                }
            };

            for hwmon in entries {
                if !hwmon.starts_with("hwmon") {
                    continue;
                }
                let base = format!("/sys/class/hwmon/{hwmon}");
                let driver_name = ctx
                    .sysfs
                    .read_to_string(&format!("{base}/name"))
                    .map(|s| s.trim().to_owned())
                    .unwrap_or_else(|_| "unknown".to_owned());

                let device_link = ctx.sysfs.canonicalize(&format!("{base}/device")).ok();
                let pci_bdf = device_link.as_deref().and_then(extract_pci_bdf);

                let (device_id, stable) = if let Some(ref bdf) = pci_bdf {
                    (build_stable_id(&["hwmon", "pci", bdf, &driver_name]), true)
                } else if let Some(ref topo) = device_link {
                    let leaf = topo.rsplit('/').next().unwrap_or(&driver_name);
                    (build_stable_id(&["hwmon", &driver_name, leaf]), true)
                } else {
                    diagnostics.push(Diagnostic {
                        diagnostic_id: format!("diag-{}", Uuid::new_v4()),
                        host_id: ctx.host_id.clone(),
                        device_id: None,
                        collector_name: Some(self.name().into()),
                        level: DiagnosticLevel::Info,
                        error_code: "HWMON_UNSTABLE_IDENTITY".into(),
                        source: "hwmon".into(),
                        message: format!(
                            "hwmon entry '{base}' ({driver_name}) has no backing device symlink"
                        ),
                        remediation: None,
                        occurred_at: utc_now_rfc3339(),
                        details: None,
                    });
                    (build_stable_id(&["hwmon", "fallback", &driver_name]), false)
                };

                let files = match ctx.sysfs.read_dir_names(&base) {
                    Ok(f) => f,
                    Err(_) => continue,
                };

                let mut entries_for_dev = Vec::new();
                let mut capabilities = Vec::new();

                for file in &files {
                    let Some((prefix, sen_type, metric, unit, scale_div)) =
                        Self::classify_channel(file)
                    else {
                        continue;
                    };
                    let input_path = format!("{base}/{file}");
                    let label = ctx
                        .sysfs
                        .read_to_string(&format!("{base}/{prefix}_label"))
                        .map(|s| s.trim().to_owned())
                        .ok()
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| prefix.to_owned());

                    let cap = match ctx.sysfs.read_to_string(&input_path) {
                        Ok(_) => CapabilityStatus::Supported,
                        Err(SysFsError::PermissionDenied(_)) => CapabilityStatus::PermissionDenied,
                        Err(SysFsError::NotFound(_)) => CapabilityStatus::Unavailable,
                        Err(_) => CapabilityStatus::Unknown,
                    };

                    let sid = sensor_id(&device_id, metric, &normalize_slug(&label));
                    if !capabilities.contains(&metric.to_owned()) {
                        capabilities.push(metric.to_owned());
                    }

                    result.sensors.push(Sensor {
                        sensor_id: sid.clone(),
                        device_id: device_id.clone(),
                        sensor_type: sen_type,
                        sensor_name: label,
                        source: "hwmon".into(),
                        unit,
                        capability_status: cap,
                        enabled: cap == CapabilityStatus::Supported,
                    });

                    entries_for_dev.push(HwmonSensorEntry {
                        sensor_id: sid,
                        device_id: device_id.clone(),
                        input_path,
                        metric: metric.to_owned(),
                        unit,
                        scale_div,
                    });
                }

                if entries_for_dev.is_empty() {
                    continue;
                }

                let dev_type = Self::infer_device_type(&driver_name);
                let interval = if dev_type == DeviceType::Cpu || dev_type == DeviceType::Gpu {
                    Duration::from_secs(3)
                } else {
                    Duration::from_secs(5)
                };

                result.devices.push(Device {
                    device_id: device_id.clone(),
                    host_id: ctx.host_id.clone(),
                    device_type: dev_type,
                    vendor: driver_name.clone(),
                    model: driver_name.clone(),
                    name: format!("hwmon:{driver_name}"),
                    identity: DeviceIdentity {
                        stable,
                        pci_bus_id: pci_bdf,
                        pci_vendor_id: None,
                        pci_device_id: None,
                        wwn: None,
                        serial: None,
                        nvme_nguid: None,
                        driver: Some(driver_name),
                        raw_path: Some(base),
                        topology: device_link,
                    },
                    capabilities,
                    device_status: DeviceStatus::Online,
                });

                let task_id = format!("hwmon:{device_id}");
                result.tasks.push(CollectionTask {
                    task_id: task_id.clone(),
                    collector_name: self.name().into(),
                    device_id,
                    group: "hwmon".into(),
                    interval,
                    timeout: Duration::from_secs(2),
                });
                task_map.insert(task_id, entries_for_dev);
            }

            let cap = if result.sensors.is_empty() {
                CapabilityStatus::Unsupported
            } else {
                CapabilityStatus::Supported
            };

            let mut st = self.state.write().expect("lock");
            st.tasks = task_map;
            st.cap = Some(cap);
            st.diagnostics = diagnostics.clone();
            st.status = Some(CollectorStatus {
                collector_name: self.name().into(),
                host_id: self.host_id.clone(),
                status: CollectorRunStatus::Running,
                capability_status: cap,
                interval_seconds: 3,
                last_run_at: Some(utc_now_rfc3339()),
                last_success_at: Some(utc_now_rfc3339()),
                consecutive_failures: 0,
                last_error_code: None,
                last_error_message: None,
            });
            result.diagnostics = diagnostics;
            result
        })
    }

    fn collect<'a>(
        &'a self,
        task: &'a CollectionTask,
        ctx: &'a CollectorContext,
    ) -> BoxFuture<'a, CollectResult> {
        Box::pin(async move {
            let entries = self
                .state
                .read()
                .expect("lock")
                .tasks
                .get(&task.task_id)
                .cloned()
                .unwrap_or_default();

            let mut res = CollectResult::default();
            let now = utc_now_rfc3339();

            for entry in entries {
                match ctx.sysfs.read_to_string(&entry.input_path) {
                    Ok(raw) => match raw.trim().parse::<f64>() {
                        Ok(num) if num.is_finite() => {
                            let val = num / entry.scale_div;
                            res.readings.push(SensorReading {
                                schema_version: SCHEMA_VERSION.into(),
                                host_id: ctx.host_id.clone(),
                                device_id: entry.device_id,
                                sensor_id: entry.sensor_id,
                                metric: entry.metric,
                                value: Some(val),
                                unit: entry.unit,
                                quality: ReadingQuality::Valid,
                                source: "hwmon".into(),
                                collected_at: now.clone(),
                            });
                        }
                        _ => {
                            res.readings.push(SensorReading {
                                schema_version: SCHEMA_VERSION.into(),
                                host_id: ctx.host_id.clone(),
                                device_id: entry.device_id.clone(),
                                sensor_id: entry.sensor_id,
                                metric: entry.metric,
                                value: None,
                                unit: entry.unit,
                                quality: ReadingQuality::SensorFault,
                                source: "hwmon".into(),
                                collected_at: now.clone(),
                            });
                            res.diagnostics.push(Diagnostic {
                                diagnostic_id: format!("diag-{}", Uuid::new_v4()),
                                host_id: ctx.host_id.clone(),
                                device_id: Some(entry.device_id),
                                collector_name: Some(self.name().into()),
                                level: DiagnosticLevel::Warn,
                                error_code: "HWMON_PARSE_ERROR".into(),
                                source: "hwmon".into(),
                                message: format!("Non-numeric hwmon value at {}", entry.input_path),
                                remediation: None,
                                occurred_at: now.clone(),
                                details: None,
                            });
                        }
                    },
                    Err(SysFsError::PermissionDenied(_)) => {
                        res.readings.push(SensorReading {
                            schema_version: SCHEMA_VERSION.into(),
                            host_id: ctx.host_id.clone(),
                            device_id: entry.device_id.clone(),
                            sensor_id: entry.sensor_id,
                            metric: entry.metric,
                            value: None,
                            unit: entry.unit,
                            quality: ReadingQuality::Missing,
                            source: "hwmon".into(),
                            collected_at: now.clone(),
                        });
                        res.diagnostics.push(Diagnostic {
                            diagnostic_id: format!("diag-{}", Uuid::new_v4()),
                            host_id: ctx.host_id.clone(),
                            device_id: Some(entry.device_id),
                            collector_name: Some(self.name().into()),
                            level: DiagnosticLevel::Warn,
                            error_code: "HWMON_PERMISSION_DENIED".into(),
                            source: "hwmon".into(),
                            message: format!("Permission denied reading {}", entry.input_path),
                            remediation: Some("Verify sysfs read permissions".into()),
                            occurred_at: now.clone(),
                            details: None,
                        });
                    }
                    Err(_) => {
                        res.readings.push(SensorReading {
                            schema_version: SCHEMA_VERSION.into(),
                            host_id: ctx.host_id.clone(),
                            device_id: entry.device_id,
                            sensor_id: entry.sensor_id,
                            metric: entry.metric,
                            value: None,
                            unit: entry.unit,
                            quality: ReadingQuality::Missing,
                            source: "hwmon".into(),
                            collected_at: now.clone(),
                        });
                    }
                }
            }
            res
        })
    }

    fn health_check(&self) -> CollectorStatus {
        self.state
            .read()
            .expect("lock")
            .status
            .clone()
            .unwrap_or_else(|| CollectorStatus {
                collector_name: self.name().into(),
                host_id: self.host_id.clone(),
                status: CollectorRunStatus::Stopped,
                capability_status: CapabilityStatus::Unknown,
                interval_seconds: 3,
                last_run_at: None,
                last_success_at: None,
                consecutive_failures: 0,
                last_error_code: None,
                last_error_message: None,
            })
    }

    fn diagnostics(&self) -> Vec<Diagnostic> {
        self.state.read().expect("lock").diagnostics.clone()
    }
}
