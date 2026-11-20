use crate::storage::{DiscoveredBlockDevice, discover_block_devices};
use agent_core::collector::{
    BoxFuture, CollectResult, CollectionTask, Collector, CollectorContext, DiscoveryResult,
};
use agent_core::command::CommandError;
use agent_core::identity::sensor_id;
use agent_core::utc_now_rfc3339;
use lhm_protocol::{
    CapabilityStatus, CollectorRunStatus, CollectorStatus, DeviceStatus, Diagnostic,
    DiagnosticLevel, ReadingQuality, SCHEMA_VERSION, Sensor, SensorReading, SensorType,
    SmartAttribute, SmartProtocolType, SmartReport, UintString, Unit,
};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::RwLock;
use std::time::Duration;
use uuid::Uuid;

pub const SMARTCTL_BIN: &str = "/usr/sbin/smartctl";

#[derive(Debug, Default)]
struct SmartState {
    disks_by_task: BTreeMap<String, DiscoveredBlockDevice>,
    status: Option<CollectorStatus>,
}

pub struct SmartCollector {
    host_id: String,
    state: RwLock<SmartState>,
}

impl SmartCollector {
    pub fn new(host_id: &str) -> Self {
        Self {
            host_id: host_id.to_owned(),
            state: RwLock::new(SmartState::default()),
        }
    }

    fn json_uint_string(val: Option<&Value>) -> Option<UintString> {
        let v = val?;
        if let Some(n) = v.as_u64() {
            return UintString::new(n.to_string()).ok();
        }
        if let Some(s) = v.as_str() {
            let digits: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
            return UintString::new(digits).ok();
        }
        None
    }

