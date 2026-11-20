use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SysFsError {
    NotFound(String),
    PermissionDenied(String),
    Io(String),
}

impl fmt::Display for SysFsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(p) => write!(f, "path not found: {p}"),
            Self::PermissionDenied(p) => write!(f, "permission denied: {p}"),
            Self::Io(msg) => write!(f, "sysfs io error: {msg}"),
        }
    }
}

impl std::error::Error for SysFsError {}

/// Injectable abstraction over `/sys`, `/proc`, and `/etc` for deterministic testing.
pub trait SysFs: Send + Sync {
    fn read_to_string(&self, abs_path: &str) -> Result<String, SysFsError>;
    fn read_dir_names(&self, abs_path: &str) -> Result<Vec<String>, SysFsError>;
    fn exists(&self, abs_path: &str) -> bool;
    fn canonicalize(&self, abs_path: &str) -> Result<String, SysFsError>;
}

/// Real filesystem-backed implementation rooted at `/` (or a fixture directory).
#[derive(Debug, Clone)]
pub struct LocalSysFs {
    root: PathBuf,
}

impl LocalSysFs {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn system_root() -> Self {
        Self::new("/")
    }

    fn resolve(&self, abs_path: &str) -> PathBuf {
        let trimmed = abs_path.trim_start_matches('/');
        if trimmed.is_empty() {
            self.root.clone()
        } else {
            self.root.join(trimmed)
        }
    }

    fn map_io_err(path: &str, err: io::Error) -> SysFsError {
        match err.kind() {
            io::ErrorKind::NotFound => SysFsError::NotFound(path.to_owned()),
            io::ErrorKind::PermissionDenied => SysFsError::PermissionDenied(path.to_owned()),
            _ => SysFsError::Io(format!("{path}: {err}")),
        }
    }
}

impl SysFs for LocalSysFs {
    fn read_to_string(&self, abs_path: &str) -> Result<String, SysFsError> {
        let full = self.resolve(abs_path);
        fs::read_to_string(&full).map_err(|e| Self::map_io_err(abs_path, e))
    }

    fn read_dir_names(&self, abs_path: &str) -> Result<Vec<String>, SysFsError> {
        let full = self.resolve(abs_path);
        let entries = fs::read_dir(&full).map_err(|e| Self::map_io_err(abs_path, e))?;
        let mut names = Vec::new();
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                names.push(name.to_owned());
            }
        }
        names.sort();
        Ok(names)
    }

    fn exists(&self, abs_path: &str) -> bool {
        self.resolve(abs_path).exists()
    }

    fn canonicalize(&self, abs_path: &str) -> Result<String, SysFsError> {
        let full = self.resolve(abs_path);
        let canon = fs::canonicalize(&full).map_err(|e| Self::map_io_err(abs_path, e))?;
        if self.root != Path::new("/")
            && let Ok(stripped) = canon.strip_prefix(&self.root)
        {
            return Ok(format!(
                "/{}",
                stripped.to_string_lossy().replace('\\', "/")
            ));
        }
        Ok(canon.to_string_lossy().replace('\\', "/"))
    }
}

/// In-memory mock sysfs supporting simulated permissions, symlinks, and dynamic device removal.
#[derive(Debug, Default)]
pub struct MockSysFs {
    inner: RwLock<MockState>,
}

#[derive(Debug, Default)]
struct MockState {
    files: BTreeMap<String, String>,
    denied: BTreeSet<String>,
    links: BTreeMap<String, String>,
    dirs: BTreeSet<String>,
}

impl MockSysFs {
    pub fn new() -> Self {
        Self::default()
    }

    fn normalize(path: &str) -> String {
        let trimmed = path.trim_end_matches('/');
        if trimmed.is_empty() {
            "/".to_owned()
        } else if trimmed.starts_with('/') {
            trimmed.to_owned()
        } else {
            format!("/{trimmed}")
        }
    }

    fn register_parents(dirs: &mut BTreeSet<String>, path: &str) {
        let mut cur = path;
        while let Some(idx) = cur.rfind('/') {
            if idx == 0 {
                dirs.insert("/".to_owned());
                break;
            }
            cur = &cur[..idx];
            dirs.insert(cur.to_owned());
        }
    }

    pub fn add_file(&self, path: &str, content: impl Into<String>) -> &Self {
        let p = Self::normalize(path);
        let mut st = self.inner.write().expect("lock");
        Self::register_parents(&mut st.dirs, &p);
        st.denied.remove(&p);
        st.files.insert(p, content.into());
        self
    }

