//! IPC 断线重连有界内存缓冲队列（ADR-0003）：支持高优先级报文保护、超限淘汰与结构化丢弃诊断上报，防止断连期间内存无限增长。

use agent_core::utc_now_rfc3339;
use lhm_protocol::{
    Diagnostic, DiagnosticLevel, IpcMessage, IpcMessageType, PROTOCOL_NAME, SCHEMA_VERSION,
};
use serde_json::json;
use std::collections::VecDeque;
use uuid::Uuid;

#[derive(Debug, Clone, Copy)]
pub struct BufferConfig {
    pub max_reading_messages: usize,
    pub max_bytes: usize,
}

impl Default for BufferConfig {
    fn default() -> Self {
        Self {
            max_reading_messages: 10_000,
            max_bytes: 32 * 1024 * 1024, // 32 MiB (ADR-0003)
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DropSummary {
    pub dropped_count: u64,
    pub first_dropped_at: String,
    pub last_dropped_at: String,
}

#[derive(Debug, Clone)]
struct QueuedFrame {
    message: IpcMessage,
    approx_bytes: usize,
}

/// Bounded in-memory queue used when API is unreachable (ADR-0003).
/// Evicts oldest `sensor_readings` first while preserving `inventory`, `smart_report`,
/// `collector_status`, and `diagnostic` messages.
#[derive(Debug)]
pub struct BoundedBuffer {
    cfg: BufferConfig,
    queue: VecDeque<QueuedFrame>,
    total_bytes: usize,
    reading_messages: usize,
    pending_drop: Option<DropSummary>,
}

impl BoundedBuffer {
    pub fn new(cfg: BufferConfig) -> Self {
        Self {
            cfg,
            queue: VecDeque::new(),
            total_bytes: 0,
            reading_messages: 0,
            pending_drop: None,
        }
    }

    pub fn push(&mut self, message: IpcMessage) {
        let approx_bytes = serde_json::to_vec(&message).map(|v| v.len()).unwrap_or(256);
        let is_reading = message.message_type == IpcMessageType::SensorReadings;

        self.queue.push_back(QueuedFrame {
            message,
            approx_bytes,
        });
        self.total_bytes += approx_bytes;
        if is_reading {
            self.reading_messages += 1;
        }

        self.enforce_limits();
    }

    fn enforce_limits(&mut self) {
        while self.reading_messages > self.cfg.max_reading_messages
            || self.total_bytes > self.cfg.max_bytes
        {
            // Prefer evicting the oldest sensor_readings message first (ADR-0003)
            let evict_idx = self
                .queue
                .iter()
                .position(|q| q.message.message_type == IpcMessageType::SensorReadings)
                .unwrap_or(0);

            if let Some(removed) = self.queue.remove(evict_idx) {
                self.total_bytes = self.total_bytes.saturating_sub(removed.approx_bytes);
                if removed.message_type_is_reading() {
                    self.reading_messages = self.reading_messages.saturating_sub(1);
                }
                let ts = removed.message.sent_at;
                match &mut self.pending_drop {
                    Some(summary) => {
                        summary.dropped_count += 1;
                        summary.last_dropped_at = ts;
                    }
                    None => {
                        self.pending_drop = Some(DropSummary {
                            dropped_count: 1,
                            first_dropped_at: ts.clone(),
                            last_dropped_at: ts,
                        });
                    }
                }
            } else {
                break;
            }
        }
    }

    pub fn len(&self) -> usize {
        self.queue.len()
    }

    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }

    pub fn peek_front(&self) -> Option<&IpcMessage> {
        self.queue.front().map(|q| &q.message)
    }

    pub fn ack_up_to(&mut self, acked_sequence: u64) {
        while let Some(front) = self.queue.front() {
            if front.message.sequence <= acked_sequence {
                if let Some(removed) = self.queue.pop_front() {
                    self.total_bytes = self.total_bytes.saturating_sub(removed.approx_bytes);
                    if removed.message_type_is_reading() {
                        self.reading_messages = self.reading_messages.saturating_sub(1);
                    }
                }
            } else {
                break;
            }
        }
    }

    /// Consumes accumulated drop summary and emits a structured Diagnostic message for reconnect reporting.
    pub fn take_drop_diagnostic(
        &mut self,
        host_id: &str,
        agent_instance_id: &str,
        sequence: u64,
    ) -> Option<IpcMessage> {
        let summary = self.pending_drop.take()?;
        let now = utc_now_rfc3339();
        let mut details = std::collections::BTreeMap::new();
        details.insert("dropped_count".into(), json!(summary.dropped_count));
        details.insert("first_dropped_at".into(), json!(summary.first_dropped_at));
        details.insert("last_dropped_at".into(), json!(summary.last_dropped_at));

        let diag = Diagnostic {
            diagnostic_id: format!("diag-{}", Uuid::new_v4()),
            host_id: host_id.to_owned(),
            device_id: None,
            collector_name: Some("ipc".into()),
            level: DiagnosticLevel::Warn,
            error_code: "IPC_BUFFER_DROPPED".into(),
            source: "agent-ipc".into(),
            message: format!(
                "Dropped {} buffered IPC message(s) while API was unreachable ({} .. {})",
                summary.dropped_count, summary.first_dropped_at, summary.last_dropped_at
            ),
            remediation: Some(
                "Check API availability or increase agent IPC buffer capacity if outages persist"
                    .into(),
            ),
            occurred_at: now.clone(),
            details: Some(details),
        };

        Some(IpcMessage {
            protocol: PROTOCOL_NAME.into(),
            schema_version: SCHEMA_VERSION.into(),
            message_id: Uuid::new_v4().to_string(),
            message_type: IpcMessageType::Diagnostic,
            host_id: host_id.to_owned(),
            agent_instance_id: agent_instance_id.to_owned(),
            sequence,
            sent_at: now,
            payload: json!({ "diagnostic": diag }),
        })
    }
}

impl QueuedFrame {
    fn message_type_is_reading(&self) -> bool {
        self.message.message_type == IpcMessageType::SensorReadings
    }
}
