use agent_core::collector::{
    BoxFuture, CollectResult, CollectionTask, Collector, CollectorContext, DiscoveryResult,
};
use agent_core::identity::{build_stable_id, sensor_id};
use agent_core::sysfs::SysFsError;
use agent_core::utc_now_rfc3339;
use lhm_protocol::{
    CapabilityStatus, CollectorRunStatus, CollectorStatus, Device, DeviceIdentity, DeviceStatus,
    DeviceType, Diagnostic, ReadingQuality, SCHEMA_VERSION, Sensor, SensorReading, SensorType,
    Unit,
};
use std::collections::BTreeMap;
use std::sync::RwLock;
use std::time::Duration;

#[derive(Debug, Clone)]
struct ZoneEntry {
    device_id: String,
    sensor_id: String,
    temp_path: String,
}

#[derive(Debug, Default)]
struct ThermalState {
    zones: Vec<ZoneEntry>,
    cap: Option<CapabilityStatus>,
    status: Option<CollectorStatus>,
}

pub struct ThermalCollector {
    host_id: String,
    state: RwLock<ThermalState>,
}

impl ThermalCollector {
    pub fn new(host_id: &str) -> Self {
        Self {
            host_id: host_id.to_owned(),
            state: RwLock::new(ThermalState::default()),
        }
    }
}

impl Collector for ThermalCollector {
    fn name(&self) -> &'static str {
        "thermal"
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
            let entries = match ctx.sysfs.read_dir_names("/sys/class/thermal") {
                Ok(names) => names,
                Err(_) => {
                    let mut st = self.state.write().expect("lock");
                    st.cap = Some(CapabilityStatus::Unsupported);
                    return result;
                }
            };

            let mut type_counts: BTreeMap<String, usize> = BTreeMap::new();
            let mut zones = Vec::new();
            let device_id = build_stable_id(&["thermal", "zones", "host"]);
            let mut capabilities = Vec::new();

            for name in entries {
                if !name.starts_with("thermal_zone") {
                    continue;
                }
                let base = format!("/sys/class/thermal/{name}");
                let zone_type = ctx
                    .sysfs
                    .read_to_string(&format!("{base}/type"))
                    .map(|s| s.trim().to_owned())
                    .unwrap_or_else(|_| name.clone());

                let count = type_counts.entry(zone_type.clone()).or_insert(0);
                let label = if *count == 0 {
                    zone_type.clone()
                } else {
                    format!("{zone_type}-{}", *count)
                };
                *count += 1;

                let temp_path = format!("{base}/temp");
                let cap = match ctx.sysfs.read_to_string(&temp_path) {
                    Ok(_) => CapabilityStatus::Supported,
                    Err(SysFsError::PermissionDenied(_)) => CapabilityStatus::PermissionDenied,
                    Err(_) => CapabilityStatus::Unavailable,
                };

                let sid = sensor_id(&device_id, "temp", &label);
                result.sensors.push(Sensor {
                    sensor_id: sid.clone(),
                    device_id: device_id.clone(),
                    sensor_type: SensorType::Temperature,
                    sensor_name: label,
                    source: "thermal".into(),
                    unit: Unit::Celsius,
                    capability_status: cap,
                    enabled: cap == CapabilityStatus::Supported,
                });
                if !capabilities.contains(&"temperature".to_owned()) {
                    capabilities.push("temperature".to_owned());
                }
                zones.push(ZoneEntry {
                    device_id: device_id.clone(),
                    sensor_id: sid,
                    temp_path,
                });
            }

            if !zones.is_empty() {
                result.devices.push(Device {
                    device_id: device_id.clone(),
                    host_id: ctx.host_id.clone(),
                    device_type: DeviceType::System,
                    vendor: "linux".into(),
                    model: "thermal_zone".into(),
                    name: "Linux Thermal Zones".into(),
                    identity: DeviceIdentity {
                        stable: true,
                        pci_bus_id: None,
                        pci_vendor_id: None,
                        pci_device_id: None,
                        wwn: None,
                        serial: None,
                        nvme_nguid: None,
                        driver: Some("thermal".into()),
                        raw_path: Some("/sys/class/thermal".into()),
                        topology: None,
                    },
                    capabilities,
                    device_status: DeviceStatus::Online,
                });
                result.tasks.push(CollectionTask {
                    task_id: "thermal:zones".into(),
                    collector_name: self.name().into(),
                    device_id,
                    group: "thermal".into(),
                    interval: Duration::from_secs(5),
                    timeout: Duration::from_secs(2),
                });
            }

            let cap = if zones.is_empty() {
                CapabilityStatus::Unsupported
            } else {
                CapabilityStatus::Supported
            };
            let mut st = self.state.write().expect("lock");
            st.zones = zones;
            st.cap = Some(cap);
            st.status = Some(CollectorStatus {
                collector_name: self.name().into(),
                host_id: self.host_id.clone(),
                status: CollectorRunStatus::Running,
                capability_status: cap,
                interval_seconds: 5,
                last_run_at: Some(utc_now_rfc3339()),
                last_success_at: Some(utc_now_rfc3339()),
                consecutive_failures: 0,
                last_error_code: None,
                last_error_message: None,
            });
            result
        })
    }

    fn collect<'a>(
        &'a self,
        _task: &'a CollectionTask,
        ctx: &'a CollectorContext,
    ) -> BoxFuture<'a, CollectResult> {
        Box::pin(async move {
            let zones = self.state.read().expect("lock").zones.clone();
            let mut res = CollectResult::default();
            let now = utc_now_rfc3339();
            for z in zones {
                match ctx.sysfs.read_to_string(&z.temp_path) {
                    Ok(raw) => match raw.trim().parse::<f64>() {
                        Ok(millideg) if millideg.is_finite() => {
                            res.readings.push(SensorReading {
                                schema_version: SCHEMA_VERSION.into(),
                                host_id: ctx.host_id.clone(),
                                device_id: z.device_id,
                                sensor_id: z.sensor_id,
                                metric: "temperature".into(),
                                value: Some(millideg / 1000.0),
                                unit: Unit::Celsius,
                                quality: ReadingQuality::Valid,
                                source: "thermal".into(),
                                collected_at: now.clone(),
                            });
                        }
                        _ => res.readings.push(SensorReading {
                            schema_version: SCHEMA_VERSION.into(),
                            host_id: ctx.host_id.clone(),
                            device_id: z.device_id,
                            sensor_id: z.sensor_id,
                            metric: "temperature".into(),
                            value: None,
                            unit: Unit::Celsius,
                            quality: ReadingQuality::SensorFault,
                            source: "thermal".into(),
                            collected_at: now.clone(),
                        }),
                    },
                    Err(_) => res.readings.push(SensorReading {
                        schema_version: SCHEMA_VERSION.into(),
                        host_id: ctx.host_id.clone(),
                        device_id: z.device_id,
                        sensor_id: z.sensor_id,
                        metric: "temperature".into(),
                        value: None,
                        unit: Unit::Celsius,
                        quality: ReadingQuality::Missing,
                        source: "thermal".into(),
                        collected_at: now.clone(),
                    }),
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
