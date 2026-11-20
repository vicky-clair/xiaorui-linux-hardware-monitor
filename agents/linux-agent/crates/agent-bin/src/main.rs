use agent_collectors::default_collectors;
use agent_core::agent_info;
use agent_core::collector::CollectorContext;
use agent_core::command::OsCommandRunner;
use agent_core::host::discover_host;
use agent_core::scheduler::AgentRunner;
use agent_core::sysfs::LocalSysFs;
use agent_ipc::{IpcClient, IpcClientConfig};
use lhm_protocol::IpcMessageType;
use serde_json::json;
use std::env;
use std::sync::Arc;
use std::time::Duration;
use tracing::{error, info, warn};

struct CliOptions {
    once: bool,
    sysfs_root: String,
    socket_path: String,
    send_once_socket: Option<String>,
    interval_secs: u64,
}

fn parse_args() -> CliOptions {
    let mut opts = CliOptions {
        once: false,
        sysfs_root: env::var("LHM_SYSFS_ROOT").unwrap_or_else(|_| "/".into()),
        socket_path: env::var("LHM_IPC_SOCKET")
            .unwrap_or_else(|_| "/run/linux-hardware-monitor/ipc.sock".into()),
        send_once_socket: None,
        interval_secs: 5,
    };

    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--once" => opts.once = true,
            "--sysfs-root" => {
                if let Some(v) = args.next() {
                    opts.sysfs_root = v;
                }
            }
            "--socket" => {
                if let Some(v) = args.next() {
                    opts.socket_path = v;
                }
            }
            "--send-once" => {
                opts.send_once_socket = args.next();
            }
            "--interval" => {
                if let Some(v) = args.next()
                    && let Ok(secs) = v.parse::<u64>()
                {
                    opts.interval_secs = secs.max(1);
                }
            }
            "--version" => {
                let info = agent_info();
                println!(
                    "lhm-agent {} (protocol={} schema={})",
                    info.version, info.protocol, info.schema_version
                );
                std::process::exit(0);
            }
            _ => {}
        }
    }
    opts
}

#[tokio::main]
async fn main() {
    let opts = parse_args();

    // In --once mode, keep stdout clean for JSON snapshot output by writing logs to stderr.
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .json()
        .with_writer(std::io::stderr)
        .with_env_filter(filter)
        .init();

    let sysfs = Arc::new(LocalSysFs::new(&opts.sysfs_root));
    let cmd = Arc::new(OsCommandRunner::default());
    let host = discover_host(sysfs.as_ref());

    info!(
        component = "lhm-agent",
        host_id = %host.host_id,
        hostname = %host.hostname,
        sysfs_root = %opts.sysfs_root,
        "Agent initialized"
    );

    let ctx = CollectorContext {
        host_id: host.host_id.clone(),
        sysfs,
        cmd,
    };
    let mut runner = AgentRunner::new(default_collectors(&host.host_id), ctx);

    if opts.once {
        let snap = runner.run_once(Duration::from_secs(5)).await;
        let payload = json!({
            "host": host,
            "devices": snap.devices,
            "sensors": snap.sensors,
            "readings": snap.readings,
            "smart_reports": snap.smart_reports,
            "collectors": snap.collector_statuses,
            "coverage": snap.coverage,
            "diagnostics": snap.diagnostics,
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&payload).expect("serialize snapshot")
        );
        runner.shutdown().await;
        return;
    }

    let socket_path = opts
        .send_once_socket
        .clone()
        .unwrap_or_else(|| opts.socket_path.clone());
    let mut ipc = IpcClient::new(
        &host.host_id,
        IpcClientConfig {
            socket_path: socket_path.clone(),
            ..Default::default()
        },
    );

    if opts.send_once_socket.is_some() {
        let snap = runner.run_once(Duration::from_secs(5)).await;
        enqueue_snapshot(&mut ipc, &snap);
        #[cfg(unix)]
        let ok = match ipc.connect_and_flush_unix(&host).await {
            Ok(n) => {
                info!(component = "lhm-agent", flushed = n, socket = %socket_path, "Flushed snapshot via Unix Socket");
                true
            }
            Err(e) => {
                error!(component = "lhm-agent", error = %e, socket = %socket_path, "IPC send-once failed");
                false
            }
        };
        #[cfg(not(unix))]
        let ok = {
            error!("Unix Domain Socket IPC is only supported on Unix/Linux platforms");
            false
        };
        runner.shutdown().await;
        if !ok {
            std::process::exit(1);
        }
        return;
    }

    // Daemon loop with monotonic ticks, bounded IPC buffer, and graceful shutdown
    #[cfg(unix)]
    let mut attempt: u32 = 0;
    let mut tick = tokio::time::interval(Duration::from_secs(opts.interval_secs));
    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                info!(component = "lhm-agent", "Received shutdown signal");
                break;
            }
            _ = tick.tick() => {
                let snap = runner.run_once(Duration::from_secs(5)).await;
                enqueue_snapshot(&mut ipc, &snap);
                #[cfg(unix)]
                match ipc.connect_and_flush_unix(&host).await {
                    Ok(n) => {
                        attempt = 0;
                        info!(component = "lhm-agent", flushed = n, "Flushed IPC batch");
                    }
                    Err(e) => {
                        attempt = attempt.saturating_add(1);
                        let backoff = ipc.backoff_for_attempt(attempt);
                        warn!(
                            component = "lhm-agent",
                            error = %e,
                            buffered = ipc.buffered_len(),
                            backoff_secs = backoff.as_secs(),
                            "API unreachable; keeping batch in bounded memory buffer"
                        );
                    }
                }
                #[cfg(not(unix))]
                {
                    warn!(component = "lhm-agent", buffered = ipc.buffered_len(), "Unix Socket unavailable on non-Unix host");
                }
            }
        }
    }
    runner.shutdown().await;
}

fn enqueue_snapshot(ipc: &mut IpcClient, snap: &agent_core::scheduler::Snapshot) {
    ipc.enqueue(
        IpcMessageType::Inventory,
        json!({ "devices": snap.devices, "sensors": snap.sensors }),
    );
    if !snap.readings.is_empty() {
        ipc.enqueue(
            IpcMessageType::SensorReadings,
            json!({ "readings": snap.readings }),
        );
    }
    for report in &snap.smart_reports {
        ipc.enqueue(IpcMessageType::SmartReport, json!({ "report": report }));
    }
    if !snap.collector_statuses.is_empty() {
        ipc.enqueue(
            IpcMessageType::CollectorStatus,
            json!({ "collectors": snap.collector_statuses }),
        );
    }
    for diag in &snap.diagnostics {
        ipc.enqueue(IpcMessageType::Diagnostic, json!({ "diagnostic": diag }));
    }
}
