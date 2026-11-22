//! 物理网络接口健康与链路状态采集器（只读 `/sys/class/net/`，零额外权限）。
//! 自动过滤回环与容器虚拟网桥，仅监控具备真实硬件设备路径的物理网卡。

use agent_core::collector::{
    BoxFuture, CollectResult, CollectionTask, Collector, CollectorContext, DiscoveryResult,
};
use agent_core::identity::{build_stable_id, extract_pci_bdf, sensor_id};
use agent_core::utc_now_rfc3339;
use lhm_protocol::{
    CapabilityStatus, CollectorRunStatus, CollectorStatus, Device, DeviceIdentity, DeviceStatus,
    DeviceType, Diagnostic, ReadingQuality, SCHEMA_VERSION, Sensor, SensorReading, SensorType,
    Unit,
};
use std::sync::RwLock;
use std::time::Duration;

#[derive(Debug, Clone)]
struct DiscoveredNic {
    iface: String,
    device_id: String,
    stable: bool,
    pci_bus_id: Option<String>,
    topology: Option<String>,
}

#[derive(Debug, Default)]
struct NetworkState {
    nics: Vec<DiscoveredNic>,
    status: Option<CollectorStatus>,
}

pub struct NetworkCollector {
    host_id: String,
    state: RwLock<NetworkState>,
}

impl NetworkCollector {
    pub fn new(host_id: &str) -> Self {
        Self {
            host_id: host_id.to_owned(),
            state: RwLock::new(NetworkState::default()),
        }
    }

    fn is_virtual_iface_name(name: &str) -> bool {
        name == "lo"
            || name.starts_with("docker")
            || name.starts_with("br-")
            || name.starts_with("veth")
            || name.starts_with("virbr")
            || name.starts_with("cni")
            || name.starts_with("flannel")
            || name.starts_with("cali")
            || name.starts_with("wg")
            || name.starts_with("tun")
            || name.starts_with("tap")
            || name.starts_with("tailscale")
            || name.starts_with("zt")
    }

    fn parse_operstate(raw: &str) -> DeviceStatus {
        match raw.trim().to_ascii_lowercase().as_str() {
            "up" => DeviceStatus::Online,
            "down" | "lowerlayerdown" | "notpresent" => DeviceStatus::Offline,
            "dormant" => DeviceStatus::Standby,
            _ => DeviceStatus::Unknown,
        }
    }
}

impl Collector for NetworkCollector {
    fn name(&self) -> &'static str {
        "network"
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
            let mut nics = Vec::new();

