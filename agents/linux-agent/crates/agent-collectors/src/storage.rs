use agent_core::collector::{
    BoxFuture, CollectResult, CollectionTask, Collector, CollectorContext, DiscoveryResult,
};
use agent_core::identity::{
    build_stable_id, disk_path_id, disk_serial_id, disk_wwn_id, extract_pci_bdf, sensor_id,
};
use agent_core::sysfs::SysFs;
use agent_core::utc_now_rfc3339;
use lhm_protocol::{
    CapabilityStatus, CollectorRunStatus, CollectorStatus, Device, DeviceIdentity, DeviceStatus,
    DeviceType, Diagnostic, DiagnosticLevel, ReadingQuality, SCHEMA_VERSION, Sensor, SensorReading,
    SensorType, Unit,
};
use std::sync::RwLock;
use std::time::Duration;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct DiscoveredBlockDevice {
    pub block_name: String,
    pub dev_path: String,
    pub device_id: String,
    pub stable: bool,
    pub vendor: String,
    pub model: String,
    pub wwn: Option<String>,
    pub serial: Option<String>,
    pub pci_bus_id: Option<String>,
    pub topology: Option<String>,
    pub rotational: bool,
    pub capacity_bytes: Option<u64>,
    pub is_nvme: bool,
}

pub fn is_monitored_block_device(name: &str) -> bool {
    (name.starts_with("sd") && name.len() >= 3 && !name.ends_with(|c: char| c.is_ascii_digit()))
        || (name.starts_with("nvme") && name.contains('n') && !name.contains('p'))
        || (name.starts_with("vd")
            && name.len() >= 3
            && !name.ends_with(|c: char| c.is_ascii_digit()))
}

pub fn discover_block_devices(sysfs: &dyn SysFs) -> Vec<DiscoveredBlockDevice> {
    let Ok(names) = sysfs.read_dir_names("/sys/block") else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for name in names {
        if !is_monitored_block_device(&name) {
            continue;
        }
        let base = format!("/sys/block/{name}");
        let vendor = sysfs
            .read_to_string(&format!("{base}/device/vendor"))
            .map(|s| s.trim().to_owned())
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                if name.starts_with("nvme") {
                    "nvme".into()
                } else {
                    "unknown".into()
                }
            });
        let model = sysfs
            .read_to_string(&format!("{base}/device/model"))
            .map(|s| s.trim().to_owned())
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| name.clone());
        let wwn = sysfs
            .read_to_string(&format!("{base}/wwid"))
            .or_else(|_| sysfs.read_to_string(&format!("{base}/device/wwid")))
            .map(|s| s.trim().to_owned())
            .ok()
            .filter(|s| !s.is_empty());
        let serial = sysfs
            .read_to_string(&format!("{base}/device/serial"))
            .map(|s| s.trim().to_owned())
            .ok()
            .filter(|s| !s.is_empty());
        let topology = sysfs.canonicalize(&format!("{base}/device")).ok();
        let pci_bus_id = topology.as_deref().and_then(extract_pci_bdf);
        let rotational = sysfs
            .read_to_string(&format!("{base}/queue/rotational"))
            .map(|s| s.trim() == "1")
            .unwrap_or(false);
        let capacity_bytes = sysfs
            .read_to_string(&format!("{base}/size"))
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok())
            .map(|sectors| sectors.saturating_mul(512));

        let (device_id, stable) = if let Some(ref w) = wwn {
            (disk_wwn_id(w), true)
        } else if let Some(ref s) = serial {
            (disk_serial_id(s), true)
        } else if let Some(ref topo) = topology {
            let trimmed = topo.trim_start_matches("/sys/devices/");
            (disk_path_id(trimmed), true)
        } else {
            (build_stable_id(&["disk", "fallback", &name]), false)
        };

        out.push(DiscoveredBlockDevice {
            is_nvme: name.starts_with("nvme"),
            dev_path: format!("/dev/{name}"),
            block_name: name,
            device_id,
            stable,
            vendor,
            model,
            wwn,
            serial,
            pci_bus_id,
            topology,
            rotational,
            capacity_bytes,
        });
    }
    out
}

#[derive(Debug, Default)]
struct StorageState {
    disks: Vec<DiscoveredBlockDevice>,
    status: Option<CollectorStatus>,
}

pub struct StorageCollector {
    host_id: String,
    state: RwLock<StorageState>,
}

