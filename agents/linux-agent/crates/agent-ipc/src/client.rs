//! Unix Domain Socket IPC 客户端（ADR-0003）：实现 4 字节大端长度分帧、`hello`/`hello_ack` 握手、序号确认 ACK 与指数退避重连。

use crate::buffer::{BoundedBuffer, BufferConfig};
use agent_core::utc_now_rfc3339;
use lhm_protocol::{
    FrameDecoder, Host, IpcMessage, IpcMessageType, PROTOCOL_NAME, ProtocolError, SCHEMA_VERSION,
    encode_frame,
};
use serde_json::json;
use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct IpcClientConfig {
    pub socket_path: String,
    pub io_timeout: Duration,
    pub heartbeat_interval: Duration,
    pub initial_backoff: Duration,
    pub max_backoff: Duration,
    pub buffer: BufferConfig,
}

impl Default for IpcClientConfig {
    fn default() -> Self {
        Self {
            socket_path: "/run/linux-hardware-monitor/ipc.sock".into(),
            io_timeout: Duration::from_secs(5),
            heartbeat_interval: Duration::from_secs(10),
            initial_backoff: Duration::from_secs(1),
            max_backoff: Duration::from_secs(30),
            buffer: BufferConfig::default(),
        }
    }
}

#[derive(Debug)]
pub enum IpcError {
    Io(String),
    Protocol(ProtocolError),
    HandshakeRejected(String),
    Timeout,
    UnexpectedReply(String),
}

impl fmt::Display for IpcError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "ipc io error: {e}"),
            Self::Protocol(e) => write!(f, "ipc protocol error: {e}"),
            Self::HandshakeRejected(r) => write!(f, "ipc handshake rejected: {r}"),
            Self::Timeout => write!(f, "ipc operation timed out"),
            Self::UnexpectedReply(m) => write!(f, "unexpected ipc reply: {m}"),
        }
    }
}

impl std::error::Error for IpcError {}

/// Framing helper working over any AsyncRead + AsyncWrite stream (UnixStream or duplex memory stream).
pub async fn send_ipc_message<W: AsyncWrite + Unpin>(
    writer: &mut W,
    msg: &IpcMessage,
    timeout: Duration,
) -> Result<(), IpcError> {
    let bytes = encode_frame(msg).map_err(IpcError::Protocol)?;
    tokio::time::timeout(timeout, async {
        writer
            .write_all(&bytes)
            .await
            .map_err(|e| IpcError::Io(e.to_string()))?;
        writer
            .flush()
            .await
            .map_err(|e| IpcError::Io(e.to_string()))
    })
    .await
    .map_err(|_| IpcError::Timeout)?
}

pub async fn recv_ipc_message<R: AsyncRead + Unpin>(
    reader: &mut R,
    decoder: &mut FrameDecoder,
    timeout: Duration,
) -> Result<IpcMessage, IpcError> {
    tokio::time::timeout(timeout, async {
        let mut chunk = [0u8; 4096];
        loop {
            let n = reader
                .read(&mut chunk)
                .await
                .map_err(|e| IpcError::Io(e.to_string()))?;
            if n == 0 {
                return Err(IpcError::Io("peer closed ipc stream".into()));
            }
            let frames = decoder.push(&chunk[..n]).map_err(IpcError::Protocol)?;
            if let Some(first) = frames.into_iter().next() {
                let msg: IpcMessage = serde_json::from_str(&first)
                    .map_err(|e| IpcError::Protocol(ProtocolError::Json(e.to_string())))?;
                return Ok(msg);
            }
        }
    })
    .await
    .map_err(|_| IpcError::Timeout)?
}

/// Stateful IPC client managing per-instance ID, monotonic sequence numbers, bounded buffer, and ACK replay.
pub struct IpcClient {
    host_id: String,
    agent_instance_id: String,
    next_seq: AtomicU64,
    buffer: BoundedBuffer,
    cfg: IpcClientConfig,
}

impl IpcClient {
    pub fn new(host_id: &str, cfg: IpcClientConfig) -> Self {
        Self {
            host_id: host_id.to_owned(),
            agent_instance_id: Uuid::new_v4().to_string(),
            next_seq: AtomicU64::new(1),
            buffer: BoundedBuffer::new(cfg.buffer),
            cfg,
        }
    }

    pub fn agent_instance_id(&self) -> &str {
        &self.agent_instance_id
    }

