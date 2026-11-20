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