    fn collect_messages(json: &Value) -> Vec<String> {
        json.get("smartctl")
            .and_then(|s| s.get("messages"))
            .and_then(|m| m.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| item.get("string").and_then(|s| s.as_str()))
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Parses `smartctl -n standby --json=c -a <dev>` output while strictly respecting:
    /// 1) HDD standby (never wakes disk; reports `DeviceStatus::Standby`, not fault/offline)
    /// 2) Permission denied (reports `SMART_PERMISSION_DENIED`, not hardware fault)
    /// 3) Bitmask exit codes (bits 2-7 still contain valid SMART telemetry)
    /// 4) Raw SMART attributes preserved as `UintString`
    pub fn parse_smartctl_json(
        host_id: &str,
        disk: &DiscoveredBlockDevice,
        exit_code: i32,
        stdout: &str,
        stderr: &str,
    ) -> (
        Option<SmartReport>,
        Vec<SensorReading>,
        Vec<Diagnostic>,
        CapabilityStatus,
    ) {
        let now = utc_now_rfc3339();
        let parsed = serde_json::from_str::<Value>(stdout).ok();
        let messages = parsed
            .as_ref()
            .map(Self::collect_messages)
            .unwrap_or_default();
        let combined_msgs = format!("{} {}", messages.join(" | "), stderr).to_ascii_lowercase();

        // 1. Permission denied check (never confuse with hardware fault)
        if combined_msgs.contains("permission denied")
            || combined_msgs.contains("operation not permitted")
        {
            let diag = Diagnostic {
                diagnostic_id: format!("diag-{}", Uuid::new_v4()),
                host_id: host_id.to_owned(),
                device_id: Some(disk.device_id.clone()),
                collector_name: Some("smart".into()),
                level: DiagnosticLevel::Warn,
                error_code: "SMART_PERMISSION_DENIED".into(),
                source: "smartctl".into(),
                message: format!("Permission denied running smartctl on {}", disk.dev_path),
                remediation: Some(
                    "Grant CAP_SYS_RAWIO via systemd unit (ADR-0006) to enable SMART telemetry"
                        .into(),
                ),
                occurred_at: now,
                details: None,
            };
            return (
                None,
                Vec::new(),
                vec![diag],
                CapabilityStatus::PermissionDenied,
            );
        }

        // 2. HDD standby check (`smartctl -n standby` returns bit 1 = exit 2 with STANDBY message)
        if (exit_code & 0x02) != 0
            && (combined_msgs.contains("standby") || combined_msgs.contains("sleep mode"))
        {
            let report = SmartReport {
                schema_version: SCHEMA_VERSION.into(),
                host_id: host_id.to_owned(),
                device_id: disk.device_id.clone(),
                device_path: disk.dev_path.clone(),
                protocol_type: if disk.is_nvme {
                    SmartProtocolType::Nvme
                } else {
                    SmartProtocolType::Ata
                },
                device_status: DeviceStatus::Standby,
                smart_passed: None,
                temperature_celsius: None,
                power_on_hours: None,
                power_cycles: None,
                data_units_read: None,
                data_units_written: None,
                percentage_used: None,
                available_spare: None,
                critical_warning: None,
                attributes: Vec::new(),
                collected_at: now.clone(),
            };
            let reading = SensorReading {
                schema_version: SCHEMA_VERSION.into(),
                host_id: host_id.to_owned(),
                device_id: disk.device_id.clone(),
                sensor_id: sensor_id(&disk.device_id, "temperature", "smart"),
                metric: "temperature".into(),
                value: None,
                unit: Unit::Celsius,
                quality: ReadingQuality::Missing,
                source: "smartctl".into(),
                collected_at: now,
            };
            return (
                Some(report),
                vec![reading],
                Vec::new(),
                CapabilityStatus::Supported,
            );
        }

        let Some(json) = parsed else {
            let diag = Diagnostic {
                diagnostic_id: format!("diag-{}", Uuid::new_v4()),
                host_id: host_id.to_owned(),
                device_id: Some(disk.device_id.clone()),
                collector_name: Some("smart".into()),
                level: DiagnosticLevel::Warn,
                error_code: "SMART_PARSE_ERROR".into(),
                source: "smartctl".into(),
                message: format!(
                    "smartctl exited with code {exit_code} and returned invalid JSON for {}",
                    disk.dev_path
                ),
                remediation: Some("Verify smartmontools >= 7.0 is installed".into()),
                occurred_at: now,
                details: None,
            };
            return (None, Vec::new(), vec![diag], CapabilityStatus::Unavailable);
        };

        // Bit 0 or 1 without SMART payload means device open/unsupported error
        if (exit_code & 0x03) != 0 && json.get("smart_status").is_none() {
            let diag = Diagnostic {
                diagnostic_id: format!("diag-{}", Uuid::new_v4()),
                host_id: host_id.to_owned(),
                device_id: Some(disk.device_id.clone()),
                collector_name: Some("smart".into()),
                level: DiagnosticLevel::Info,
                error_code: "SMART_UNSUPPORTED".into(),
                source: "smartctl".into(),
                message: format!(
                    "SMART unavailable for {} (exit {exit_code}): {}",
                    disk.dev_path,
                    messages.join("; ")
                ),
                remediation: None,
                occurred_at: now,
                details: None,
            };
            return (None, Vec::new(), vec![diag], CapabilityStatus::Unsupported);
        }

        let protocol_type = match json
            .get("device")
            .and_then(|d| d.get("protocol"))
            .and_then(|p| p.as_str())
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("ata") => SmartProtocolType::Ata,
            Some("nvme") => SmartProtocolType::Nvme,
            Some("scsi") => SmartProtocolType::Scsi,
            _ if disk.is_nvme => SmartProtocolType::Nvme,
            _ => SmartProtocolType::Unknown,
        };

        let smart_passed = json
            .get("smart_status")
            .and_then(|s| s.get("passed"))
            .and_then(|b| b.as_bool());

        let temperature_celsius = json
            .get("temperature")
            .and_then(|t| t.get("current"))
            .and_then(|n| n.as_f64());

        let power_on_hours =
            Self::json_uint_string(json.get("power_on_time").and_then(|p| p.get("hours")));
        let power_cycles = Self::json_uint_string(json.get("power_cycle_count"));

        let nvme_log = json.get("nvme_smart_health_information_log");
        let data_units_read =
            Self::json_uint_string(nvme_log.and_then(|l| l.get("data_units_read")));
        let data_units_written =
            Self::json_uint_string(nvme_log.and_then(|l| l.get("data_units_written")));
        let percentage_used = nvme_log
            .and_then(|l| l.get("percentage_used"))
            .and_then(|v| v.as_f64());
        let available_spare = nvme_log
            .and_then(|l| l.get("available_spare"))
            .and_then(|v| v.as_f64());
        let critical_warning = nvme_log
            .and_then(|l| l.get("critical_warning"))
            .and_then(|v| v.as_u64());

        let mut attributes = Vec::new();
        if let Some(table) = json
            .get("ata_smart_attributes")
            .and_then(|a| a.get("table"))
            .and_then(|t| t.as_array())
        {
            for item in table {
                let Some(id) = item.get("id").and_then(|v| v.as_u64()).map(|v| v as u32) else {
                    continue;
                };
                let Some(name) = item.get("name").and_then(|v| v.as_str()) else {
                    continue;
                };
                let raw_val = Self::json_uint_string(item.get("raw").and_then(|r| r.get("value")))
                    .unwrap_or_else(|| UintString::from(0u128));
                let raw_string = item
                    .get("raw")
                    .and_then(|r| r.get("string"))
                    .and_then(|v| v.as_str())
                    .map(str::to_owned);

                attributes.push(SmartAttribute {
                    id,
                    name: name.to_owned(),
                    value: item.get("value").and_then(|v| v.as_i64()),
                    worst: item.get("worst").and_then(|v| v.as_i64()),
                    threshold: item.get("thresh").and_then(|v| v.as_i64()),
                    raw_value: raw_val,
                    raw_string,
                });
            }
        }

        let report = SmartReport {
            schema_version: SCHEMA_VERSION.into(),
            host_id: host_id.to_owned(),
            device_id: disk.device_id.clone(),
            device_path: disk.dev_path.clone(),
            protocol_type,
            device_status: DeviceStatus::Online,
            smart_passed,
            temperature_celsius,
            power_on_hours,
            power_cycles,
            data_units_read,
            data_units_written,
            percentage_used,
            available_spare,
            critical_warning,
            attributes,
            collected_at: now.clone(),
        };

        let mut readings = Vec::new();
        readings.push(SensorReading {
            schema_version: SCHEMA_VERSION.into(),
            host_id: host_id.to_owned(),
            device_id: disk.device_id.clone(),
            sensor_id: sensor_id(&disk.device_id, "temperature", "smart"),
            metric: "temperature".into(),
            value: temperature_celsius,
            unit: Unit::Celsius,
            quality: if temperature_celsius.is_some() {
                ReadingQuality::Valid
            } else {
                ReadingQuality::Missing
            },
            source: "smartctl".into(),
            collected_at: now,
        });

        (
            Some(report),
            readings,
            Vec::new(),
            CapabilityStatus::Supported,
        )
    }
}

