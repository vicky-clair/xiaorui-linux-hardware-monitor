use super::DiscoveredGpu;
use agent_core::collector::{CollectResult, CollectorContext};
use agent_core::identity::sensor_id;
use agent_core::utc_now_rfc3339;
use lhm_protocol::{
    CapabilityStatus, Diagnostic, ReadingQuality, SCHEMA_VERSION, Sensor, SensorReading,
    SensorType, Unit,
};

fn find_amd_hwmon(gpu: &DiscoveredGpu, ctx: &CollectorContext) -> Option<String> {
    ctx.sysfs
        .read_dir_names(&format!("{}/device/hwmon", gpu.card_path))
        .ok()?
        .into_iter()
        .find(|d| d.starts_with("hwmon"))
        .map(|hw| format!("{}/device/hwmon/{hw}", gpu.card_path))
}

pub fn discover_sensors(
    gpu: &DiscoveredGpu,
    ctx: &CollectorContext,
) -> (Vec<Sensor>, Vec<String>, Vec<Diagnostic>) {
    let mut sensors = Vec::new();
    let mut caps = Vec::new();
    let dev_base = format!("{}/device", gpu.card_path);

    if ctx.sysfs.exists(&format!("{dev_base}/gpu_busy_percent")) {
        caps.push("utilization".into());
        sensors.push(Sensor {
            sensor_id: sensor_id(&gpu.device_id, "utilization", "busy"),
            device_id: gpu.device_id.clone(),
            sensor_type: SensorType::Utilization,
            sensor_name: "AMD GPU Utilization".into(),
            source: "amdgpu".into(),
            unit: Unit::Percent,
            capability_status: CapabilityStatus::Supported,
            enabled: true,
        });
    }

    if ctx.sysfs.exists(&format!("{dev_base}/mem_info_vram_used")) {
        caps.push("memory".into());
        sensors.push(Sensor {
            sensor_id: sensor_id(&gpu.device_id, "memory", "vram-used"),
            device_id: gpu.device_id.clone(),
            sensor_type: SensorType::Memory,
            sensor_name: "AMD VRAM Used".into(),
            source: "amdgpu".into(),
            unit: Unit::Byte,
            capability_status: CapabilityStatus::Supported,
            enabled: true,
        });
    }

    if let Some(hw) = find_amd_hwmon(gpu, ctx) {
        for (file, slug, label, stype, unit, cap_name) in [
            (
                "temp1_input",
                "edge",
                "AMD GPU Edge Temp",
                SensorType::Temperature,
                Unit::Celsius,
                "temperature",
            ),
            (
                "temp2_input",
                "hotspot",
                "AMD GPU Junction/Hotspot Temp",
                SensorType::Temperature,
                Unit::Celsius,
                "temperature",
            ),
            (
                "power1_average",
                "power-avg",
                "AMD GPU Power",
                SensorType::Power,
                Unit::Watt,
                "power",
            ),
            (
                "fan1_input",
                "fan-rpm",
                "AMD GPU Fan",
                SensorType::FanSpeed,
                Unit::Rpm,
                "fan_speed",
            ),
        ] {
            if ctx.sysfs.exists(&format!("{hw}/{file}")) {
                if !caps.contains(&cap_name.to_owned()) {
                    caps.push(cap_name.to_owned());
                }
                sensors.push(Sensor {
                    sensor_id: sensor_id(&gpu.device_id, cap_name, slug),
                    device_id: gpu.device_id.clone(),
                    sensor_type: stype,
                    sensor_name: label.into(),
                    source: "amdgpu-hwmon".into(),
                    unit,
                    capability_status: CapabilityStatus::Supported,
                    enabled: true,
                });
            }
        }
    }

    (sensors, caps, Vec::new())
}

pub fn collect(gpu: &DiscoveredGpu, ctx: &CollectorContext) -> CollectResult {
    let mut res = CollectResult::default();
    let now = utc_now_rfc3339();
    let dev_base = format!("{}/device", gpu.card_path);

    if let Ok(raw) = ctx
        .sysfs
        .read_to_string(&format!("{dev_base}/gpu_busy_percent"))
        && let Ok(pct) = raw.trim().parse::<f64>()
    {
        res.readings.push(SensorReading {
            schema_version: SCHEMA_VERSION.into(),
            host_id: ctx.host_id.clone(),
            device_id: gpu.device_id.clone(),
            sensor_id: sensor_id(&gpu.device_id, "utilization", "busy"),
            metric: "utilization".into(),
            value: Some(pct),
            unit: Unit::Percent,
            quality: ReadingQuality::Valid,
            source: "amdgpu".into(),
            collected_at: now.clone(),
        });
    }

    if let Ok(raw) = ctx
        .sysfs
        .read_to_string(&format!("{dev_base}/mem_info_vram_used"))
        && let Ok(bytes) = raw.trim().parse::<f64>()
    {
        res.readings.push(SensorReading {
            schema_version: SCHEMA_VERSION.into(),
            host_id: ctx.host_id.clone(),
            device_id: gpu.device_id.clone(),
            sensor_id: sensor_id(&gpu.device_id, "memory", "vram-used"),
            metric: "vram_used".into(),
            value: Some(bytes),
            unit: Unit::Byte,
            quality: ReadingQuality::Valid,
            source: "amdgpu".into(),
            collected_at: now.clone(),
        });
    }

    if let Some(hw) = find_amd_hwmon(gpu, ctx) {
        for (file, cap_name, slug, metric, unit, div) in [
            (
                "temp1_input",
                "temperature",
                "edge",
                "temperature_edge",
                Unit::Celsius,
                1000.0,
            ),
            (
                "temp2_input",
                "temperature",
                "hotspot",
                "temperature_hotspot",
                Unit::Celsius,
                1000.0,
            ),
            (
                "power1_average",
                "power",
                "power-avg",
                "power",
                Unit::Watt,
                1_000_000.0,
            ),
            (
                "fan1_input",
                "fan_speed",
                "fan-rpm",
                "fan_speed",
                Unit::Rpm,
                1.0,
            ),
        ] {
            let p = format!("{hw}/{file}");
            if let Ok(raw) = ctx.sysfs.read_to_string(&p)
                && let Ok(v) = raw.trim().parse::<f64>()
            {
                res.readings.push(SensorReading {
                    schema_version: SCHEMA_VERSION.into(),
                    host_id: ctx.host_id.clone(),
                    device_id: gpu.device_id.clone(),
                    sensor_id: sensor_id(&gpu.device_id, cap_name, slug),
                    metric: metric.into(),
                    value: Some(v / div),
                    unit,
                    quality: ReadingQuality::Valid,
                    source: "amdgpu-hwmon".into(),
                    collected_at: now.clone(),
                });
            }
        }
    }

    res
}
