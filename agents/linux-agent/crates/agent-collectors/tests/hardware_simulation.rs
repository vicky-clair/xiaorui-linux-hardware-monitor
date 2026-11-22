use agent_collectors::default_collectors;
use agent_collectors::gpu::GpuCollector;
use agent_collectors::nvme::NVME_BIN;
use agent_collectors::smart::SMARTCTL_BIN;
use agent_collectors::storage::DF_BIN;
use agent_core::collector::CollectorContext;
use agent_core::command::{CommandOutput, MockCommandRunner};
use agent_core::scheduler::AgentRunner;
use agent_core::sysfs::MockSysFs;
use lhm_protocol::{CapabilityStatus, DeviceStatus, ReadingQuality, Unit};
use std::sync::Arc;
use std::time::Duration;

fn build_simulated_host() -> (Arc<MockSysFs>, Arc<MockCommandRunner>) {
    let fs = Arc::new(MockSysFs::new());
    let cmd = Arc::new(MockCommandRunner::new());

    // Host files
    fs.add_file("/proc/sys/kernel/hostname", "sim-debian-13\n")
        .add_file("/etc/machine-id", "abcdef0123456789abcdef0123456789\n")
        .add_file(
            "/etc/os-release",
            "NAME=\"Debian GNU/Linux\"\nVERSION_ID=\"13\"\n",
        )
        .add_file("/proc/sys/kernel/osrelease", "6.12.107+deb13-amd64\n")
        .add_file("/proc/uptime", "12345.67 45000.00\n");

    // CPU + RAPL permission denied (matching real L3 behavior)
    fs.add_file(
        "/proc/cpuinfo",
        "vendor_id\t: GenuineIntel\nmodel name\t: Intel(R) Celeron(R) N5095A @ 2.00GHz\n",
    )
    .add_file(
        "/proc/stat",
        "cpu  1000 0 500 8500 0 0 0 0 0 0\ncpu0 250 0 125 2125 0 0 0 0 0 0\n",
    )
    .add_file("/proc/loadavg", "0.25 0.40 0.35 1/120 4321\n")
    .add_file(
        "/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq",
        "2000000\n",
    )
    .add_file(
        "/sys/devices/system/cpu/cpu0/thermal_throttle/package_throttle_count",
        "2\n",
    )
    .add_file(
        "/sys/devices/system/cpu/cpu0/thermal_throttle/core_throttle_count",
        "5\n",
    )
    .add_permission_denied("/sys/class/powercap/intel-rapl:0/energy_uj");

    // Physical NIC (enp1s0) + virtual docker0 (must be ignored)
    fs.add_symlink(
        "/sys/class/net/enp1s0/device",
        "/sys/devices/pci0000:00/0000:00:1f.6",
    )
    .add_symlink(
        "/sys/class/net/enp1s0/device/driver",
        "/sys/bus/pci/drivers/r8169",
    )
    .add_file("/sys/class/net/enp1s0/operstate", "up\n")
    .add_file("/sys/class/net/enp1s0/speed", "1000\n")
    .add_file("/sys/class/net/enp1s0/statistics/rx_errors", "0\n")
    .add_file("/sys/class/net/enp1s0/statistics/tx_errors", "0\n")
    .add_file("/sys/class/net/enp1s0/statistics/rx_dropped", "3\n")
    .add_file("/sys/class/net/enp1s0/statistics/tx_dropped", "0\n")
    .add_file("/sys/class/net/enp1s0/statistics/rx_crc_errors", "0\n")
    .add_file("/sys/class/net/docker0/operstate", "up\n");

    // Memory
    fs.add_file(
        "/proc/meminfo",
        "MemTotal:        8000000 kB\nMemFree:         2000000 kB\nMemAvailable:    3000000 kB\nSwapTotal:       4000000 kB\nSwapFree:        3500000 kB\n",
    );

    // hwmon: coretemp + motherboard fan (0 RPM valid!) + voltage + fault channel
    fs.add_file("/sys/class/hwmon/hwmon1/name", "coretemp\n")
        .add_symlink(
            "/sys/class/hwmon/hwmon1/device",
            "/sys/devices/platform/coretemp.0",
        )
        .add_file("/sys/class/hwmon/hwmon1/temp1_label", "Package id 0\n")
        .add_file("/sys/class/hwmon/hwmon1/temp1_input", "55000\n")
        .add_file("/sys/class/hwmon/hwmon2/name", "nct6775\n")
        .add_symlink(
            "/sys/class/hwmon/hwmon2/device",
            "/sys/devices/platform/nct6775.656",
        )
        .add_file("/sys/class/hwmon/hwmon2/fan1_input", "0\n")
        .add_file("/sys/class/hwmon/hwmon2/in0_input", "1250\n")
        .add_file("/sys/class/hwmon/hwmon2/temp1_input", "not-a-number\n");

    // Thermal zones
    fs.add_file("/sys/class/thermal/thermal_zone0/type", "acpitz\n")
        .add_file("/sys/class/thermal/thermal_zone0/temp", "27800\n")
        .add_file("/sys/class/thermal/thermal_zone1/type", "x86_pkg_temp\n")
        .add_file("/sys/class/thermal/thermal_zone1/temp", "55000\n");

    // GPUs: Intel (0 MHz idle valid!), AMD (amdgpu), NVIDIA (no libnvidia-ml -> unsupported)
    fs.add_symlink(
        "/sys/class/drm/card0/device",
        "/sys/devices/pci0000:00/0000:00:02.0",
    )
    .add_file("/sys/class/drm/card0/device/vendor", "0x8086\n")
    .add_file("/sys/class/drm/card0/device/device", "0x4e55\n")
    .add_file("/sys/class/drm/card0/gt_act_freq_mhz", "0\n")
    .add_file("/sys/class/drm/card0/gt_cur_freq_mhz", "200\n")
    .add_symlink(
        "/sys/class/drm/card1/device",
        "/sys/devices/pci0000:00/0000:01:00.0",
    )
    .add_file("/sys/class/drm/card1/device/vendor", "0x1002\n")
    .add_file("/sys/class/drm/card1/device/device", "0x744c\n")
    .add_file("/sys/class/drm/card1/device/gpu_busy_percent", "37\n")
    .add_file(
        "/sys/class/drm/card1/device/mem_info_vram_used",
        "4294967296\n",
    )
    .add_file(
        "/sys/class/drm/card1/device/hwmon/hwmon5/temp1_input",
        "62000\n",
    )
    .add_file(
        "/sys/class/drm/card1/device/hwmon/hwmon5/temp2_input",
        "74500\n",
    )
    .add_symlink(
        "/sys/class/drm/card2/device",
        "/sys/devices/pci0000:00/0000:02:00.0",
    )
    .add_file("/sys/class/drm/card2/device/vendor", "0x10de\n")
    .add_file("/sys/class/drm/card2/device/device", "0x2684\n");

    // Storage: SATA SSD (sda), Standby HDD (sdb), NVMe (nvme0n1)
    fs.add_file("/sys/block/sda/device/vendor", "ATA\n")
        .add_file("/sys/block/sda/device/model", "SIM_SSD_256G\n")
        .add_file("/sys/block/sda/device/wwid", "naa.5000c500a1b2c3d1\n")
        .add_file("/sys/block/sda/queue/rotational", "0\n")
        .add_file("/sys/block/sda/size", "500118192\n")
        .add_file("/sys/block/sdb/device/vendor", "HGST\n")
        .add_file("/sys/block/sdb/device/model", "SIM_HDD_1TB\n")
        .add_file("/sys/block/sdb/device/wwid", "naa.5000c500a1b2c3d2\n")
        .add_file("/sys/block/sdb/queue/rotational", "1\n")
        .add_file("/sys/block/sdb/size", "1953525168\n")
        .add_file("/sys/block/nvme0n1/device/model", "SIM_NVME_1TB\n")
        .add_file("/sys/block/nvme0n1/wwid", "eui.0025385a11b2c3d4\n")
        .add_file("/sys/block/nvme0n1/queue/rotational", "0\n")
        .add_file("/sys/block/nvme0n1/size", "1953525168\n");

    // Mock df output for mounted filesystems
    let df_out = "\
Filesystem     Type     1B-blocks         Used    Available Capacity Mounted on
/dev/sda2      ext4  242000000000 100000000000 130000000000      44% /
/dev/sdb1      fuseblk 1000000000000 900000000000 100000000000   90% /media/usb
tmpfs          tmpfs    4000000000      1000000   3999000000       1% /run
";
    cmd.register(
        DF_BIN,
        &["-B1", "-T", "-P"],
        Ok(CommandOutput {
            exit_code: 0,
            stdout: df_out.into(),
            stderr: String::new(),
        }),
    );

    // Mock smartctl outputs
    let sda_smart = r#"{
      "device": {"protocol": "ATA"},
      "firmware_version": "H220829a",
      "serial_number": "SN-SIM-001",
      "rotation_rate": 0,
      "interface_speed": {"current": {"string": "6.0 Gb/s"}},
      "ata_apm": {"level": 254},
      "ata_write_cache": {"enabled": true},
      "trim": {"supported": true},
      "smart_status": {"passed": true},
      "temperature": {"current": 36},
      "power_on_time": {"hours": 4200},
      "power_cycle_count": 120,
      "ata_smart_self_test_log": {
        "standard": {
          "table": [{"status": {"string": "Completed without error", "passed": true}, "lifetime_hours": 4100}]
        }
      },
      "ata_smart_error_log": {"summary": {"count": 0}},
      "ata_smart_attributes": {
        "table": [
          {"id": 5, "name": "Reallocated_Sector_Ct", "value": 100, "worst": 100, "thresh": 10, "raw": {"value": 0, "string": "0"}}
        ]
      }
    }"#;
    cmd.register(
        SMARTCTL_BIN,
        &["-n", "standby", "--json=c", "-H", "-A", "/dev/sda"],
        Ok(CommandOutput {
            exit_code: 0,
            stdout: sda_smart.into(),
            stderr: String::new(),
        }),
    )
    .register(
        SMARTCTL_BIN,
        &[
            "-n", "standby", "--json=c", "-i", "-H", "-A", "-l", "selftest", "-l", "error", "-g",
            "all", "/dev/sda",
        ],
        Ok(CommandOutput {
            exit_code: 0,
            stdout: sda_smart.into(),
            stderr: String::new(),
        }),
    );

    // HDD in standby mode: exit code 2 + STANDBY message -> MUST NOT be treated as error/offline
    let sdb_standby = r#"{
      "smartctl": {
        "messages": [{"string": "Device is in STANDBY mode, exit(2)", "severity": "info"}],
        "exit_status": 2
      }
    }"#;
    cmd.register(
        SMARTCTL_BIN,
        &["-n", "standby", "--json=c", "-H", "-A", "/dev/sdb"],
        Ok(CommandOutput {
            exit_code: 2,
            stdout: sdb_standby.into(),
            stderr: String::new(),
        }),
    )
    .register(
        SMARTCTL_BIN,
        &[
            "-n", "standby", "--json=c", "-i", "-H", "-A", "-l", "selftest", "-l", "error", "-g",
            "all", "/dev/sdb",
        ],
        Ok(CommandOutput {
            exit_code: 2,
            stdout: sdb_standby.into(),
            stderr: String::new(),
        }),
    );

    // NVMe permission denied for smartctl, valid 128-bit JSON for nvme-cli
    let perm_denied = r#"{
      "smartctl": {
        "messages": [{"string": "Smartctl open device: /dev/nvme0n1 failed: Permission denied", "severity": "error"}],
        "exit_status": 2
      }
    }"#;
    cmd.register(
        SMARTCTL_BIN,
        &["-n", "standby", "--json=c", "-H", "-A", "/dev/nvme0n1"],
        Ok(CommandOutput {
            exit_code: 2,
            stdout: perm_denied.into(),
            stderr: String::new(),
        }),
    )
    .register(
        SMARTCTL_BIN,
        &[
            "-n",
            "standby",
            "--json=c",
            "-i",
            "-H",
            "-A",
            "-l",
            "selftest",
            "-l",
            "error",
            "-g",
            "all",
            "/dev/nvme0n1",
        ],
        Ok(CommandOutput {
            exit_code: 2,
            stdout: perm_denied.into(),
            stderr: String::new(),
        }),
    );

    let nvme_json = r#"{
      "critical_warning": 0,
      "temperature": 312,
      "avail_spare": 100,
      "percent_used": 2,
      "data_units_read": "340282366920938463463374607431768211455",
      "data_units_written": "18446744073709551616",
      "power_cycles": 88,
      "power_on_hours": 1500,
      "unsafe_shutdowns": 7,
      "media_errors": 0,
      "num_err_log_entries": 1,
      "warning_temp_time": 0,
      "critical_comp_time": 0,
      "temperature_sensor_1": 312,
      "temperature_sensor_2": 318
    }"#;
    cmd.register(
        NVME_BIN,
        &["smart-log", "/dev/nvme0n1", "-o", "json"],
        Ok(CommandOutput {
            exit_code: 0,
            stdout: nvme_json.into(),
            stderr: String::new(),
        }),
    );

    (fs, cmd)
}

