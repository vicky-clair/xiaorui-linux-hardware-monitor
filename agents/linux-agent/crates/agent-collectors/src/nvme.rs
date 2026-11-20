use crate::storage::{DiscoveredBlockDevice, discover_block_devices};
use agent_core::collector::{
    BoxFuture, CollectResult, CollectionTask, Collector, CollectorContext, DiscoveryResult,
};
use agent_core::identity::sensor_id;
use agent_core::utc_now_rfc3339;
use lhm_protocol::{
    CapabilityStatus, CollectorRunStatus, CollectorStatus, DeviceStatus, Diagnostic,
    DiagnosticLevel, ReadingQuality, SCHEMA_VERSION, Sensor, SensorReading, SensorType,
    SmartProtocolType, SmartReport, UintString, Unit,
};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::RwLock;
use std::time::Duration;
use uuid::Uuid;

pub const NVME_BIN: &str = "/usr/sbin/nvme";

#[derive(Debug, Default)]
struct NvmeState {
    by_task: BTreeMap<String, DiscoveredBlockDevice>,
    status: Option<CollectorStatus>,
}

pub struct NvmeCollector {
    host_id: String,
    state: RwLock<NvmeState>,
}

impl NvmeCollector {
    pub fn new(host_id: &str) -> Self {
        Self {
            host_id: host_id.to_owned(),
            state: RwLock::new(NvmeState::default()),
        }
    }

    fn extract_uint(val: Option<&Value>) -> Option<UintString> {
        let v = val?;
        if let Some(n) = v.as_u64() {
            return UintString::new(n.to_string()).ok();
        }
        if let Some(s) = v.as_str() {
            let digits: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
            return UintString::new(digits).ok();
        }
        // Handle large JSON numbers (e.g. > u64::MAX in nvme-cli output) via raw serialization
        let rendered = v.to_string();
        if !rendered.is_empty() && rendered.bytes().all(|b| b.is_ascii_digit()) {
            return UintString::new(rendered).ok();
        }
        None
    }

    pub fn parse_nvme_smart_log(
        host_id: &str,
        disk: &DiscoveredBlockDevice,
        stdout: &str,
    ) -> Result<(SmartReport, Vec<SensorReading>), String> {
        let json: Value = serde_json::from_str(stdout).map_err(|e| e.to_string())?;
        let now = utc_now_rfc3339();

        // nvme-cli `temperature` is in Kelvin in raw smart-log JSON (or Celsius if < 200)
        let temp_c = json
            .get("temperature")
            .and_then(|v| v.as_f64())
            .map(|t| if t > 200.0 { t - 273.15 } else { t })
            .map(|c| (c * 10.0).round() / 10.0);

        let critical_warning = json.get("critical_warning").and_then(|v| v.as_u64());
        let smart_passed = critical_warning.map(|cw| cw == 0);
        let percentage_used = json.get("percent_used").and_then(|v| v.as_f64());
        let available_spare = json.get("avail_spare").and_then(|v| v.as_f64());

        let report = SmartReport {
            schema_version: SCHEMA_VERSION.into(),
            host_id: host_id.to_owned(),
            device_id: disk.device_id.clone(),
            device_path: disk.dev_path.clone(),
            protocol_type: SmartProtocolType::Nvme,
            device_status: DeviceStatus::Online,
            smart_passed,
            temperature_celsius: temp_c,
            power_on_hours: Self::extract_uint(json.get("power_on_hours")),
            power_cycles: Self::extract_uint(json.get("power_cycles")),
            data_units_read: Self::extract_uint(json.get("data_units_read")),
            data_units_written: Self::extract_uint(json.get("data_units_written")),
            percentage_used,
            available_spare,
            critical_warning,
            attributes: Vec::new(),
            collected_at: now.clone(),
        };

        let mut readings = Vec::new();
        readings.push(SensorReading {
            schema_version: SCHEMA_VERSION.into(),
            host_id: host_id.to_owned(),
            device_id: disk.device_id.clone(),
            sensor_id: sensor_id(&disk.device_id, "temperature", "nvme"),
            metric: "temperature".into(),
            value: temp_c,
            unit: Unit::Celsius,
            quality: if temp_c.is_some() {
                ReadingQuality::Valid
            } else {
                ReadingQuality::Missing
            },
            source: "nvme-cli".into(),
            collected_at: now,
        });

        Ok((report, readings))
    }
}

impl Collector for NvmeCollector {
    fn name(&self) -> &'static str {
        "nvme"
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
            let nvmes: Vec<DiscoveredBlockDevice> = discover_block_devices(ctx.sysfs.as_ref())
                .into_iter()
                .filter(|d| d.is_nvme)
                .collect();

