#!/usr/bin/env bash
set -euo pipefail

# Run lhm-agent as the current non-root user inside the repo directory (zero sudo, zero host modification).
# Usage:
#   ./deploy/scripts/run-agent-local.sh [--once | --send-once | --interval 5]

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="${LHM_AGENT_BIN:-${REPO_ROOT}/target/release/lhm-agent}"
SOCKET="${LHM_IPC_SOCKET:-${REPO_ROOT}/run/ipc.sock}"

if [[ ! -x "${BIN}" ]]; then
  echo "[agent] Release binary not found at ${BIN}; falling back to target/debug/lhm-agent..." >&2
  BIN="${REPO_ROOT}/target/debug/lhm-agent"
fi

if [[ ! -x "${BIN}" ]]; then
  echo "[agent] ERROR: lhm-agent binary not built. Run: CARGO_BUILD_JOBS=2 cargo build --release -p lhm-agent" >&2
  exit 1
fi

mkdir -p "$(dirname "${SOCKET}")"

# Yield CPU & disk I/O priority to minimize host performance impact
LOW_PRIO_PREFIX=()
if command -v ionice >/dev/null 2>&1; then
  LOW_PRIO_PREFIX+=(ionice -c 3)
fi
if command -v nice >/dev/null 2>&1; then
  LOW_PRIO_PREFIX+=(nice -n 10)
fi

if [[ "${1:-}" == "--send-once" ]]; then
  exec "${LOW_PRIO_PREFIX[@]}" "${BIN}" --send-once "${SOCKET}"
elif [[ "${1:-}" == "--once" ]]; then
  exec "${LOW_PRIO_PREFIX[@]}" "${BIN}" --once
else
  exec "${LOW_PRIO_PREFIX[@]}" "${BIN}" --socket "${SOCKET}" "$@"
fi
