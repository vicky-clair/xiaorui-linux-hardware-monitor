use agent_core::collector::{
    BoxFuture, CollectResult, CollectionTask, Collector, CollectorContext, DiscoveryResult,
};
use agent_core::identity::{build_stable_id, sensor_id};
use agent_core::sysfs::SysFsError;
use agent_core::utc_now_rfc3339;
use lhm_protocol::{
    CapabilityStatus, CollectorRunStatus, CollectorStatus, Device, DeviceIdentity, DeviceStatus,
    DeviceType, Diagnostic, DiagnosticLevel, ReadingQuality, SCHEMA_VERSION, Sensor, SensorReading,
    SensorType, Unit,
};
use std::sync::RwLock;
use std::time::{Duration, Instant};
use uuid::Uuid;

#[derive(Debug, Clone, Copy)]
struct CpuTimes {
    total: u64,
    idle: u64,
}

#[derive(Debug, Default)]
struct CpuState {
    prev_times: Option<CpuTimes>,
    prev_rapl: Option<(u64, Instant)>,
    rapl_cap: Option<CapabilityStatus>,
    status: Option<CollectorStatus>,
    diagnostics: Vec<Diagnostic>,
}

pub struct CpuCollector {
    host_id: String,
    device_id: String,
    state: RwLock<CpuState>,
}

impl CpuCollector {
    pub fn new(host_id: &str) -> Self {
        Self {
            host_id: host_id.to_owned(),
            device_id: build_stable_id(&["cpu", "system", "0"]),
            state: RwLock::new(CpuState::default()),
        }
    }

    fn parse_proc_stat(content: &str) -> Option<CpuTimes> {
        let line = content.lines().find(|l| l.starts_with("cpu "))?;
        let nums: Vec<u64> = line
            .split_whitespace()
            .skip(1)
            .filter_map(|s| s.parse::<u64>().ok())
            .collect();
        if nums.len() < 4 {
            return None;
        }
        let idle = nums[3] + nums.get(4).copied().unwrap_or(0);
        let total: u64 = nums.iter().sum();
        Some(CpuTimes { total, idle })
    }

    fn parse_cpu_model(cpuinfo: &str) -> (String, String) {
        let mut vendor = "unknown".to_owned();
        let mut model = "CPU".to_owned();
        for line in cpuinfo.lines() {
            if let Some((k, v)) = line.split_once(':') {
                match k.trim() {
                    "vendor_id" if vendor == "unknown" => vendor = v.trim().to_owned(),
                    "model name" if model == "CPU" => model = v.trim().to_owned(),
                    _ => {}
                }
            }
        }
        (vendor, model)
    }
}

