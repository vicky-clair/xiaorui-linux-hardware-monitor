//! 硬件设备与传感器稳定 ID 生成模块（AGENTS.md §7）。
//!
//! 严格使用 PCI BDF、磁盘 WWN/序列号或拓扑路径生成可跨重启复现的稳定 ID（如 `gpu-pci-0000-00-02-0`），
//! 禁止使用 `hwmon3`、`gpu-001` 等会随启动顺序漂移的临时编号。

/// 将任意硬件标识片段规整为小写 `[a-z0-9-]`。
pub fn normalize_slug(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut prev_dash = false;
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "unknown".to_owned()
    } else {
        out
    }
}

/// Builds a schema-compliant StableId (`^[a-z0-9]+(?:-[a-z0-9]+)+$`, max 128 chars).
pub fn build_stable_id(parts: &[&str]) -> String {
    let cleaned: Vec<String> = parts
        .iter()
        .map(|p| normalize_slug(p))
        .filter(|s| !s.is_empty())
        .collect();
    let mut id = cleaned.join("-");
    if !id.contains('-') {
        id = format!("dev-{id}");
    }
    if id.len() > 128 {
        id.truncate(128);
        while id.ends_with('-') {
            id.pop();
        }
    }
    id
}

pub fn pci_device_id(kind: &str, pci_bus_id: &str) -> String {
    build_stable_id(&[kind, "pci", pci_bus_id])
}

pub fn disk_wwn_id(wwn: &str) -> String {
    build_stable_id(&["disk", "wwn", wwn])
}

pub fn disk_serial_id(serial: &str) -> String {
    build_stable_id(&["disk", "serial", serial])
}

pub fn disk_path_id(topology: &str) -> String {
    build_stable_id(&["disk", "path", topology])
}

pub fn sensor_id(device_id: &str, metric: &str, label: &str) -> String {
    build_stable_id(&[device_id, metric, label])
}

/// Extracts a PCI BDF such as `0000:01:00.0` from a canonical sysfs path if present.
pub fn extract_pci_bdf(sysfs_path: &str) -> Option<String> {
    for segment in sysfs_path.split('/').rev() {
        let bytes = segment.as_bytes();
        // Format: DDDD:BB:DD.F (12 chars)
        if bytes.len() == 12
            && bytes[4] == b':'
            && bytes[7] == b':'
            && bytes[10] == b'.'
            && bytes[0..4].iter().all(|b| b.is_ascii_hexdigit())
            && bytes[5..7].iter().all(|b| b.is_ascii_hexdigit())
            && bytes[8..10].iter().all(|b| b.is_ascii_hexdigit())
            && bytes[11].is_ascii_hexdigit()
        {
            return Some(segment.to_ascii_lowercase());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_stable_pci_and_sensor_ids() {
        let dev = pci_device_id("gpu", "0000:00:02.0");
        assert_eq!(dev, "gpu-pci-0000-00-02-0");
        let sen = sensor_id(&dev, "temp", "Package id 0");
        assert_eq!(sen, "gpu-pci-0000-00-02-0-temp-package-id-0");
    }

    #[test]
    fn extracts_pci_bdf_from_sysfs_topology() {
        assert_eq!(
            extract_pci_bdf("/sys/devices/pci0000:00/0000:00:02.0"),
            Some("0000:00:02.0".to_owned())
        );
        assert_eq!(extract_pci_bdf("/sys/devices/platform/coretemp.0"), None);
    }
}
