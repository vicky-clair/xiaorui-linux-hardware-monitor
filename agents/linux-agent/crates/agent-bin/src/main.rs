//! Linux Hardware Monitor 原生宿主机采集 Agent（`lhm-agent`）入口。
//!
//! 职责边界（AGENTS.md §4）：
//! - 仅负责宿主机硬件发现、传感器采集、数据标准化、本地诊断与 Unix Domain Socket 上报；
//! - 严禁直接访问 SQLite 或承担 Web/用户认证业务；
//! - 支持三种运行模式：`--once`（单次输出 JSON 快照）、`--send-once`（单次经 IPC 上报）、常驻分级调度模式。

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
    ctrl_socket_path: String,
    send_once_socket: Option<String>,
    interval_secs: u64,
    discovery_interval_secs: u64,
}

fn default_ctrl_socket(ipc_socket: &str) -> String {
    if let Ok(v) = env::var("LHM_AGENT_CTRL_SOCKET")
        && !v.trim().is_empty()
    {
        return v;
    }
    let parent = std::path::Path::new(ipc_socket)
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or("/run/linux-hardware-monitor");
    format!("{parent}/agent-ctrl.sock")
}

fn parse_args() -> CliOptions {
    let socket_path = env::var("LHM_IPC_SOCKET")
        .unwrap_or_else(|_| "/run/linux-hardware-monitor/ipc.sock".into());
    let mut opts = CliOptions {
        once: false,
        sysfs_root: env::var("LHM_SYSFS_ROOT").unwrap_or_else(|_| "/".into()),
        ctrl_socket_path: default_ctrl_socket(&socket_path),
        socket_path,
        send_once_socket: None,
        interval_secs: env::var("LHM_AGENT_INTERVAL_SECONDS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(5),
        discovery_interval_secs: env::var("LHM_AGENT_DISCOVERY_INTERVAL_SECONDS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(60),
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
                    opts.ctrl_socket_path = default_ctrl_socket(&v);
                    opts.socket_path = v;
                }
            }
            "--ctrl-socket" => {
                if let Some(v) = args.next() {
                    opts.ctrl_socket_path = v;
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
            "--discovery-interval" => {
                if let Some(v) = args.next()
                    && let Ok(secs) = v.parse::<u64>()
                {
                    opts.discovery_interval_secs = secs.max(10);
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
        enqueue_snapshot(&mut ipc, &snap, true);
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

    // Low-overhead daemon loop: cached discovery, per-task intervals, bounded IPC buffer,
    // plus zero-polling Unix control socket (`agent-ctrl.sock`) for on-demand manual "SCAN".
    #[cfg(unix)]
    let mut attempt: u32 = 0;
    #[cfg(unix)]
    let mut sigterm =
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).ok();
    #[cfg(unix)]
    let ctrl_listener = bind_control_socket(&opts.ctrl_socket_path);
    #[cfg(unix)]
    let mut last_manual_scan: Option<std::time::Instant> = None;

    let mut tick = tokio::time::interval(Duration::from_secs(opts.interval_secs));
    let discovery_interval = Duration::from_secs(opts.discovery_interval_secs);
    loop {
        #[cfg(unix)]
        let terminate_fut = async {
            if let Some(ref mut s) = sigterm {
                s.recv().await;
            } else {
                std::future::pending::<()>().await;
            }
        };
        #[cfg(not(unix))]
        let terminate_fut = std::future::pending::<()>();

        #[cfg(unix)]
        let ctrl_accept_fut = async {
            if let Some(ref listener) = ctrl_listener {
                listener.accept().await.ok()
            } else {
                std::future::pending().await
            }
        };
        #[cfg(not(unix))]
        let ctrl_accept_fut = std::future::pending::<Option<()>>();

        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                info!(component = "lhm-agent", "Received SIGINT shutdown signal");
                break;
            }
            _ = terminate_fut => {
                info!(component = "lhm-agent", "Received SIGTERM shutdown signal");
                break;
            }
            accepted = ctrl_accept_fut => {
                #[cfg(unix)]
                if let Some((mut stream, _)) = accepted {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut buf = [0u8; 32];
                    let n = tokio::time::timeout(Duration::from_secs(2), stream.read(&mut buf))
                        .await
                        .ok()
                        .and_then(|r| r.ok())
                        .unwrap_or(0);
                    let cmd = std::str::from_utf8(&buf[..n]).unwrap_or("").trim();
                    if cmd != "SCAN" {
                        let _ = stream.write_all(b"ERR INVALID_COMMAND\n").await;
                        continue;
                    }
                    // 防刷保护：两次手动扫描至少间隔 5 秒
                    if let Some(prev) = last_manual_scan
                        && prev.elapsed() < Duration::from_secs(5)
                    {
                        let _ = stream.write_all(b"ERR RATE_LIMITED\n").await;
                        continue;
                    }
                    last_manual_scan = Some(std::time::Instant::now());
                    info!(component = "lhm-agent", "Received on-demand manual SCAN request via control socket");
                    let snap = runner.run_once(Duration::from_secs(5)).await;
                    enqueue_snapshot(&mut ipc, &snap, true);
                    match ipc.connect_and_flush_unix(&host).await {
                        Ok(flushed) => {
                            attempt = 0;
                            info!(component = "lhm-agent", flushed, "Completed manual on-demand global scan");
                            let _ = stream.write_all(b"OK\n").await;
                        }
                        Err(e) => {
                            warn!(component = "lhm-agent", error = %e, "Manual scan IPC flush failed");
                            let _ = stream.write_all(b"ERR IPC_FLUSH_FAILED\n").await;
                        }
                    }
                }
                #[cfg(not(unix))]
                let _ = accepted;
            }
            _ = tick.tick() => {
                let tick_snap = runner.run_tick(Duration::from_secs(5), discovery_interval).await;
                enqueue_snapshot(&mut ipc, &tick_snap.snapshot, tick_snap.inventory_refreshed);
                if ipc.buffered_len() == 0 {
                    continue;
                }
                #[cfg(unix)]
                match ipc.connect_and_flush_unix(&host).await {
                    Ok(n) => {
                        attempt = 0;
                        info!(component = "lhm-agent", flushed = n, inventory_refreshed = tick_snap.inventory_refreshed, "Flushed IPC batch");
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
    #[cfg(unix)]
    let _ = std::fs::remove_file(&opts.ctrl_socket_path);
    runner.shutdown().await;
}

/// 绑定按需手动检测控制 Socket（0660，仅接受固定字面量 `SCAN`，零轮询开销）。
#[cfg(unix)]
fn bind_control_socket(path: &str) -> Option<tokio::net::UnixListener> {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::remove_file(path);
    match tokio::net::UnixListener::bind(path) {
        Ok(listener) => {
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o660));
            info!(component = "lhm-agent", ctrl_socket = %path, "Listening for on-demand SCAN requests");
            Some(listener)
        }
        Err(e) => {
            warn!(component = "lhm-agent", ctrl_socket = %path, error = %e, "Failed to bind control socket; manual trigger unavailable");
            None
        }
    }
}

fn enqueue_snapshot(
    ipc: &mut IpcClient,
    snap: &agent_core::scheduler::Snapshot,
    include_inventory: bool,
) {
    if include_inventory && (!snap.devices.is_empty() || !snap.sensors.is_empty()) {
        ipc.enqueue(
            IpcMessageType::Inventory,
            json!({ "devices": snap.devices, "sensors": snap.sensors }),
        );
    }
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
