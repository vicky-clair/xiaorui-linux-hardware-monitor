//! 传感器覆盖率汇总辅助模块：按设备聚合已支持、硬件不支持、权限不足与异常通道，支撑覆盖率审计报表。

use lhm_protocol::{CapabilityStatus, Device, ReadingQuality, Sensor, SensorReading, SensorType};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceCoverage {
    pub device_id: String,
    pub device_name: String,
    pub discovered: bool,
    pub has_temperature_capability: bool,
    pub temperature_read_ok: bool,
    pub supported_metrics: Vec<String>,
    pub unsupported_metrics: Vec<String>,
    pub permission_denied_metrics: Vec<String>,
    pub unavailable_metrics: Vec<String>,
    pub last_success_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoverageReport {
    pub host_id: String,
    pub total_devices: usize,
    pub total_sensors: usize,
    pub devices: Vec<DeviceCoverage>,
}

pub fn build_coverage_report(
    host_id: &str,
    devices: &[Device],
    sensors: &[Sensor],
    readings: &[SensorReading],
) -> CoverageReport {
    let mut sensors_by_dev: BTreeMap<&str, Vec<&Sensor>> = BTreeMap::new();
    for s in sensors {
        sensors_by_dev
            .entry(s.device_id.as_str())
            .or_default()
            .push(s);
    }

    let mut latest_valid_by_sensor: BTreeMap<&str, &SensorReading> = BTreeMap::new();
    for r in readings {
        if r.quality == ReadingQuality::Valid {
            latest_valid_by_sensor.insert(r.sensor_id.as_str(), r);
        }
    }

    let mut out = Vec::with_capacity(devices.len());
    for dev in devices {
        let dev_sensors = sensors_by_dev
            .get(dev.device_id.as_str())
            .cloned()
            .unwrap_or_default();

        let mut has_temp_cap = false;
        let mut temp_read_ok = false;
        let mut supported = Vec::new();
        let mut unsupported = Vec::new();
        let mut permission_denied = Vec::new();
        let mut unavailable = Vec::new();
        let mut last_success_at: Option<String> = None;

        for s in dev_sensors {
            let label = s.sensor_name.clone();
            if s.sensor_type == SensorType::Temperature
                && s.capability_status == CapabilityStatus::Supported
            {
                has_temp_cap = true;
            }
            match s.capability_status {
                CapabilityStatus::Supported => supported.push(label),
                CapabilityStatus::Unsupported => unsupported.push(label),
                CapabilityStatus::PermissionDenied => permission_denied.push(label),
                CapabilityStatus::Unavailable | CapabilityStatus::Unknown => {
                    unavailable.push(label);
                }
            }
            if let Some(r) = latest_valid_by_sensor.get(s.sensor_id.as_str()) {
                if s.sensor_type == SensorType::Temperature {
                    temp_read_ok = true;
                }
                if last_success_at
                    .as_deref()
                    .is_none_or(|cur| r.collected_at.as_str() > cur)
                {
                    last_success_at = Some(r.collected_at.clone());
                }
            }
        }

        out.push(DeviceCoverage {
            device_id: dev.device_id.clone(),
            device_name: dev.name.clone(),
            discovered: true,
            has_temperature_capability: has_temp_cap,
            temperature_read_ok: temp_read_ok,
            supported_metrics: supported,
            unsupported_metrics: unsupported,
            permission_denied_metrics: permission_denied,
            unavailable_metrics: unavailable,
            last_success_at,
        });
    }

    CoverageReport {
        host_id: host_id.to_owned(),
        total_devices: devices.len(),
        total_sensors: sensors.len(),
        devices: out,
    }
}