            if let Ok(entries) = ctx.sysfs.read_dir_names("/sys/class/net") {
                for iface in entries {
                    if Self::is_virtual_iface_name(&iface) {
                        continue;
                    }
                    let dev_link = format!("/sys/class/net/{iface}/device");
                    let topology = ctx.sysfs.canonicalize(&dev_link).ok();
                    if topology.is_none() && !ctx.sysfs.exists(&dev_link) {
                        // 跳过无物理设备节点的虚拟接口
                        continue;
                    }
                    let pci_bus_id = topology.as_deref().and_then(extract_pci_bdf);
                    let (device_id, stable) = if let Some(ref bdf) = pci_bus_id {
                        (build_stable_id(&["net", "pci", bdf]), true)
                    } else {
                        (build_stable_id(&["net", "iface", &iface]), true)
                    };

                    let operstate = ctx
                        .sysfs
                        .read_to_string(&format!("/sys/class/net/{iface}/operstate"))
                        .map(|s| Self::parse_operstate(&s))
                        .unwrap_or(DeviceStatus::Unknown);

                    let driver = ctx
                        .sysfs
                        .canonicalize(&format!("/sys/class/net/{iface}/device/driver"))
                        .ok()
                        .and_then(|p| p.rsplit('/').next().map(str::to_owned));

                    let vendor = ctx
                        .sysfs
                        .read_to_string(&format!("/sys/class/net/{iface}/device/vendor"))
                        .map(|s| s.trim().to_owned())
                        .ok()
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| "network".into());

                    res.devices.push(Device {
                        device_id: device_id.clone(),
                        host_id: ctx.host_id.clone(),
                        device_type: DeviceType::Network,
                        vendor,
                        model: driver.clone().unwrap_or_else(|| "NIC".into()),
                        name: format!("NIC ({iface})"),
                        identity: DeviceIdentity {
                            stable,
                            pci_bus_id: pci_bus_id.clone(),
                            pci_vendor_id: None,
                            pci_device_id: None,
                            wwn: None,
                            serial: None,
                            nvme_nguid: None,
                            driver,
                            raw_path: Some(format!("/sys/class/net/{iface}")),
                            topology: topology.clone(),
                        },
                        capabilities: vec!["link_speed".into(), "packet_errors".into()],
                        device_status: operstate,
                    });

                    res.sensors.push(Sensor {
                        sensor_id: sensor_id(&device_id, "throughput", "link-speed"),
                        device_id: device_id.clone(),
                        sensor_type: SensorType::Throughput,
                        sensor_name: format!("Link Speed ({iface})"),
                        source: "sysfs".into(),
                        unit: Unit::BytePerSecond,
                        capability_status: CapabilityStatus::Supported,
                        enabled: true,
                    });

                    for (stat_key, label) in [
                        ("rx_errors", "RX Errors"),
                        ("tx_errors", "TX Errors"),
                        ("rx_dropped", "RX Dropped"),
                        ("tx_dropped", "TX Dropped"),
                        ("rx_crc_errors", "RX CRC Errors"),
                    ] {
                        let stat_path = format!("/sys/class/net/{iface}/statistics/{stat_key}");
                        if ctx.sysfs.exists(&stat_path) {
                            res.sensors.push(Sensor {
                                sensor_id: sensor_id(
                                    &device_id,
                                    "error-count",
                                    &stat_key.replace('_', "-"),
                                ),
                                device_id: device_id.clone(),
                                sensor_type: SensorType::ErrorCount,
                                sensor_name: format!("{label} ({iface})"),
                                source: "sysfs".into(),
                                unit: Unit::Count,
                                capability_status: CapabilityStatus::Supported,
                                enabled: true,
                            });
                        }
                    }

                    nics.push(DiscoveredNic {
                        iface,
                        device_id,
                        stable,
                        pci_bus_id,
                        topology,
                    });
                }
            }

            if let Some(first) = nics.first() {
                res.tasks.push(CollectionTask {
                    task_id: "network:nics".into(),
                    collector_name: self.name().into(),
                    device_id: first.device_id.clone(),
                    group: "network".into(),
                    interval: Duration::from_secs(30),
                    timeout: Duration::from_secs(2),
                });
            }

            let cap = if nics.is_empty() {
                CapabilityStatus::Unsupported
            } else {
                CapabilityStatus::Supported
            };
            let mut st = self.state.write().expect("lock");
            st.nics = nics;
            st.status = Some(CollectorStatus {
                collector_name: self.name().into(),
                host_id: self.host_id.clone(),
                status: CollectorRunStatus::Running,
                capability_status: cap,
                interval_seconds: 30,
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
            let nics = self.state.read().expect("lock").nics.clone();
            let mut res = CollectResult::default();
            let now = utc_now_rfc3339();

            for nic in nics {
                let speed_mbps = ctx
                    .sysfs
                    .read_to_string(&format!("/sys/class/net/{}/speed", nic.iface))
                    .ok()
                    .and_then(|s| s.trim().parse::<i64>().ok())
                    .filter(|&mbps| mbps > 0);
                let speed_bps = speed_mbps.map(|mbps| mbps as f64 * 125_000.0);

                res.readings.push(SensorReading {
                    schema_version: SCHEMA_VERSION.into(),
                    host_id: ctx.host_id.clone(),
                    device_id: nic.device_id.clone(),
                    sensor_id: sensor_id(&nic.device_id, "throughput", "link-speed"),
                    metric: "nic_link_speed".into(),
                    value: speed_bps,
                    unit: Unit::BytePerSecond,
                    quality: if speed_bps.is_some() {
                        ReadingQuality::Valid
                    } else {
                        ReadingQuality::Missing
                    },
                    source: "sysfs".into(),
                    collected_at: now.clone(),
                });

                for stat_key in [
                    "rx_errors",
                    "tx_errors",
                    "rx_dropped",
                    "tx_dropped",
                    "rx_crc_errors",
                ] {
                    let stat_path = format!("/sys/class/net/{}/statistics/{stat_key}", nic.iface);
                    if !ctx.sysfs.exists(&stat_path) {
                        continue;
                    }
                    let val = ctx
                        .sysfs
                        .read_to_string(&stat_path)
                        .ok()
                        .and_then(|s| s.trim().parse::<f64>().ok());
                    res.readings.push(SensorReading {
                        schema_version: SCHEMA_VERSION.into(),
                        host_id: ctx.host_id.clone(),
                        device_id: nic.device_id.clone(),
                        sensor_id: sensor_id(
                            &nic.device_id,
                            "error-count",
                            &stat_key.replace('_', "-"),
                        ),
                        metric: format!("nic_{stat_key}"),
                        value: val,
                        unit: Unit::Count,
                        quality: if val.is_some() {
                            ReadingQuality::Valid
                        } else {
                            ReadingQuality::SensorFault
                        },
                        source: "sysfs".into(),
                        collected_at: now.clone(),
                    });
                }
            }

            let _ = (
                &self.host_id,
                self.state
                    .read()
                    .expect("lock")
                    .nics
                    .first()
                    .map(|n| (&n.stable, &n.pci_bus_id, &n.topology)),
            );

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
                interval_seconds: 30,
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
