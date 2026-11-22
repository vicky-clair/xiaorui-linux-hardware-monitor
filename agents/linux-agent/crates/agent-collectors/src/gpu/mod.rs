//! GPU 统一发现与分发模块：基于 `/sys/class/drm/card*` PCI 厂商 ID 自动分派 Intel / AMD / NVIDIA 采集器，并使用稳定 PCI BDF 作为设备 ID。

pub mod amd;
pub mod intel;
pub mod nvidia;

use agent_core::collector::{
    BoxFuture, CollectResult, CollectionTask, Collector, CollectorContext, DiscoveryResult,
};
use agent_core::identity::{build_stable_id, extract_pci_bdf, pci_device_id};
use agent_core::utc_now_rfc3339;
use lhm_protocol::{
    CapabilityStatus, CollectorRunStatus, CollectorStatus, Device, DeviceIdentity, DeviceStatus,
    DeviceType, Diagnostic,
};
use std::collections::BTreeMap;
use std::sync::RwLock;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpuVendor {
    Intel,
    Amd,
    Nvidia,
    Unknown,
}

impl GpuVendor {
    pub fn from_pci_hex(hex: &str) -> Self {
        match hex.trim().to_ascii_lowercase().as_str() {
            "0x8086" | "8086" => Self::Intel,
            "0x1002" | "1002" => Self::Amd,
            "0x10de" | "10de" => Self::Nvidia,
            _ => Self::Unknown,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Intel => "intel",
            Self::Amd => "amd",
            Self::Nvidia => "nvidia",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone)]
pub struct DiscoveredGpu {
    pub card_name: String,
    pub card_path: String,
    pub device_id: String,
    pub vendor: GpuVendor,
    pub pci_bus_id: Option<String>,
    pub pci_vendor_id: String,
    pub pci_device_id: String,
}

#[derive(Debug, Default)]
struct GpuState {
    gpus_by_task: BTreeMap<String, DiscoveredGpu>,
    status: Option<CollectorStatus>,
    diagnostics: Vec<Diagnostic>,
}

pub struct GpuCollector {
    host_id: String,
    state: RwLock<GpuState>,
}

impl GpuCollector {
    pub fn new(host_id: &str) -> Self {
        Self {
            host_id: host_id.to_owned(),
            state: RwLock::new(GpuState::default()),
        }
    }
}

impl Collector for GpuCollector {
    fn name(&self) -> &'static str {
        "gpu"
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
            let mut by_task = BTreeMap::new();
            let mut diags = Vec::new();

            let entries = match ctx.sysfs.read_dir_names("/sys/class/drm") {
                Ok(n) => n,
                Err(_) => {
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
            };

            for name in entries {
                if !name.starts_with("card") || name.contains('-') {
                    continue;
                }
                if !name[4..].bytes().all(|b| b.is_ascii_digit()) || name.len() == 4 {
                    continue;
                }
                let card_path = format!("/sys/class/drm/{name}");
                let vendor_raw = ctx
                    .sysfs
                    .read_to_string(&format!("{card_path}/device/vendor"))
                    .map(|s| s.trim().to_owned())
                    .unwrap_or_default();
                if vendor_raw.is_empty() {
                    continue;
                }
                let device_raw = ctx
                    .sysfs
                    .read_to_string(&format!("{card_path}/device/device"))
                    .map(|s| s.trim().to_owned())
                    .unwrap_or_else(|_| "unknown".into());
                let topo = ctx.sysfs.canonicalize(&format!("{card_path}/device")).ok();
                let pci_bdf = topo.as_deref().and_then(extract_pci_bdf);
                let vendor = GpuVendor::from_pci_hex(&vendor_raw);

                let (device_id, stable) = if let Some(ref bdf) = pci_bdf {
                    (pci_device_id("gpu", bdf), true)
                } else {
                    (build_stable_id(&["gpu", vendor.as_str(), &name]), false)
                };

                let gpu = DiscoveredGpu {
                    card_name: name.clone(),
                    card_path: card_path.clone(),
                    device_id: device_id.clone(),
                    vendor,
                    pci_bus_id: pci_bdf.clone(),
                    pci_vendor_id: vendor_raw.trim_start_matches("0x").to_ascii_lowercase(),
                    pci_device_id: device_raw.trim_start_matches("0x").to_ascii_lowercase(),
                };

                let (sensors, caps, extra_diags) = match vendor {
                    GpuVendor::Intel => intel::discover_sensors(&gpu, ctx),
                    GpuVendor::Amd => amd::discover_sensors(&gpu, ctx),
                    GpuVendor::Nvidia => nvidia::discover_sensors(&gpu, ctx),
                    GpuVendor::Unknown => (Vec::new(), Vec::new(), Vec::new()),
                };

                diags.extend(extra_diags);
                res.sensors.extend(sensors);
                res.devices.push(Device {
                    device_id: device_id.clone(),
                    host_id: ctx.host_id.clone(),
                    device_type: DeviceType::Gpu,
                    vendor: vendor.as_str().into(),
                    model: format!("{}:{}", gpu.pci_vendor_id, gpu.pci_device_id),
                    name: format!("{} GPU ({})", vendor.as_str().to_uppercase(), name),
                    identity: DeviceIdentity {
                        stable,
                        pci_bus_id: pci_bdf,
                        pci_vendor_id: Some(gpu.pci_vendor_id.clone()),
                        pci_device_id: Some(gpu.pci_device_id.clone()),
                        wwn: None,
                        serial: None,
                        nvme_nguid: None,
                        driver: Some(
                            match vendor {
                                GpuVendor::Intel => "i915/xe",
                                GpuVendor::Amd => "amdgpu",
                                GpuVendor::Nvidia => "nvml",
                                GpuVendor::Unknown => "drm",
                            }
                            .into(),
                        ),
                        raw_path: Some(card_path),
                        topology: topo,
                    },
                    capabilities: caps,
                    device_status: DeviceStatus::Online,
                });

                let task_id = format!("gpu:{device_id}");
                res.tasks.push(CollectionTask {
                    task_id: task_id.clone(),
                    collector_name: self.name().into(),
                    device_id,
                    group: "gpu".into(),
                    interval: Duration::from_secs(3),
                    timeout: Duration::from_secs(3),
                });
                by_task.insert(task_id, gpu);
            }

            let cap = if by_task.is_empty() {
                CapabilityStatus::Unsupported
            } else {
                CapabilityStatus::Supported
            };
            let mut st = self.state.write().expect("lock");
            st.gpus_by_task = by_task;
            st.diagnostics = diags.clone();
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
            res.diagnostics = diags;
            res
        })
    }

    fn collect<'a>(
        &'a self,
        task: &'a CollectionTask,
        ctx: &'a CollectorContext,
    ) -> BoxFuture<'a, CollectResult> {
        Box::pin(async move {
            let Some(gpu) = self
                .state
                .read()
                .expect("lock")
                .gpus_by_task
                .get(&task.task_id)
                .cloned()
            else {
                return CollectResult::default();
            };

            match gpu.vendor {
                GpuVendor::Intel => intel::collect(&gpu, ctx),
                GpuVendor::Amd => amd::collect(&gpu, ctx),
                GpuVendor::Nvidia => nvidia::collect(&gpu, ctx),
                GpuVendor::Unknown => CollectResult::default(),
            }
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