impl Collector for CpuCollector {
    fn name(&self) -> &'static str {
        "cpu"
    }

    fn capabilities(&self) -> CapabilityStatus {
        self.state
            .read()
            .expect("lock")
            .status
            .as_ref()
            .map(|s| s.capability_status)
            .unwrap_or(CapabilityStatus::Unknown)
    }

    fn discover<'a>(&'a self, ctx: &'a CollectorContext) -> BoxFuture<'a, DiscoveryResult> {
        Box::pin(async move {
            let mut res = DiscoveryResult::default();
            let mut diags = Vec::new();

            let has_stat = ctx.sysfs.exists("/proc/stat");
            let has_loadavg = ctx.sysfs.exists("/proc/loadavg");
            if !has_stat && !has_loadavg {
                let mut st = self.state.write().expect("lock");
                st.status = Some(CollectorStatus {
                    collector_name: self.name().into(),
                    host_id: self.host_id.clone(),
                    status: CollectorRunStatus::Stopped,
                    capability_status: CapabilityStatus::Unsupported,
                    interval_seconds: 3,
                    last_run_at: Some(utc_now_rfc3339()),
                    last_success_at: None,
                    consecutive_failures: 0,
                    last_error_code: None,
                    last_error_message: None,
                });
                return res;
            }

            let (vendor, model) = ctx
                .sysfs
                .read_to_string("/proc/cpuinfo")
                .map(|c| Self::parse_cpu_model(&c))
                .unwrap_or_else(|_| ("unknown".into(), "CPU".into()));

            let rapl_path = "/sys/class/powercap/intel-rapl:0/energy_uj";
            let rapl_cap = match ctx.sysfs.read_to_string(rapl_path) {
                Ok(_) => CapabilityStatus::Supported,
                Err(SysFsError::PermissionDenied(_)) => {
                    diags.push(Diagnostic {
                        diagnostic_id: format!("diag-{}", Uuid::new_v4()),
                        host_id: ctx.host_id.clone(),
                        device_id: Some(self.device_id.clone()),
                        collector_name: Some(self.name().into()),
                        level: DiagnosticLevel::Info,
                        error_code: "RAPL_PERMISSION_DENIED".into(),
                        source: "powercap".into(),
                        message: format!("Permission denied reading Intel RAPL at {rapl_path}"),
                        remediation: Some(
                            "Grant read access to intel-rapl energy_uj if CPU package power telemetry is desired".into(),
                        ),
                        occurred_at: utc_now_rfc3339(),
                        details: None,
                    });
                    CapabilityStatus::PermissionDenied
                }
                Err(SysFsError::NotFound(_)) => CapabilityStatus::Unsupported,
                Err(_) => CapabilityStatus::Unavailable,
            };

            let mut capabilities = Vec::new();
            if has_stat {
                capabilities.push("utilization".into());
                res.sensors.push(Sensor {
                    sensor_id: sensor_id(&self.device_id, "utilization", "total"),
                    device_id: self.device_id.clone(),
                    sensor_type: SensorType::Utilization,
                    sensor_name: "CPU Utilization".into(),
                    source: "procfs".into(),
                    unit: Unit::Percent,
                    capability_status: CapabilityStatus::Supported,
                    enabled: true,
                });
            }
            if has_loadavg {
                capabilities.push("load".into());
                for (suffix, label) in [("1m", "Load 1m"), ("5m", "Load 5m"), ("15m", "Load 15m")] {
                    res.sensors.push(Sensor {
                        sensor_id: sensor_id(&self.device_id, "load", suffix),
                        device_id: self.device_id.clone(),
                        sensor_type: SensorType::Other,
                        sensor_name: label.into(),
                        source: "procfs".into(),
                        unit: Unit::Count,
                        capability_status: CapabilityStatus::Supported,
                        enabled: true,
                    });
                }
            }
            if ctx
                .sysfs
                .exists("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq")
            {
                capabilities.push("frequency".into());
                res.sensors.push(Sensor {
                    sensor_id: sensor_id(&self.device_id, "frequency", "avg"),
                    device_id: self.device_id.clone(),
                    sensor_type: SensorType::Frequency,
                    sensor_name: "CPU Frequency (Avg)".into(),
                    source: "sysfs".into(),
                    unit: Unit::Hertz,
                    capability_status: CapabilityStatus::Supported,
                    enabled: true,
                });
            }
            if rapl_cap != CapabilityStatus::Unsupported {
                capabilities.push("power".into());
                res.sensors.push(Sensor {
                    sensor_id: sensor_id(&self.device_id, "power", "package-rapl"),
                    device_id: self.device_id.clone(),
                    sensor_type: SensorType::Power,
                    sensor_name: "CPU Package Power (RAPL)".into(),
                    source: "powercap".into(),
                    unit: Unit::Watt,
                    capability_status: rapl_cap,
                    enabled: rapl_cap == CapabilityStatus::Supported,
                });
            }

            res.devices.push(Device {
                device_id: self.device_id.clone(),
                host_id: ctx.host_id.clone(),
                device_type: DeviceType::Cpu,
                vendor,
                model: model.clone(),
                name: model,
                identity: DeviceIdentity {
                    stable: true,
                    pci_bus_id: None,
                    pci_vendor_id: None,
                    pci_device_id: None,
                    wwn: None,
                    serial: None,
                    nvme_nguid: None,
                    driver: Some("procfs".into()),
                    raw_path: Some("/proc/stat".into()),
                    topology: None,
                },
                capabilities,
                device_status: DeviceStatus::Online,
            });

            res.tasks.push(CollectionTask {
                task_id: "cpu:system".into(),
                collector_name: self.name().into(),
                device_id: self.device_id.clone(),
                group: "cpu".into(),
                interval: Duration::from_secs(3),
                timeout: Duration::from_secs(2),
            });

            // Prime initial /proc/stat sample so first collect can compute utilization if called later
            let initial_times = ctx
                .sysfs
                .read_to_string("/proc/stat")
                .ok()
                .and_then(|c| Self::parse_proc_stat(&c));

            let mut st = self.state.write().expect("lock");
            if st.prev_times.is_none() {
                st.prev_times = initial_times;
            }
            st.rapl_cap = Some(rapl_cap);
            st.diagnostics = diags.clone();
            st.status = Some(CollectorStatus {
                collector_name: self.name().into(),
                host_id: self.host_id.clone(),
                status: CollectorRunStatus::Running,
                capability_status: CapabilityStatus::Supported,
                interval_seconds: 3,
                last_run_at: Some(utc_now_rfc3339()),
                last_success_at: Some(utc_now_rfc3339()),
                consecutive_failures: 0,
                last_error_code: None,
                last_error_message: None,
            });
            res.diagnostics = diags;
            res
        })
    }

    fn collect<'a>(
        &'a self,
        _task: &'a CollectionTask,
        ctx: &'a CollectorContext,
    ) -> BoxFuture<'a, CollectResult> {
        Box::pin(async move {
            let mut res = CollectResult::default();
            let now = utc_now_rfc3339();

            // 1. CPU utilization from /proc/stat
            if let Ok(stat) = ctx.sysfs.read_to_string("/proc/stat")
                && let Some(cur) = Self::parse_proc_stat(&stat)
            {
                let prev = {
                    let mut st = self.state.write().expect("lock");
                    let p = st.prev_times;
                    st.prev_times = Some(cur);
                    p
                };
                let (val, quality) = if let Some(p) = prev {
                    let dt = cur.total.saturating_sub(p.total);
                    let di = cur.idle.saturating_sub(p.idle);
                    if dt > 0 {
                        let busy = dt.saturating_sub(di) as f64 / dt as f64 * 100.0;
                        (Some((busy * 100.0).round() / 100.0), ReadingQuality::Valid)
                    } else if cur.total > 0 {
                        let busy =
                            cur.total.saturating_sub(cur.idle) as f64 / cur.total as f64 * 100.0;
                        (Some((busy * 100.0).round() / 100.0), ReadingQuality::Valid)
                    } else {
                        (None, ReadingQuality::Missing)
                    }
                } else if cur.total > 0 {
                    let busy = cur.total.saturating_sub(cur.idle) as f64 / cur.total as f64 * 100.0;
                    (Some((busy * 100.0).round() / 100.0), ReadingQuality::Valid)
                } else {
                    (None, ReadingQuality::Missing)
                };
                res.readings.push(SensorReading {
                    schema_version: SCHEMA_VERSION.into(),
                    host_id: ctx.host_id.clone(),
                    device_id: self.device_id.clone(),
                    sensor_id: sensor_id(&self.device_id, "utilization", "total"),
                    metric: "utilization".into(),
                    value: val,
                    unit: Unit::Percent,
                    quality,
                    source: "procfs".into(),
                    collected_at: now.clone(),
                });
            }

            // 2. Load average from /proc/loadavg
            if let Ok(load) = ctx.sysfs.read_to_string("/proc/loadavg") {
                let parts: Vec<&str> = load.split_whitespace().collect();
                for (idx, suffix) in [(0, "1m"), (1, "5m"), (2, "15m")] {
                    let parsed = parts.get(idx).and_then(|s| s.parse::<f64>().ok());
                    res.readings.push(SensorReading {
                        schema_version: SCHEMA_VERSION.into(),
                        host_id: ctx.host_id.clone(),
                        device_id: self.device_id.clone(),
                        sensor_id: sensor_id(&self.device_id, "load", suffix),
                        metric: format!("load_{suffix}"),
                        value: parsed,
                        unit: Unit::Count,
                        quality: if parsed.is_some() {
                            ReadingQuality::Valid
                        } else {
                            ReadingQuality::SensorFault
                        },
                        source: "procfs".into(),
                        collected_at: now.clone(),
                    });
                }
            }

            // 3. CPU frequency average (kHz -> Hz)
            if let Ok(entries) = ctx.sysfs.read_dir_names("/sys/devices/system/cpu") {
                let mut sum_hz = 0.0;
                let mut count = 0usize;
                for name in entries {
                    if name.starts_with("cpu")
                        && name[3..].bytes().all(|b| b.is_ascii_digit())
                        && !name[3..].is_empty()
                        && let Ok(khz) = ctx.sysfs.read_to_string(&format!(
                            "/sys/devices/system/cpu/{name}/cpufreq/scaling_cur_freq"
                        ))
                        && let Ok(v) = khz.trim().parse::<f64>()
                    {
                        sum_hz += v * 1000.0;
                        count += 1;
                    }
                }
                if count > 0 {
                    res.readings.push(SensorReading {
                        schema_version: SCHEMA_VERSION.into(),
                        host_id: ctx.host_id.clone(),
                        device_id: self.device_id.clone(),
                        sensor_id: sensor_id(&self.device_id, "frequency", "avg"),
                        metric: "frequency".into(),
                        value: Some(sum_hz / count as f64),
                        unit: Unit::Hertz,
                        quality: ReadingQuality::Valid,
                        source: "sysfs".into(),
                        collected_at: now.clone(),
                    });
                }
            }

            // 4. Optional Intel RAPL energy delta -> Watts
            let rapl_cap = self.state.read().expect("lock").rapl_cap;
            if rapl_cap == Some(CapabilityStatus::Supported)
                && let Ok(raw) = ctx
                    .sysfs
                    .read_to_string("/sys/class/powercap/intel-rapl:0/energy_uj")
                && let Ok(uj) = raw.trim().parse::<u64>()
            {
                let ts = Instant::now();
                let prev = {
                    let mut st = self.state.write().expect("lock");
                    let p = st.prev_rapl;
                    st.prev_rapl = Some((uj, ts));
                    p
                };
                if let Some((prev_uj, prev_ts)) = prev {
                    let dt = ts.duration_since(prev_ts).as_secs_f64();
                    if dt > 0.0 && uj >= prev_uj {
                        let watts = ((uj - prev_uj) as f64 / 1_000_000.0) / dt;
                        res.readings.push(SensorReading {
                            schema_version: SCHEMA_VERSION.into(),
                            host_id: ctx.host_id.clone(),
                            device_id: self.device_id.clone(),
                            sensor_id: sensor_id(&self.device_id, "power", "package-rapl"),
                            metric: "power".into(),
                            value: Some(watts),
                            unit: Unit::Watt,
                            quality: ReadingQuality::Valid,
                            source: "powercap".into(),
                            collected_at: now,
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
