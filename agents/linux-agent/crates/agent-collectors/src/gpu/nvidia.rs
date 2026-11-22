//! NVIDIA GPU 采集模块：严格遵循 ADR 约束，运行时通过 `libloading` 动态加载 `libnvidia-ml.so.1`（无编译期硬依赖）；库缺失时如实上报 `unsupported`。

use super::DiscoveredGpu;
use agent_core::collector::{CollectResult, CollectorContext};
use agent_core::identity::sensor_id;
use agent_core::utc_now_rfc3339;
use lhm_protocol::{CapabilityStatus, Diagnostic, DiagnosticLevel, Sensor, SensorType, Unit};
#[cfg(target_os = "linux")]
use lhm_protocol::{ReadingQuality, SCHEMA_VERSION, SensorReading};
#[cfg(target_os = "linux")]
use std::ffi::{CString, c_char, c_int, c_uint, c_void};
use uuid::Uuid;

#[cfg(target_os = "linux")]
const NVML_SUCCESS: c_int = 0;
#[cfg(target_os = "linux")]
const NVML_TEMPERATURE_GPU: c_uint = 0;

#[cfg(target_os = "linux")]
#[repr(C)]
struct NvmlUtilization {
    gpu: c_uint,
    memory: c_uint,
}

#[cfg(target_os = "linux")]
#[repr(C)]
struct NvmlMemory {
    total: u64,
    free: u64,
    used: u64,
}

