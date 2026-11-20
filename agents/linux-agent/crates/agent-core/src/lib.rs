pub mod collector;
pub mod command;
pub mod coverage;
pub mod host;
pub mod identity;
pub mod scheduler;
pub mod sysfs;

use lhm_protocol::{PROTOCOL_NAME, SCHEMA_VERSION};

/// Metadata describing the agent build and supported protocol baseline.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentInfo {
    pub version: &'static str,
    pub protocol: &'static str,
    pub schema_version: &'static str,
}

pub fn agent_info() -> AgentInfo {
    AgentInfo {
        version: env!("CARGO_PKG_VERSION"),
        protocol: PROTOCOL_NAME,
        schema_version: SCHEMA_VERSION,
    }
}

pub fn utc_now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_expected_protocol_baseline() {
        let info = agent_info();
        assert_eq!(info.protocol, "lhm-ipc");
        assert_eq!(info.schema_version, "1.0");
    }
}
