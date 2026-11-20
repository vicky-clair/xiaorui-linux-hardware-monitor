//! 外部硬件工具安全执行器（ADR-0006 / AGENTS.md §2）。
//!
//! 强制安全边界：
//! - 仅允许执行绝对路径白名单中的二进制（`smartctl` / `nvme` / `nvidia-smi`）；
//! - 严禁通过 Shell 拼接命令，一律使用参数数组直接 `exec`；
//! - 强制超时终止与 2 MiB 输出字节上限，防止异常输出拖垮宿主机内存。

use crate::collector::BoxFuture;
use std::collections::BTreeMap;
use std::fmt;
use std::io;
use std::process::Stdio;
use std::sync::RwLock;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

/// Maximum captured bytes per stdout/stderr stream (2 MiB).
pub const MAX_COMMAND_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

/// Strictly allowlisted external binaries (ADR-0006, AGENTS.md §2).
pub const ALLOWED_BINARIES: &[&str] = &[
    "/usr/sbin/smartctl",
    "/usr/bin/smartctl",
    "/usr/sbin/nvme",
    "/usr/bin/nvme",
    "/usr/bin/nvidia-smi",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandError {
    NotAllowed(String),
    NotFound(String),
    PermissionDenied(String),
    Timeout { program: String, timeout_ms: u64 },
    OutputTooLarge { program: String, max_bytes: usize },
    Io(String),
}

impl fmt::Display for CommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotAllowed(p) => write!(f, "program not in allowlist: {p}"),
            Self::NotFound(p) => write!(f, "program not found: {p}"),
            Self::PermissionDenied(p) => write!(f, "permission denied executing: {p}"),
            Self::Timeout {
                program,
                timeout_ms,
            } => write!(f, "command timed out after {timeout_ms}ms: {program}"),
            Self::OutputTooLarge { program, max_bytes } => {
                write!(f, "command output exceeded {max_bytes} bytes: {program}")
            }
            Self::Io(msg) => write!(f, "command io error: {msg}"),
        }
    }
}

impl std::error::Error for CommandError {}

pub trait CommandRunner: Send + Sync {
    fn run<'a>(
        &'a self,
        program: &'a str,
        args: &'a [&'a str],
        timeout: Duration,
    ) -> BoxFuture<'a, Result<CommandOutput, CommandError>>;
}

/// Safe OS process runner enforcing allowlist, argument array (never shell), timeout, and output cap.
#[derive(Debug, Clone)]
pub struct OsCommandRunner {
    max_output_bytes: usize,
}

impl Default for OsCommandRunner {
    fn default() -> Self {
        Self {
            max_output_bytes: MAX_COMMAND_OUTPUT_BYTES,
        }
    }
}

impl OsCommandRunner {
    pub fn new(max_output_bytes: usize) -> Self {
        Self { max_output_bytes }
    }
}

async fn read_bounded<R: tokio::io::AsyncRead + Unpin>(
    mut reader: R,
    max_bytes: usize,
    program: &str,
) -> Result<String, CommandError> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let n = reader
            .read(&mut chunk)
            .await
            .map_err(|e| CommandError::Io(e.to_string()))?;
        if n == 0 {
            break;
        }
        if buf.len() + n > max_bytes {
            return Err(CommandError::OutputTooLarge {
                program: program.to_owned(),
                max_bytes,
            });
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

impl CommandRunner for OsCommandRunner {
    fn run<'a>(
        &'a self,
        program: &'a str,
        args: &'a [&'a str],
        timeout: Duration,
    ) -> BoxFuture<'a, Result<CommandOutput, CommandError>> {
        Box::pin(async move {
            if !ALLOWED_BINARIES.contains(&program) {
                return Err(CommandError::NotAllowed(program.to_owned()));
            }

            let mut cmd = Command::new(program);
            cmd.args(args)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .kill_on_drop(true);

            let mut child = cmd.spawn().map_err(|e| match e.kind() {
                io::ErrorKind::NotFound => CommandError::NotFound(program.to_owned()),
                io::ErrorKind::PermissionDenied => {
                    CommandError::PermissionDenied(program.to_owned())
                }
                _ => CommandError::Io(format!("{program}: {e}")),
            })?;

            let stdout_pipe = child.stdout.take().expect("stdout piped");
            let stderr_pipe = child.stderr.take().expect("stderr piped");
            let max_bytes = self.max_output_bytes;

            let fut = async {
                let (out_res, err_res, status_res) = tokio::join!(
                    read_bounded(stdout_pipe, max_bytes, program),
                    read_bounded(stderr_pipe, max_bytes, program),
                    child.wait(),
                );
                let stdout = out_res?;
                let stderr = err_res?;
                let status = status_res.map_err(|e| CommandError::Io(e.to_string()))?;
                Ok(CommandOutput {
                    exit_code: status.code().unwrap_or(-1),
                    stdout,
                    stderr,
                })
            };

            match tokio::time::timeout(timeout, fut).await {
                Ok(result) => result,
                Err(_) => {
                    let _ = child.kill().await;
                    Err(CommandError::Timeout {
                        program: program.to_owned(),
                        timeout_ms: timeout.as_millis() as u64,
                    })
                }
            }
        })
    }
}

type MockResponseMap = BTreeMap<(String, Vec<String>), Result<CommandOutput, CommandError>>;

/// Deterministic mock command runner for offline & simulated hardware tests.
#[derive(Debug, Default)]
pub struct MockCommandRunner {
    responses: RwLock<MockResponseMap>,
}

impl MockCommandRunner {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(
        &self,
        program: &str,
        args: &[&str],
        response: Result<CommandOutput, CommandError>,
    ) -> &Self {
        let key = (
            program.to_owned(),
            args.iter().map(|s| (*s).to_owned()).collect(),
        );
        self.responses.write().expect("lock").insert(key, response);
        self
    }
}

impl CommandRunner for MockCommandRunner {
    fn run<'a>(
        &'a self,
        program: &'a str,
        args: &'a [&'a str],
        _timeout: Duration,
    ) -> BoxFuture<'a, Result<CommandOutput, CommandError>> {
        let key = (
            program.to_owned(),
            args.iter().map(|s| (*s).to_owned()).collect(),
        );
        let result = self
            .responses
            .read()
            .expect("lock")
            .get(&key)
            .cloned()
            .unwrap_or_else(|| Err(CommandError::NotFound(program.to_owned())));
        Box::pin(async move { result })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn os_runner_rejects_unlisted_program() {
        let runner = OsCommandRunner::default();
        let err = runner
            .run("/bin/sh", &["-c", "echo hi"], Duration::from_secs(1))
            .await
            .unwrap_err();
        assert_eq!(err, CommandError::NotAllowed("/bin/sh".into()));
    }
}
