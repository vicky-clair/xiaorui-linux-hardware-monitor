use agent_ipc::client::{recv_ipc_message, send_ipc_message};
use agent_ipc::{BufferConfig, IpcClient, IpcClientConfig};
use lhm_protocol::{FrameDecoder, Host, IpcMessage, IpcMessageType, PROTOCOL_NAME, SCHEMA_VERSION};
use serde_json::json;
use std::time::Duration;

fn sample_host() -> Host {
    Host {
        host_id: "host-test-01".into(),
        hostname: "debian-test".into(),
        os_name: "Debian GNU/Linux".into(),
        os_version: "13.6".into(),
        kernel_version: "6.12.107+deb13-amd64".into(),
        architecture: "x86_64".into(),
        agent_version: "0.1.0".into(),
        boot_time: None,
        uptime_seconds: Some(1200),
    }
}

fn make_reply(
    req: &IpcMessage,
    msg_type: IpcMessageType,
    payload: serde_json::Value,
) -> IpcMessage {
    IpcMessage {
        protocol: PROTOCOL_NAME.into(),
        schema_version: SCHEMA_VERSION.into(),
        message_id: "srv-msg".into(),
        message_type: msg_type,
        host_id: req.host_id.clone(),
        agent_instance_id: req.agent_instance_id.clone(),
        sequence: req.sequence,
        sent_at: "2026-11-20T10:00:00Z".into(),
        payload,
    }
}

#[tokio::test]
async fn ipc_handshake_ack_and_bounded_eviction_diagnostic() {
    let cfg = IpcClientConfig {
        buffer: BufferConfig {
            max_reading_messages: 2,
            max_bytes: 1024 * 1024,
        },
        ..Default::default()
    };
    let mut client = IpcClient::new("host-test-01", cfg);

    // Queue 1 inventory + 3 sensor_readings -> oldest sensor_readings evicted, inventory preserved!
    client.enqueue(
        IpcMessageType::Inventory,
        json!({ "devices": [], "sensors": [] }),
    );
    client.enqueue(IpcMessageType::SensorReadings, json!({ "readings": [] }));
    client.enqueue(IpcMessageType::SensorReadings, json!({ "readings": [] }));
    client.enqueue(IpcMessageType::SensorReadings, json!({ "readings": [] }));
    assert_eq!(client.buffered_len(), 3); // 1 inventory + 2 newest readings

    let (mut client_stream, mut server_stream) = tokio::io::duplex(64 * 1024);

    let server = tokio::spawn(async move {
        let mut decoder = FrameDecoder::new();
        let mut received_types = Vec::new();
        let timeout = Duration::from_secs(3);

        // 1. Hello -> HelloAck
        let hello = recv_ipc_message(&mut server_stream, &mut decoder, timeout)
            .await
            .expect("hello");
        assert_eq!(hello.message_type, IpcMessageType::Hello);
        let ack = make_reply(
            &hello,
            IpcMessageType::HelloAck,
            json!({ "accepted": true, "server_schema_version": "1.0" }),
        );
        send_ipc_message(&mut server_stream, &ack, timeout)
            .await
            .expect("send hello_ack");

        // 2. Expect 1 drop diagnostic + 3 buffered frames (inventory first, then 2 readings)
        for _ in 0..4 {
            let msg = recv_ipc_message(&mut server_stream, &mut decoder, timeout)
                .await
                .expect("msg");
            received_types.push(msg.message_type);
            let reply = make_reply(
                &msg,
                IpcMessageType::Ack,
                json!({ "acked_sequence": msg.sequence }),
            );
            send_ipc_message(&mut server_stream, &reply, timeout)
                .await
                .expect("send ack");
        }
        received_types
    });

    let flushed = client
        .handshake_and_flush(&mut client_stream, &sample_host())
        .await
        .expect("handshake_and_flush");
    assert_eq!(flushed, 3);
    assert_eq!(client.buffered_len(), 0);

    let types = server.await.expect("server join");
    assert_eq!(
        types,
        vec![
            IpcMessageType::Diagnostic, // IPC_BUFFER_DROPPED
            IpcMessageType::Inventory,  // preserved over readings!
            IpcMessageType::SensorReadings,
            IpcMessageType::SensorReadings,
        ]
    );
}

#[test]
fn exponential_backoff_is_bounded() {
    let client = IpcClient::new("host-test-01", IpcClientConfig::default());
    assert_eq!(client.backoff_for_attempt(1), Duration::from_secs(1));
    assert_eq!(client.backoff_for_attempt(2), Duration::from_secs(2));
    assert_eq!(client.backoff_for_attempt(3), Duration::from_secs(4));
    assert_eq!(client.backoff_for_attempt(10), Duration::from_secs(30));
}

#[cfg(unix)]
#[tokio::test]
async fn real_unix_domain_socket_roundtrip() {
    use tokio::net::UnixListener;

    let sock_path =
        std::env::temp_dir().join(format!("lhm-ipc-test-{}.sock", uuid::Uuid::new_v4()));
    let _ = std::fs::remove_file(&sock_path);
    let listener = UnixListener::bind(&sock_path).expect("bind unix socket");

    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept");
        let mut decoder = FrameDecoder::new();
        let timeout = Duration::from_secs(3);

        let hello = recv_ipc_message(&mut stream, &mut decoder, timeout)
            .await
            .expect("hello");
        assert_eq!(hello.message_type, IpcMessageType::Hello);
        send_ipc_message(
            &mut stream,
            &make_reply(
                &hello,
                IpcMessageType::HelloAck,
                json!({ "accepted": true, "server_schema_version": "1.0" }),
            ),
            timeout,
        )
        .await
        .expect("hello_ack");

        let hb = recv_ipc_message(&mut stream, &mut decoder, timeout)
            .await
            .expect("heartbeat");
        assert_eq!(hb.message_type, IpcMessageType::Heartbeat);
        send_ipc_message(
            &mut stream,
            &make_reply(
                &hb,
                IpcMessageType::Ack,
                json!({ "acked_sequence": hb.sequence }),
            ),
            timeout,
        )
        .await
        .expect("ack");
    });

    let cfg = IpcClientConfig {
        socket_path: sock_path.to_string_lossy().into_owned(),
        ..Default::default()
    };
    let mut client = IpcClient::new("host-test-01", cfg);
    client.enqueue(IpcMessageType::Heartbeat, json!({ "uptime_seconds": 1200 }));

    let flushed = client
        .connect_and_flush_unix(&sample_host())
        .await
        .expect("unix flush");
    assert_eq!(flushed, 1);
    server.await.expect("server done");
    let _ = std::fs::remove_file(&sock_path);
}