impl StorageCollector {
    pub fn new(host_id: &str) -> Self {
        Self {
            host_id: host_id.to_owned(),
            state: RwLock::new(StorageState::default()),
        }
    }
}

impl Collector for StorageCollector {
    fn name(&self) -> &'static str {
        "storage"
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
            let disks = discover_block_devices(ctx.sysfs.as_ref());

            for d in &disks {
                if !d.stable {
                    res.diagnostics.push(Diagnostic {
                        diagnostic_id: format!("diag-{}", Uuid::new_v4()),
                        host_id: ctx.host_id.clone(),
                        device_id: Some(d.device_id.clone()),
                        collector_name: Some(self.name().into()),
                        level: DiagnosticLevel::Info,
                        error_code: "DISK_UNSTABLE_IDENTITY".into(),
                        source: "storage".into(),
                        message: format!(
                            "Block device {} lacked WWN/serial/topology; using fallback ID",
                            d.dev_path
                        ),
                        remediation: None,
                        occurred_at: utc_now_rfc3339(),
                        details: None,
                    });
                }

                res.devices.push(Device {
                    device_id: d.device_id.clone(),
                    host_id: ctx.host_id.clone(),
                    device_type: DeviceType::Storage,
                    vendor: d.vendor.clone(),
                    model: d.model.clone(),
                    name: format!("{} ({})", d.model, d.block_name),
                    identity: DeviceIdentity {
                        stable: d.stable,
                        pci_bus_id: d.pci_bus_id.clone(),
                        pci_vendor_id: None,
                        pci_device_id: None,
                        wwn: d.wwn.clone(),
                        serial: d.serial.clone(),
                        nvme_nguid: if d.is_nvme { d.wwn.clone() } else { None },
                        driver: Some(if d.is_nvme { "nvme" } else { "sd" }.into()),
                        raw_path: Some(format!("/sys/block/{}", d.block_name)),
                        topology: d.topology.clone(),
                    },
                    capabilities: vec!["capacity".into()],
                    device_status: DeviceStatus::Online,
                });

                res.sensors.push(Sensor {
                    sensor_id: sensor_id(&d.device_id, "capacity", "bytes"),
                    device_id: d.device_id.clone(),
                    sensor_type: SensorType::Other,
                    sensor_name: "Disk Capacity".into(),
                    source: "sysfs".into(),
                    unit: Unit::Byte,
                    capability_status: if d.capacity_bytes.is_some() {
                        CapabilityStatus::Supported
                    } else {
                        CapabilityStatus::Unavailable
                    },
                    enabled: d.capacity_bytes.is_some(),
                });
            }

            if !disks.is_empty() {
                res.tasks.push(CollectionTask {
                    task_id: "storage:block".into(),
                    collector_name: self.name().into(),
                    device_id: disks[0].device_id.clone(),
                    group: "storage".into(),
                    interval: Duration::from_secs(60),
                    timeout: Duration::from_secs(2),
                });
            }

            let cap = if disks.is_empty() {
                CapabilityStatus::Unsupported
            } else {
                CapabilityStatus::Supported
            };
            let mut st = self.state.write().expect("lock");
            st.disks = disks;
            st.status = Some(CollectorStatus {
                collector_name: self.name().into(),
                host_id: self.host_id.clone(),
                status: CollectorRunStatus::Running,
                capability_status: cap,
                interval_seconds: 60,
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
            let disks = self.state.read().expect("lock").disks.clone();
            let mut res = CollectResult::default();
            let now = utc_now_rfc3339();
            for d in disks {
                let cap = ctx
                    .sysfs
                    .read_to_string(&format!("/sys/block/{}/size", d.block_name))
                    .ok()
                    .and_then(|s| s.trim().parse::<u64>().ok())
                    .map(|sectors| sectors.saturating_mul(512) as f64);
                res.readings.push(SensorReading {
                    schema_version: SCHEMA_VERSION.into(),
                    host_id: ctx.host_id.clone(),
                    device_id: d.device_id.clone(),
                    sensor_id: sensor_id(&d.device_id, "capacity", "bytes"),
                    metric: "disk_capacity".into(),
                    value: cap,
                    unit: Unit::Byte,
                    quality: if cap.is_some() {
                        ReadingQuality::Valid
                    } else {
                        ReadingQuality::Missing
                    },
                    source: "sysfs".into(),
                    collected_at: now.clone(),
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
                interval_seconds: 60,
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