impl Collector for SmartCollector {
    fn name(&self) -> &'static str {
        "smart"
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
            let mut by_task = BTreeMap::new();

            for d in disks {
                res.sensors.push(Sensor {
                    sensor_id: sensor_id(&d.device_id, "temperature", "smart"),
                    device_id: d.device_id.clone(),
                    sensor_type: SensorType::Temperature,
                    sensor_name: "SMART Temperature".into(),
                    source: "smartctl".into(),
                    unit: Unit::Celsius,
                    capability_status: CapabilityStatus::Unknown,
                    enabled: true,
                });

                // Dual-frequency scheduling per ADR-0008 / hardware-scope.md §5.3:
                // 30s temperature task + 15m full SMART attribute task.
                let temp_task_id = format!("smart-temp:{}", d.device_id);
                let full_task_id = format!("smart-full:{}", d.device_id);

                res.tasks.push(CollectionTask {
                    task_id: temp_task_id.clone(),
                    collector_name: self.name().into(),
                    device_id: d.device_id.clone(),
                    group: "smart_temp".into(),
                    interval: Duration::from_secs(if d.is_nvme { 5 } else { 30 }),
                    timeout: Duration::from_secs(5),
                });
                res.tasks.push(CollectionTask {
                    task_id: full_task_id.clone(),
                    collector_name: self.name().into(),
                    device_id: d.device_id.clone(),
                    group: "smart_full".into(),
                    interval: Duration::from_secs(900),
                    timeout: Duration::from_secs(10),
                });

                by_task.insert(temp_task_id, d.clone());
                by_task.insert(full_task_id, d);
            }