            let mut by_task = BTreeMap::new();
            for d in nvmes {
                res.sensors.push(Sensor {
                    sensor_id: sensor_id(&d.device_id, "temperature", "nvme"),
                    device_id: d.device_id.clone(),
                    sensor_type: SensorType::Temperature,
                    sensor_name: "NVMe Composite Temperature".into(),
                    source: "nvme-cli".into(),
                    unit: Unit::Celsius,
                    capability_status: CapabilityStatus::Unknown,
                    enabled: true,
                });
                let task_id = format!("nvme:{}", d.device_id);
                res.tasks.push(CollectionTask {
                    task_id: task_id.clone(),
                    collector_name: self.name().into(),
                    device_id: d.device_id.clone(),
                    group: "nvme".into(),
                    interval: Duration::from_secs(5),
                    timeout: Duration::from_secs(5),
                });
                by_task.insert(task_id, d);
            }

            let cap = if by_task.is_empty() {
                CapabilityStatus::Unsupported
            } else {
                CapabilityStatus::Supported
            };
            let mut st = self.state.write().expect("lock");
            st.by_task = by_task;
            st.status = Some(CollectorStatus {
                collector_name: self.name().into(),
                host_id: self.host_id.clone(),
                status: if cap == CapabilityStatus::Supported {
                    CollectorRunStatus::Running
                } else {
                    CollectorRunStatus::Stopped
                },
                capability_status: cap,
                interval_seconds: 5,
                last_run_at: Some(utc_now_rfc3339()),
                last_success_at: None,
                consecutive_failures: 0,
                last_error_code: None,
                last_error_message: None,
            });
            res
        })
    }

    fn collect<'a>(
        &'a self,
        task: &'a CollectionTask,
        ctx: &'a CollectorContext,
    ) -> BoxFuture<'a, CollectResult> {
        Box::pin(async move {
            let mut res = CollectResult::default();
            let Some(disk) = self
                .state
                .read()
                .expect("lock")
                .by_task
                .get(&task.task_id)
                .cloned()
            else {
                return res;
            };

            let args = ["smart-log", disk.dev_path.as_str(), "-o", "json"];
            match ctx.cmd.run(NVME_BIN, &args, task.timeout).await {
                Ok(out) if out.exit_code == 0 => {
                    match Self::parse_nvme_smart_log(&ctx.host_id, &disk, &out.stdout) {
                        Ok((report, readings)) => {
                            res.smart_reports.push(report);
                            res.readings.extend(readings);
                        }
                        Err(e) => {
                            res.diagnostics.push(Diagnostic {
                                diagnostic_id: format!("diag-{}", Uuid::new_v4()),
                                host_id: ctx.host_id.clone(),
                                device_id: Some(disk.device_id),
                                collector_name: Some(self.name().into()),
                                level: DiagnosticLevel::Warn,
                                error_code: "NVME_PARSE_ERROR".into(),
                                source: "nvme-cli".into(),
                                message: e,
                                remediation: None,
                                occurred_at: utc_now_rfc3339(),
                                details: None,
                            });
                        }
                    }
                }
                Ok(out) => {
                    let lower = format!("{} {}", out.stdout, out.stderr).to_ascii_lowercase();
                    let code = if lower.contains("permission denied") {
                        "NVME_PERMISSION_DENIED"
                    } else {
                        "NVME_EXEC_ERROR"
                    };
                    res.diagnostics.push(Diagnostic {
                        diagnostic_id: format!("diag-{}", Uuid::new_v4()),
                        host_id: ctx.host_id.clone(),
                        device_id: Some(disk.device_id),
                        collector_name: Some(self.name().into()),
                        level: DiagnosticLevel::Warn,
                        error_code: code.into(),
                        source: "nvme-cli".into(),
                        message: format!(
                            "nvme smart-log failed for {} (exit {})",
                            disk.dev_path, out.exit_code
                        ),
                        remediation: Some("Verify nvme-cli permissions (ADR-0006)".into()),
                        occurred_at: utc_now_rfc3339(),
                        details: None,
                    });
                }
                Err(e) => {
                    res.diagnostics.push(Diagnostic {
                        diagnostic_id: format!("diag-{}", Uuid::new_v4()),
                        host_id: ctx.host_id.clone(),
                        device_id: Some(disk.device_id),
                        collector_name: Some(self.name().into()),
                        level: DiagnosticLevel::Warn,
                        error_code: "NVME_EXEC_ERROR".into(),
                        source: "nvme-cli".into(),
                        message: e.to_string(),
                        remediation: None,
                        occurred_at: utc_now_rfc3339(),
                        details: None,
                    });
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
