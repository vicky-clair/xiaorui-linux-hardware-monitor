//! 宿主机身份发现模块：基于 `/etc/machine-id`、主机名、`/etc/os-release` 与 `/proc/uptime` 生成稳定的单主机档案。

use crate::agent_info;
use crate::identity::build_stable_id;
use crate::sysfs::SysFs;
use lhm_protocol::Host;

fn parse_os_release(content: &str) -> (String, String) {
    let mut name = "Linux".to_owned();
    let mut version = "unknown".to_owned();
    for line in content.lines() {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("NAME=") {
            name = v.trim_matches('"').to_owned();
        } else if let Some(v) = line.strip_prefix("VERSION_ID=") {
            version = v.trim_matches('"').to_owned();
        }
    }
    (name, version)
}

pub fn discover_host(sysfs: &dyn SysFs) -> Host {
    let hostname = sysfs
        .read_to_string("/proc/sys/kernel/hostname")
        .or_else(|_| sysfs.read_to_string("/etc/hostname"))
        .map(|s| s.trim().to_owned())
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown-host".to_owned());

    let host_id = sysfs
        .read_to_string("/etc/machine-id")
        .map(|s| s.trim().to_owned())
        .ok()
        .filter(|s| s.len() >= 8)
        .map(|id| build_stable_id(&["host", &id[..12.min(id.len())]]))
        .unwrap_or_else(|| build_stable_id(&["host", &hostname]));

    let (os_name, os_version) = sysfs
        .read_to_string("/etc/os-release")
        .map(|c| parse_os_release(&c))
        .unwrap_or_else(|_| ("Linux".to_owned(), "unknown".to_owned()));

    let kernel_version = sysfs
        .read_to_string("/proc/sys/kernel/osrelease")
        .map(|s| s.trim().to_owned())
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_owned());

    let uptime_seconds = sysfs
        .read_to_string("/proc/uptime")
        .ok()
        .and_then(|s| s.split_whitespace().next().map(str::to_owned))
        .and_then(|s| s.parse::<f64>().ok())
        .map(|v| v.max(0.0) as u64);

    let boot_time = uptime_seconds.map(|up| {
        let bt = chrono::Utc::now() - chrono::Duration::seconds(up as i64);
        bt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
    });

    Host {
        host_id,
        hostname,
        os_name,
        os_version,
        kernel_version,
        architecture: std::env::consts::ARCH.to_owned(),
        agent_version: agent_info().version.to_owned(),
        boot_time,
        uptime_seconds,
    }
}