#[tokio::test]
async fn full_simulated_hardware_discovery_and_collection() {
    let (fs, cmd) = build_simulated_host();
    let ctx = CollectorContext {
        host_id: "host-sim-01".into(),
        sysfs: fs.clone(),
        cmd,
    };

    let mut runner = AgentRunner::new(default_collectors("host-sim-01"), ctx);
    let snap = runner.run_once(Duration::from_secs(3)).await;

    // 1. Verify no temporary hwmonX IDs were used
    assert!(
        snap.devices
            .iter()
            .all(|d| !d.device_id.starts_with("hwmon0") && !d.device_id.starts_with("hwmon1")),
        "device IDs must not use volatile hwmon index"
    );

    // 2. Verify hwmon conversions: 55000 mC -> 55.0 C, 0 RPM is VALID, 1250 mV -> 1.25 V, corrupt -> SensorFault(null)
    let pkg_temp = snap
        .readings
        .iter()
        .find(|r| r.sensor_id.contains("coretemp") && r.metric == "temperature")
        .expect("coretemp reading");
    assert_eq!(pkg_temp.value, Some(55.0));
    assert_eq!(pkg_temp.quality, ReadingQuality::Valid);

    let zero_fan = snap
        .readings
        .iter()
        .find(|r| r.metric == "fan_speed")
        .expect("0 RPM fan reading");
    assert_eq!(zero_fan.value, Some(0.0));
    assert_eq!(zero_fan.quality, ReadingQuality::Valid);
    assert_eq!(zero_fan.unit, Unit::Rpm);

    let volt = snap
        .readings
        .iter()
        .find(|r| r.metric == "voltage")
        .expect("voltage reading");
    assert_eq!(volt.value, Some(1.25));

    let fault = snap
        .readings
        .iter()
        .find(|r| r.quality == ReadingQuality::SensorFault)
        .expect("corrupt hwmon channel must produce SensorFault");
    assert_eq!(fault.value, None);

    // 3. Verify Intel GPU 0 MHz idle is valid, AMD hotspot 74.5 C, NVIDIA without NVML is unsupported
    let intel_zero = snap
        .readings
        .iter()
        .find(|r| r.metric == "gpu_freq_actual")
        .expect("intel gpu actual freq");
    assert_eq!(intel_zero.value, Some(0.0));
    assert_eq!(intel_zero.quality, ReadingQuality::Valid);

    let amd_hotspot = snap
        .readings
        .iter()
        .find(|r| r.metric == "temperature_hotspot")
        .expect("amd hotspot temp");
    assert_eq!(amd_hotspot.value, Some(74.5));

    let nvidia_sensors: Vec<_> = snap.sensors.iter().filter(|s| s.source == "nvml").collect();
    assert!(!nvidia_sensors.is_empty());
    assert!(
        nvidia_sensors
            .iter()
            .all(|s| s.capability_status == CapabilityStatus::Unsupported)
    );

    // 4. Verify RAPL permission denied & SMART permission denied are cleanly diagnosed
    assert!(
        snap.diagnostics
            .iter()
            .any(|d| d.error_code == "RAPL_PERMISSION_DENIED")
    );
    assert!(
        snap.diagnostics
            .iter()
            .any(|d| d.error_code == "SMART_PERMISSION_DENIED")
    );

    // 5. Verify HDD standby does NOT emit an error and reports DeviceStatus::Standby with null temp
    let standby_report = snap
        .smart_reports
        .iter()
        .find(|r| r.device_path == "/dev/sdb")
        .expect("standby smart report");
    assert_eq!(standby_report.device_status, DeviceStatus::Standby);
    assert_eq!(standby_report.temperature_celsius, None);

    // 6. Verify extended SMART metadata, NVMe full fields, mountpoint usage, CPU throttle & physical NIC
    let sda_report = snap
        .smart_reports
        .iter()
        .find(|r| r.device_path == "/dev/sda")
        .expect("sda extended smart report");
    assert_eq!(sda_report.firmware_version.as_deref(), Some("H220829a"));
    assert_eq!(sda_report.apm_level, Some(254));
    assert_eq!(sda_report.self_test_passed, Some(true));
    assert_eq!(sda_report.trim_supported, Some(true));

    let nvme_report = snap
        .smart_reports
        .iter()
        .find(|r| r.device_path == "/dev/nvme0n1" && r.data_units_read.is_some())
        .expect("nvme smart report");
    assert_eq!(
        nvme_report.data_units_read.as_ref().map(|v| v.as_str()),
        Some("340282366920938463463374607431768211455")
    );
    assert_eq!(nvme_report.temperature_celsius, Some(38.9));
    assert_eq!(
        nvme_report.unsafe_shutdowns.as_ref().map(|v| v.as_str()),
        Some("7")
    );
    assert_eq!(
        nvme_report.media_errors.as_ref().map(|v| v.as_str()),
        Some("0")
    );
    assert_eq!(
        nvme_report.temperature_sensors_celsius,
        Some(vec![38.9, 44.9])
    );

    // Mountpoint usage (90% on /media/usb)
    assert!(
        snap.readings
            .iter()
            .any(|r| r.metric == "fs_usage_percent" && r.value == Some(90.0))
    );
    // CPU thermal throttle count
    assert!(
        snap.readings
            .iter()
            .any(|r| r.metric == "thermal_throttle_count" && r.value == Some(2.0))
    );
    // Physical NIC discovered (docker0 excluded) with 1000 Mbps link speed and rx_dropped=3
    assert!(snap.devices.iter().any(|d| d.name == "NIC (enp1s0)"));
    assert!(!snap.devices.iter().any(|d| d.name.contains("docker0")));
    assert!(
        snap.readings
            .iter()
            .any(|r| r.metric == "nic_link_speed" && r.value == Some(125_000_000.0))
    );
    assert!(
        snap.readings
            .iter()
            .any(|r| r.metric == "nic_rx_dropped" && r.value == Some(3.0))
    );

    // 7. Verify ALL produced readings satisfy protocol invariants (valid => Some, missing => None)
    for reading in &snap.readings {
        reading
            .validate()
            .unwrap_or_else(|e| panic!("invalid reading emitted: {e}: {reading:?}"));
    }

    // 8. Simulate device hot-unplug (remove hwmon1 mid-run) and verify Missing (null), never 0
    fs.remove_prefix("/sys/class/hwmon/hwmon1");
    let snap_after_unplug = runner.run_once(Duration::from_secs(3)).await;
    assert!(
        snap_after_unplug
            .readings
            .iter()
            .all(|r| r.validate().is_ok())
    );
}

#[tokio::test]
async fn gpu_collector_handles_absent_drm_gracefully() {
    let ctx = CollectorContext {
        host_id: "host-headless".into(),
        sysfs: Arc::new(MockSysFs::new()),
        cmd: Arc::new(MockCommandRunner::new()),
    };
    let mut runner = AgentRunner::new(vec![Arc::new(GpuCollector::new("host-headless"))], ctx);
    let snap = runner.run_once(Duration::from_secs(2)).await;
    assert!(snap.devices.is_empty());
    assert_eq!(
        snap.collector_statuses[0].capability_status,
        CapabilityStatus::Unsupported
    );
}