            let cap = if by_task.is_empty() {
                CapabilityStatus::Unsupported
            } else {
                CapabilityStatus::Supported
            };
            let mut st = self.state.write().expect("lock");
            st.disks_by_task = by_task;
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
        task: &'a CollectionTask,
        ctx: &'a CollectorContext,
    ) -> BoxFuture<'a, CollectResult> {
        Box::pin(async move {
            let mut res = CollectResult::default();
            let Some(disk) = self
                .state
                .read()
                .expect("lock")
                .disks_by_task
                .get(&task.task_id)
                .cloned()
            else {
                return res;
            };

            let flag = if task.group == "smart_temp" {
                "-A"
            } else {
                "-a"
            };
            let args = ["-n", "standby", "--json=c", flag, disk.dev_path.as_str()];

            match ctx.cmd.run(SMARTCTL_BIN, &args, task.timeout).await {
                Ok(out) => {
                    let (report, readings, diags, cap) = Self::parse_smartctl_json(
                        &ctx.host_id,
                        &disk,
                        out.exit_code,
                        &out.stdout,
                        &out.stderr,
                    );
                    if let Some(r) = report {
                        res.smart_reports.push(r);
                    }
                    res.readings.extend(readings);
                    res.diagnostics.extend(diags);
                    res.sensor_capability_updates
                        .push((sensor_id(&disk.device_id, "temperature", "smart"), cap));
                    if let Some(st) = self.state.write().expect("lock").status.as_mut() {
                        st.last_run_at = Some(utc_now_rfc3339());
                        st.capability_status = cap;
                        if cap == CapabilityStatus::Supported {
                            st.last_success_at = Some(utc_now_rfc3339());
                        }
                    }
                }
                Err(CommandError::NotFound(_)) => {
                    res.diagnostics.push(Diagnostic {
                        diagnostic_id: format!("diag-{}", Uuid::new_v4()),
                        host_id: ctx.host_id.clone(),
                        device_id: Some(disk.device_id),
                        collector_name: Some(self.name().into()),
                        level: DiagnosticLevel::Warn,
                        error_code: "SMARTCTL_NOT_FOUND".into(),
                        source: "smartctl".into(),
                        message: format!("{SMARTCTL_BIN} not found on host"),
                        remediation: Some("Install smartmontools >= 7.0".into()),
                        occurred_at: utc_now_rfc3339(),
                        details: None,
                    });
                }
                Err(err) => {
                    res.diagnostics.push(Diagnostic {
                        diagnostic_id: format!("diag-{}", Uuid::new_v4()),
                        host_id: ctx.host_id.clone(),
                        device_id: Some(disk.device_id),
                        collector_name: Some(self.name().into()),
                        level: DiagnosticLevel::Warn,
                        error_code: "SMARTCTL_EXEC_ERROR".into(),
                        source: "smartctl".into(),
                        message: err.to_string(),
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
