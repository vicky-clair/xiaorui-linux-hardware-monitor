//! Agent 侧 Unix Domain Socket IPC 客户端（ADR-0003）：
//! 包含 4 字节大端长度前缀分帧、握手与 ACK 确认、断线指数退避重连及有界内存缓冲（满时丢弃最旧批次并产出诊断）。

pub mod buffer;
pub mod client;

pub use buffer::{BoundedBuffer, BufferConfig, DropSummary};
pub use client::{IpcClient, IpcClientConfig, IpcError};
