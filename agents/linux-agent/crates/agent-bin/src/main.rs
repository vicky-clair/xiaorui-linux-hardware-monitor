use agent_core::agent_info;

fn main() {
    let info = agent_info();
    println!(
        "lhm-agent {} (protocol={} schema={})",
        info.version, info.protocol, info.schema_version
    );
}