/// Checks whether `libnvidia-ml.so.1` can be dynamically loaded at runtime (`dlopen`).
/// NEVER links against NVML at compile time (hardware-scope.md §1.2).
pub fn is_nvml_available() -> bool {
    #[cfg(target_os = "linux")]
    {
        // SAFETY: Loading the standard NVIDIA management shared library by soname only.
        unsafe { libloading::Library::new("libnvidia-ml.so.1").is_ok() }
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

pub fn discover_sensors(
    gpu: &DiscoveredGpu,
    ctx: &CollectorContext,
) -> (Vec<Sensor>, Vec<String>, Vec<Diagnostic>) {
    let available = is_nvml_available();
    let cap = if available {
        CapabilityStatus::Supported
    } else {
        CapabilityStatus::Unsupported
    };

    let mut diags = Vec::new();
    if !available {
        diags.push(Diagnostic {
            diagnostic_id: format!("diag-{}", Uuid::new_v4()),
            host_id: ctx.host_id.clone(),
            device_id: Some(gpu.device_id.clone()),
            collector_name: Some("gpu".into()),
            level: DiagnosticLevel::Info,
            error_code: "NVML_UNAVAILABLE".into(),
            source: "nvml".into(),
            message: "NVIDIA GPU detected but libnvidia-ml.so.1 could not be dynamically loaded"
                .into(),
            remediation: Some(
                "Install NVIDIA proprietary driver providing libnvidia-ml.so.1".into(),
            ),
            occurred_at: utc_now_rfc3339(),
            details: None,
        });
    }

    let specs = [
        (
            "temperature",
            "core",
            "NVIDIA GPU Temperature",
            SensorType::Temperature,
            Unit::Celsius,
        ),
        (
            "utilization",
            "gpu",
            "NVIDIA GPU Utilization",
            SensorType::Utilization,
            Unit::Percent,
        ),
        (
            "memory",
            "vram-used",
            "NVIDIA VRAM Used",
            SensorType::Memory,
            Unit::Byte,
        ),
        (
            "power",
            "draw",
            "NVIDIA GPU Power",
            SensorType::Power,
            Unit::Watt,
        ),
    ];

    let mut sensors = Vec::new();
    let mut caps = Vec::new();
    for (metric, slug, label, stype, unit) in specs {
        if available {
            caps.push(metric.into());
        }
        sensors.push(Sensor {
            sensor_id: sensor_id(&gpu.device_id, metric, slug),
            device_id: gpu.device_id.clone(),
            sensor_type: stype,
            sensor_name: label.into(),
            source: "nvml".into(),
            unit,
            capability_status: cap,
            enabled: available,
        });
    }

    (sensors, caps, diags)
}

#[cfg(target_os = "linux")]
pub fn collect(gpu: &DiscoveredGpu, ctx: &CollectorContext) -> CollectResult {
    let mut res = CollectResult::default();
    let now = utc_now_rfc3339();
    let Some(bdf) = gpu.pci_bus_id.as_deref() else {
        return res;
    };

    // SAFETY: Dynamically loads NVML symbols at runtime and checks every return code.
    unsafe {
        let Ok(lib) = libloading::Library::new("libnvidia-ml.so.1") else {
            return res;
        };
        let Ok(init): Result<libloading::Symbol<unsafe extern "C" fn() -> c_int>, _> =
            lib.get(b"nvmlInit_v2")
        else {
            return res;
        };
        let Ok(shutdown): Result<libloading::Symbol<unsafe extern "C" fn() -> c_int>, _> =
            lib.get(b"nvmlShutdown")
        else {
            return res;
        };
        let Ok(by_pci): Result<
            libloading::Symbol<unsafe extern "C" fn(*const c_char, *mut *mut c_void) -> c_int>,
            _,
        > = lib.get(b"nvmlDeviceGetHandleByPciBusId_v2") else {
            return res;
        };

        if init() != NVML_SUCCESS {
            return res;
        }

        let mut handle: *mut c_void = std::ptr::null_mut();
        let Ok(c_bdf) = CString::new(bdf) else {
            let _ = shutdown();
            return res;
        };
        if by_pci(c_bdf.as_ptr(), &mut handle) == NVML_SUCCESS && !handle.is_null() {
            if let Ok(get_temp) = lib
                .get::<unsafe extern "C" fn(*mut c_void, c_uint, *mut c_uint) -> c_int>(
                    b"nvmlDeviceGetTemperature",
                )
            {
                let mut temp: c_uint = 0;
                if get_temp(handle, NVML_TEMPERATURE_GPU, &mut temp) == NVML_SUCCESS {
                    res.readings.push(SensorReading {
                        schema_version: SCHEMA_VERSION.into(),
                        host_id: ctx.host_id.clone(),
                        device_id: gpu.device_id.clone(),
                        sensor_id: sensor_id(&gpu.device_id, "temperature", "core"),
                        metric: "temperature".into(),
                        value: Some(temp as f64),
                        unit: Unit::Celsius,
                        quality: ReadingQuality::Valid,
                        source: "nvml".into(),
                        collected_at: now.clone(),
                    });
                }
            }
            if let Ok(get_util) = lib
                .get::<unsafe extern "C" fn(*mut c_void, *mut NvmlUtilization) -> c_int>(
                    b"nvmlDeviceGetUtilizationRates",
                )
            {
                let mut util = NvmlUtilization { gpu: 0, memory: 0 };
                if get_util(handle, &mut util) == NVML_SUCCESS {
                    res.readings.push(SensorReading {
                        schema_version: SCHEMA_VERSION.into(),
                        host_id: ctx.host_id.clone(),
                        device_id: gpu.device_id.clone(),
                        sensor_id: sensor_id(&gpu.device_id, "utilization", "gpu"),
                        metric: "utilization".into(),
                        value: Some(util.gpu as f64),
                        unit: Unit::Percent,
                        quality: ReadingQuality::Valid,
                        source: "nvml".into(),
                        collected_at: now.clone(),
                    });
                }
            }
            if let Ok(get_mem) = lib
                .get::<unsafe extern "C" fn(*mut c_void, *mut NvmlMemory) -> c_int>(
                    b"nvmlDeviceGetMemoryInfo",
                )
            {
                let mut mem = NvmlMemory {
                    total: 0,
                    free: 0,
                    used: 0,
                };
                if get_mem(handle, &mut mem) == NVML_SUCCESS {
                    res.readings.push(SensorReading {
                        schema_version: SCHEMA_VERSION.into(),
                        host_id: ctx.host_id.clone(),
                        device_id: gpu.device_id.clone(),
                        sensor_id: sensor_id(&gpu.device_id, "memory", "vram-used"),
                        metric: "vram_used".into(),
                        value: Some(mem.used as f64),
                        unit: Unit::Byte,
                        quality: ReadingQuality::Valid,
                        source: "nvml".into(),
                        collected_at: now.clone(),
                    });
                }
            }
            if let Ok(get_pwr) = lib.get::<unsafe extern "C" fn(*mut c_void, *mut c_uint) -> c_int>(
                b"nvmlDeviceGetPowerUsage",
            ) {
                let mut mw: c_uint = 0;
                if get_pwr(handle, &mut mw) == NVML_SUCCESS {
                    res.readings.push(SensorReading {
                        schema_version: SCHEMA_VERSION.into(),
                        host_id: ctx.host_id.clone(),
                        device_id: gpu.device_id.clone(),
                        sensor_id: sensor_id(&gpu.device_id, "power", "draw"),
                        metric: "power".into(),
                        value: Some(mw as f64 / 1000.0),
                        unit: Unit::Watt,
                        quality: ReadingQuality::Valid,
                        source: "nvml".into(),
                        collected_at: now,
                    });
                }
            }
        }
        let _ = shutdown();
    }
    res
}

#[cfg(not(target_os = "linux"))]
pub fn collect(_gpu: &DiscoveredGpu, _ctx: &CollectorContext) -> CollectResult {
    CollectResult::default()
}
