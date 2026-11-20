use agent_core::collector::{
    BoxFuture, CollectResult, CollectionTask, Collector, CollectorContext, DiscoveryResult,
};
use agent_core::identity::{build_stable_id, sensor_id};
use agent_core::utc_now_rfc3339;
use lhm_protocol::{
    CapabilityStatus, CollectorRunStatus, CollectorStatus, Device, DeviceIdentity, DeviceStatus,
    DeviceType, Diagnostic, ReadingQuality, SCHEMA_VERSION, Sensor, SensorReading, SensorType,
    Unit,
};
use std::collections::BTreeMap;
use std::sync::RwLock;
use std::time::Duration;

#[derive(Debug, Default)]
struct MemoryState {
    has_edac: bool,
    status: Option<CollectorStatus>,
}

pub struct MemoryCollector {
    host_id: String,
    device_id: String,
    state: RwLock<MemoryState>,
}

impl MemoryCollector {
    pub fn new(host_id: &str) -> Self {
        Self {
            host_id: host_id.to_owned(),
            device_id: build_stable_id(&["memory", "system", "ram"]),
            state: RwLock::new(MemoryState::default()),
        }
    }

    fn parse_meminfo(content: &str) -> BTreeMap<String, u64> {
        let mut map = BTreeMap::new();
        for line in content.lines() {
            if let Some((k, rest)) = line.split_once(':')
                && let Some(num_str) = rest.split_whitespace().next()
                && let Ok(kb) = num_str.parse::<u64>()
            {
                map.insert(k.trim().to_owned(), kb * 1024);
            }
        }
        map
    }
}

impl Collector for MemoryCollector {
    fn name(&self) -> &'static str {
        "memory"
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
            if !ctx.sysfs.exists("/proc/meminfo") {
                let mut st = self.state.write().expect("lock");
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
                return res;
            }

            let has_edac = ctx
                .sysfs
                .read_dir_names("/sys/devices/system/edac/mc")
                .map(|v| v.iter().any(|n| n.starts_with("mc")))
                .unwrap_or(false);

            let sensors = [
                ("total", "Memory Total", SensorType::Memory, Unit::Byte),
                ("used", "Memory Used", SensorType::Memory, Unit::Byte),
                (
                    "available",
                    "Memory Available",
                    SensorType::Memory,
                    Unit::Byte,
                ),
                (
                    "usage-percent",
                    "Memory Utilization",
                    SensorType::Utilization,
                    Unit::Percent,
                ),
                ("swap-total", "Swap Total", SensorType::Memory, Unit::Byte),
                ("swap-used", "Swap Used", SensorType::Memory, Unit::Byte),
            ];
            for (slug, label, stype, unit) in sensors {
                res.sensors.push(Sensor {
                    sensor_id: sensor_id(&self.device_id, "memory", slug),
                    device_id: self.device_id.clone(),
                    sensor_type: stype,
                    sensor_name: label.into(),
                    source: "procfs".into(),
                    unit,
                    capability_status: CapabilityStatus::Supported,
                    enabled: true,
                });
            }

            res.sensors.push(Sensor {
                sensor_id: sensor_id(&self.device_id, "edac", "ue-count"),
                device_id: self.device_id.clone(),
                sensor_type: SensorType::ErrorCount,
                sensor_name: "EDAC Uncorrectable Errors".into(),
                source: "edac".into(),
                unit: Unit::Count,
                capability_status: if has_edac {
                    CapabilityStatus::Supported
                } else {
                    CapabilityStatus::Unsupported
                },
                enabled: has_edac,
            });

            res.devices.push(Device {
                device_id: self.device_id.clone(),
                host_id: ctx.host_id.clone(),
                device_type: DeviceType::Memory,
                vendor: "system".into(),
                model: "System RAM".into(),
                name: "System Memory".into(),
                identity: DeviceIdentity {
                    stable: true,
                    pci_bus_id: None,
                    pci_vendor_id: None,
                    pci_device_id: None,
                    wwn: None,
                    serial: None,
                    nvme_nguid: None,
                    driver: Some("procfs".into()),
                    raw_path: Some("/proc/meminfo".into()),
                    topology: None,
                },
                capabilities: vec!["memory".into(), "swap".into()],
                device_status: DeviceStatus::Online,
            });

