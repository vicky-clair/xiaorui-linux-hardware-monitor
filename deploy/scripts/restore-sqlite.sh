#!/usr/bin/env bash
set -euo pipefail

# Safe SQLite restore / restore-drill script.
# By default refuses to overwrite an existing target database unless --force-overwrite is passed.
# Usage:
#   ./deploy/scripts/restore-sqlite.sh <BACKUP_FILE> <TARGET_DB_PATH> [--force-overwrite]

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <BACKUP_FILE> <TARGET_DB_PATH> [--force-overwrite]" >&2
  exit 1
fi

BACKUP_FILE="$1"
TARGET_DB="$2"
FORCE="${3:-}"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "[restore] ERROR: Backup file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

if [[ -f "${BACKUP_FILE}.sha256" ]]; then
  echo "[restore] Verifying SHA-256 checksum..."
  (cd "$(dirname "${BACKUP_FILE}")" && sha256sum -c "$(basename "${BACKUP_FILE}").sha256")
fi

# Verify backup integrity before touching target
if command -v python3 >/dev/null 2>&1; then
  INTEGRITY="$(python3 -c "
import sqlite3, sys
conn = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True)
print(conn.execute('PRAGMA integrity_check;').fetchone()[0])
tables = conn.execute(\"SELECT count(*) FROM sqlite_master WHERE type='table'\").fetchone()[0]
print(f'tables={tables}')
conn.close()
" "${BACKUP_FILE}")"
  echo "[restore] Integrity check output: ${INTEGRITY//$'\n'/ | }"
  if ! grep -qx "ok" <<< "${INTEGRITY}"; then
    echo "[restore] ERROR: Backup failed PRAGMA integrity_check!" >&2
    exit 1
  fi
fi

if [[ -e "${TARGET_DB}" && "${FORCE}" != "--force-overwrite" ]]; then
  echo "[restore] REFUSED: Target ${TARGET_DB} already exists." >&2
  echo "[restore] Stop lhm-api first, back up current DB, then pass --force-overwrite." >&2
  exit 2
fi

mkdir -p "$(dirname "${TARGET_DB}")"
rm -f "${TARGET_DB}-wal" "${TARGET_DB}-shm"
cp "${BACKUP_FILE}" "${TARGET_DB}"
chmod 0640 "${TARGET_DB}" || true

echo "[restore] Restored ${BACKUP_FILE} -> ${TARGET_DB} successfully."
