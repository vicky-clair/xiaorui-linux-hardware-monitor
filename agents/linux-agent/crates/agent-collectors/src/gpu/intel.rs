//! Intel GPU（i915 / xe）采集模块：只读 DRM sysfs 频率、共享/独立显存与可选 hwmon 传感器，零频率空闲按有效 0 上报。

use super::DiscoveredGpu;
use agent_core::collector::{CollectResult, CollectorContext};
use agent_core::identity::sensor_id;
use agent_core::utc_now_rfc3339;
use lhm_protocol::{
    CapabilityStatus, Diagnostic, ReadingQuality, SCHEMA_VERSION, Sensor, SensorReading,
    SensorType, Unit,
};

pub fn discover_sensors(
    gpu: &DiscoveredGpu,
    ctx: &CollectorContext,
) -> (Vec<Sensor>, Vec<String>, Vec<Diagnostic>) {
    let mut sensors = Vec::new();
    let mut caps = Vec::new();

    for (file, slug, label) in [
        ("gt_act_freq_mhz", "freq-actual", "GPU Actual Frequency"),
        ("gt_cur_freq_mhz", "freq-current", "GPU Requested Frequency"),
        ("gt_max_freq_mhz", "freq-max", "GPU Max Frequency"),
    ] {
        let p = format!("{}/{file}", gpu.card_path);
        if ctx.sysfs.exists(&p) {
            if !caps.contains(&"frequency".to_owned()) {
                caps.push("frequency".to_owned());
            }
            sensors.push(Sensor {
                sensor_id: sensor_id(&gpu.device_id, "frequency", slug),
                device_id: gpu.device_id.clone(),
                sensor_type: SensorType::Frequency,
                sensor_name: label.into(),
                source: "drm-intel".into(),
                unit: Unit::Hertz,
                capability_status: CapabilityStatus::Supported,
                enabled: true,
            });
        }
    }

    // Explicitly report temperature as unsupported when Intel iGPU has no dedicated DRM hwmon temp
    let has_temp = ctx
        .sysfs
        .read_dir_names(&format!("{}/device/hwmon", gpu.card_path))
        .ok()
        .and_then(|dirs| dirs.into_iter().find(|d| d.starts_with("hwmon")))
        .is_some_and(|hw| {
            ctx.sysfs
                .exists(&format!("{}/device/hwmon/{hw}/temp1_input", gpu.card_path))
        });

    sensors.push(Sensor {
        sensor_id: sensor_id(&gpu.device_id, "temperature", "edge"),
        device_id: gpu.device_id.clone(),
        sensor_type: SensorType::Temperature,
        sensor_name: "GPU Temperature".into(),
        source: "drm-intel".into(),
        unit: Unit::Celsius,
        capability_status: if has_temp {
            CapabilityStatus::Supported
        } else {
            CapabilityStatus::Unsupported
        },
        enabled: has_temp,
    });
    if has_temp {
        caps.push("temperature".into());
    }

    (sensors, caps, Vec::new())
}

pub fn collect(gpu: &DiscoveredGpu, ctx: &CollectorContext) -> CollectResult {
    let mut res = CollectResult::default();
    let now = utc_now_rfc3339();

    for (file, slug, metric) in [
        ("gt_act_freq_mhz", "freq-actual", "gpu_freq_actual"),
        ("gt_cur_freq_mhz", "freq-current", "gpu_freq_current"),
        ("gt_max_freq_mhz", "freq-max", "gpu_freq_max"),
    ] {
        let p = format!("{}/{file}", gpu.card_path);
        if !ctx.sysfs.exists(&p) {
            continue;
        }
        // Note: 0 MHz when Intel GPU is idle IS a valid numeric reading (never treated as missing).
        let parsed = ctx
            .sysfs
            .read_to_string(&p)
            .ok()
            .and_then(|s| s.trim().parse::<f64>().ok())
            .map(|mhz| mhz * 1_000_000.0);

        res.readings.push(SensorReading {
            schema_version: SCHEMA_VERSION.into(),
            host_id: ctx.host_id.clone(),
            device_id: gpu.device_id.clone(),
            sensor_id: sensor_id(&gpu.device_id, "frequency", slug),
            metric: metric.into(),
            value: parsed,
            unit: Unit::Hertz,
            quality: if parsed.is_some() {
                ReadingQuality::Valid
            } else {
                ReadingQuality::Missing
            },
            source: "drm-intel".into(),
            collected_at: now.clone(),
        });
    }

    res
}