    pub fn next_sequence(&self) -> u64 {
        self.next_seq.fetch_add(1, Ordering::SeqCst)
    }

    pub fn build_message(
        &self,
        message_type: IpcMessageType,
        payload: serde_json::Value,
    ) -> IpcMessage {
        let seq = if message_type == IpcMessageType::Hello {
            0
        } else {
            self.next_sequence()
        };
        IpcMessage {
            protocol: PROTOCOL_NAME.into(),
            schema_version: SCHEMA_VERSION.into(),
            message_id: Uuid::new_v4().to_string(),
            message_type,
            host_id: self.host_id.clone(),
            agent_instance_id: self.agent_instance_id.clone(),
            sequence: seq,
            sent_at: utc_now_rfc3339(),
            payload,
        }
    }

    pub fn enqueue(&mut self, message_type: IpcMessageType, payload: serde_json::Value) -> u64 {
        let msg = self.build_message(message_type, payload);
        let seq = msg.sequence;
        self.buffer.push(msg);
        seq
    }

    pub fn buffered_len(&self) -> usize {
        self.buffer.len()
    }

    /// Computes exponential backoff duration for reconnect attempt `attempt` (1-based).
    pub fn backoff_for_attempt(&self, attempt: u32) -> Duration {
        let mult = 1u64
            .checked_shl(attempt.saturating_sub(1).min(10))
            .unwrap_or(1024);
        let base_ms = self.cfg.initial_backoff.as_millis() as u64;
        let max_ms = self.cfg.max_backoff.as_millis() as u64;
        Duration::from_millis(base_ms.saturating_mul(mult).min(max_ms))
    }

    /// Runs handshake + flushes all buffered messages over an established stream, awaiting ACK for each.
    pub async fn handshake_and_flush<S: AsyncRead + AsyncWrite + Unpin>(
        &mut self,
        stream: &mut S,
        host: &Host,
    ) -> Result<usize, IpcError> {
        let mut decoder = FrameDecoder::new();
        let hello = self.build_message(IpcMessageType::Hello, json!({ "host": host }));
        send_ipc_message(stream, &hello, self.cfg.io_timeout).await?;

        let reply = recv_ipc_message(stream, &mut decoder, self.cfg.io_timeout).await?;
        if reply.message_type != IpcMessageType::HelloAck {
            return Err(IpcError::UnexpectedReply(format!(
                "expected hello_ack, got {:?}",
                reply.message_type
            )));
        }
        let accepted = reply
            .payload
            .get("accepted")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !accepted {
            let reason = reply
                .payload
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("version rejected")
                .to_owned();
            return Err(IpcError::HandshakeRejected(reason));
        }

        // If any buffered messages were dropped while offline, emit drop diagnostic first.
        let drop_seq = self.next_sequence();
        if let Some(drop_msg) =
            self.buffer
                .take_drop_diagnostic(&self.host_id, &self.agent_instance_id, drop_seq)
        {
            send_ipc_message(stream, &drop_msg, self.cfg.io_timeout).await?;
            let _ = recv_ipc_message(stream, &mut decoder, self.cfg.io_timeout).await?;
        }

        let mut flushed = 0usize;
        while let Some(msg) = self.buffer.peek_front().cloned() {
            send_ipc_message(stream, &msg, self.cfg.io_timeout).await?;
            let ack = recv_ipc_message(stream, &mut decoder, self.cfg.io_timeout).await?;
            if ack.message_type != IpcMessageType::Ack {
                return Err(IpcError::UnexpectedReply(format!(
                    "expected ack, got {:?}",
                    ack.message_type
                )));
            }
            let acked = ack
                .payload
                .get("acked_sequence")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            self.buffer.ack_up_to(acked);
            flushed += 1;
        }
        Ok(flushed)
    }

    #[cfg(unix)]
    pub async fn connect_and_flush_unix(&mut self, host: &Host) -> Result<usize, IpcError> {
        let mut stream = tokio::time::timeout(
            self.cfg.io_timeout,
            tokio::net::UnixStream::connect(&self.cfg.socket_path),
        )
        .await
        .map_err(|_| IpcError::Timeout)?
        .map_err(|e| IpcError::Io(format!("{}: {e}", self.cfg.socket_path)))?;

        self.handshake_and_flush(&mut stream, host).await
    }
}