    pub fn add_dir(&self, path: &str) -> &Self {
        let p = Self::normalize(path);
        let mut st = self.inner.write().expect("lock");
        Self::register_parents(&mut st.dirs, &p);
        st.dirs.insert(p);
        self
    }

    pub fn add_permission_denied(&self, path: &str) -> &Self {
        let p = Self::normalize(path);
        let mut st = self.inner.write().expect("lock");
        Self::register_parents(&mut st.dirs, &p);
        st.files.remove(&p);
        st.denied.insert(p);
        self
    }

    pub fn add_symlink(&self, path: &str, target: impl Into<String>) -> &Self {
        let p = Self::normalize(path);
        let mut st = self.inner.write().expect("lock");
        Self::register_parents(&mut st.dirs, &p);
        st.links.insert(p, Self::normalize(&target.into()));
        self
    }

    pub fn remove_prefix(&self, prefix: &str) {
        let p = Self::normalize(prefix);
        let slash_p = format!("{p}/");
        let mut st = self.inner.write().expect("lock");
        st.files.retain(|k, _| k != &p && !k.starts_with(&slash_p));
        st.denied.retain(|k| k != &p && !k.starts_with(&slash_p));
        st.links.retain(|k, _| k != &p && !k.starts_with(&slash_p));
        st.dirs.retain(|k| k != &p && !k.starts_with(&slash_p));
    }
}

impl SysFs for MockSysFs {
    fn read_to_string(&self, abs_path: &str) -> Result<String, SysFsError> {
        let p = Self::normalize(abs_path);
        let st = self.inner.read().expect("lock");
        if st.denied.contains(&p) {
            return Err(SysFsError::PermissionDenied(p));
        }
        st.files.get(&p).cloned().ok_or(SysFsError::NotFound(p))
    }

    fn read_dir_names(&self, abs_path: &str) -> Result<Vec<String>, SysFsError> {
        let p = Self::normalize(abs_path);
        let st = self.inner.read().expect("lock");
        if st.denied.contains(&p) {
            return Err(SysFsError::PermissionDenied(p));
        }
        if !st.dirs.contains(&p) {
            return Err(SysFsError::NotFound(p));
        }
        let prefix = if p == "/" {
            "/".to_owned()
        } else {
            format!("{p}/")
        };
        let mut children = BTreeSet::new();
        for key in st
            .files
            .keys()
            .chain(st.denied.iter())
            .chain(st.links.keys())
            .chain(st.dirs.iter())
        {
            if let Some(rest) = key.strip_prefix(&prefix)
                && !rest.is_empty()
            {
                let child = rest.split('/').next().unwrap_or_default();
                if !child.is_empty() {
                    children.insert(child.to_owned());
                }
            }
        }
        Ok(children.into_iter().collect())
    }

    fn exists(&self, abs_path: &str) -> bool {
        let p = Self::normalize(abs_path);
        let st = self.inner.read().expect("lock");
        st.files.contains_key(&p)
            || st.denied.contains(&p)
            || st.links.contains_key(&p)
            || st.dirs.contains(&p)
    }

    fn canonicalize(&self, abs_path: &str) -> Result<String, SysFsError> {
        let p = Self::normalize(abs_path);
        let st = self.inner.read().expect("lock");
        if let Some(target) = st.links.get(&p) {
            return Ok(target.clone());
        }
        if st.files.contains_key(&p) || st.dirs.contains(&p) || st.denied.contains(&p) {
            return Ok(p);
        }
        Err(SysFsError::NotFound(p))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_sysfs_supports_files_links_denied_and_removal() {
        let fs = MockSysFs::new();
        fs.add_file("/sys/class/hwmon/hwmon0/name", "coretemp\n")
            .add_symlink(
                "/sys/class/hwmon/hwmon0/device",
                "/sys/devices/platform/coretemp.0",
            )
            .add_permission_denied("/sys/class/powercap/intel-rapl:0/energy_uj");

        assert_eq!(
            fs.read_to_string("/sys/class/hwmon/hwmon0/name").unwrap(),
            "coretemp\n"
        );
        assert_eq!(
            fs.canonicalize("/sys/class/hwmon/hwmon0/device").unwrap(),
            "/sys/devices/platform/coretemp.0"
        );
        assert_eq!(
            fs.read_to_string("/sys/class/powercap/intel-rapl:0/energy_uj")
                .unwrap_err(),
            SysFsError::PermissionDenied("/sys/class/powercap/intel-rapl:0/energy_uj".into())
        );

        fs.remove_prefix("/sys/class/hwmon/hwmon0");
        assert!(!fs.exists("/sys/class/hwmon/hwmon0/name"));
    }
}