            res.tasks.push(CollectionTask {
                task_id: "memory:system".into(),
                collector_name: self.name().into(),
                device_id: self.device_id.clone(),
                group: "memory".into(),
                interval: Duration::from_secs(5),
                timeout: Duration::from_secs(2),
            });

            let mut st = self.state.write().expect("lock");
            st.has_edac = has_edac;
            st.status = Some(CollectorStatus {
                collector_name: self.name().into(),
                host_id: self.host_id.clone(),
                status: CollectorRunStatus::Running,
                capability_status: CapabilityStatus::Supported,
                interval_seconds: 5,
                last_run_at: Some(utc_now_rfc3339()),
                last_success_at: Some(utc_now_rfc3339()),
                consecutive_failures: 0,
                last_error_code: None,
                last_error_message: None,
            });
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
            if let Ok(content) = ctx.sysfs.read_to_string("/proc/meminfo") {
                let map = Self::parse_meminfo(&content);
                let total = map.get("MemTotal").copied();
                let avail = map
                    .get("MemAvailable")
                    .or_else(|| map.get("MemFree"))
                    .copied();
                let used = total.zip(avail).map(|(t, a)| t.saturating_sub(a));
                let pct = total.zip(used).and_then(|(t, u)| {
                    if t > 0 {
                        Some(((u as f64 / t as f64 * 100.0) * 100.0).round() / 100.0)
                    } else {
                        None
                    }
                });
                let swap_total = map.get("SwapTotal").copied();
                let swap_free = map.get("SwapFree").copied();
                let swap_used = swap_total.zip(swap_free).map(|(t, f)| t.saturating_sub(f));

                let metrics: [(&str, &str, Option<f64>, Unit); 6] = [
                    ("total", "memory_total", total.map(|v| v as f64), Unit::Byte),
                    ("used", "memory_used", used.map(|v| v as f64), Unit::Byte),
                    (
                        "available",
                        "memory_available",
                        avail.map(|v| v as f64),
                        Unit::Byte,
                    ),
                    ("usage-percent", "memory_utilization", pct, Unit::Percent),
                    (
                        "swap-total",
                        "swap_total",
                        swap_total.map(|v| v as f64),
                        Unit::Byte,
                    ),
                    (
                        "swap-used",
                        "swap_used",
                        swap_used.map(|v| v as f64),
                        Unit::Byte,
                    ),
                ];

                for (slug, metric, val, unit) in metrics {
                    res.readings.push(SensorReading {
                        schema_version: SCHEMA_VERSION.into(),
                        host_id: ctx.host_id.clone(),
                        device_id: self.device_id.clone(),
                        sensor_id: sensor_id(&self.device_id, "memory", slug),
                        metric: metric.into(),
                        value: val,
                        unit,
                        quality: if val.is_some() {
                            ReadingQuality::Valid
                        } else {
                            ReadingQuality::Missing
                        },
                        source: "procfs".into(),
                        collected_at: now.clone(),
                    });
                }
            }

            if self.state.read().expect("lock").has_edac
                && let Ok(mcs) = ctx.sysfs.read_dir_names("/sys/devices/system/edac/mc")
            {
                let mut ue_sum: u64 = 0;
                for mc in mcs.into_iter().filter(|n| n.starts_with("mc")) {
                    if let Ok(raw) = ctx
                        .sysfs
                        .read_to_string(&format!("/sys/devices/system/edac/mc/{mc}/ue_count"))
                        && let Ok(n) = raw.trim().parse::<u64>()
                    {
                        ue_sum = ue_sum.saturating_add(n);
                    }
                }
                res.readings.push(SensorReading {
                    schema_version: SCHEMA_VERSION.into(),
                    host_id: ctx.host_id.clone(),
                    device_id: self.device_id.clone(),
                    sensor_id: sensor_id(&self.device_id, "edac", "ue-count"),
                    metric: "edac_ue_count".into(),
                    value: Some(ue_sum as f64),
                    unit: Unit::Count,
                    quality: ReadingQuality::Valid,
                    source: "edac".into(),
                    collected_at: now,
                });
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
                interval_seconds: 5,
                last_run_at: None,
                last_success_at: None,
                consecutive_failures: 0,
                last_error_code: None,
                last_error_message: None,
            })
    }

    fn diagnostics(&self) -> Vec<Diagnostic> {
        Vec::new()
    }
}
