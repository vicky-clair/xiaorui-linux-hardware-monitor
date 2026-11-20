#!/usr/bin/env bash
set -euo pipefail

# Online SQLite backup using VACUUM INTO (safe with WAL mode; never raw-copies live DB).
# Usage:
#   ./deploy/scripts/backup-sqlite.sh [DB_PATH] [BACKUP_DIR] [RETENTION_COUNT]
# Or against running Docker Compose API container:
#   LHM_DOCKER_CONTAINER=lhm-api ./deploy/scripts/backup-sqlite.sh /data/lhm.sqlite ./backups 14

DB_PATH="${1:-./data/lhm.sqlite}"
BACKUP_DIR="${2:-./backups}"
RETENTION_COUNT="${3:-14}"
CONTAINER="${LHM_DOCKER_CONTAINER:-}"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="lhm-${TIMESTAMP}.sqlite"
mkdir -p "${BACKUP_DIR}"
ABS_BACKUP_DIR="$(cd "${BACKUP_DIR}" && pwd)"
HOST_OUT="${ABS_BACKUP_DIR}/${BACKUP_FILE}"

echo "[backup] Starting online SQLite backup (${TIMESTAMP})..."

if [[ -n "${CONTAINER}" ]]; then
  CONTAINER_TMP="/tmp/${BACKUP_FILE}"
  docker exec "${CONTAINER}" bun -e "
    import { Database } from 'bun:sqlite';
    const db = new Database(process.argv[1], { readonly: true });
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec('VACUUM INTO ' + JSON.stringify(process.argv[2]));
    db.close();
  " "${DB_PATH}" "${CONTAINER_TMP}"
  docker cp "${CONTAINER}:${CONTAINER_TMP}" "${HOST_OUT}"
  docker exec "${CONTAINER}" rm -f "${CONTAINER_TMP}"
elif command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "${DB_PATH}" ".timeout 5000" "VACUUM INTO '${HOST_OUT}';"
elif command -v bun >/dev/null 2>&1; then
  bun -e "
    import { Database } from 'bun:sqlite';
    const db = new Database(process.argv[1], { readonly: true });
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec('VACUUM INTO ' + JSON.stringify(process.argv[2]));
    db.close();
  " "${DB_PATH}" "${HOST_OUT}"
elif command -v python3 >/dev/null 2>&1; then
  python3 -c "
import sqlite3, sys
src = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True, timeout=5.0)
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
dst.close()
src.close()
" "${DB_PATH}" "${HOST_OUT}"
else
  echo "[backup] ERROR: Neither LHM_DOCKER_CONTAINER, sqlite3, bun, nor python3 available." >&2
  exit 1
fi

# Verify backup integrity immediately
if command -v python3 >/dev/null 2>&1; then
  CHECK_RES="$(python3 -c "
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
res = conn.execute('PRAGMA integrity_check;').fetchone()[0]
conn.close()
print(res)
" "${HOST_OUT}")"
elif command -v sqlite3 >/dev/null 2>&1; then
  CHECK_RES="$(sqlite3 "${HOST_OUT}" "PRAGMA integrity_check;")"
else
  CHECK_RES="skipped"
fi

if [[ "${CHECK_RES}" != "ok" && "${CHECK_RES}" != "skipped" ]]; then
  echo "[backup] ERROR: Backup integrity check failed: ${CHECK_RES}" >&2
  rm -f "${HOST_OUT}"
  exit 1
fi

sha256sum "${HOST_OUT}" > "${HOST_OUT}.sha256"
echo "[backup] Created ${HOST_OUT} (integrity=${CHECK_RES})"

# Retention pruning (keep newest RETENTION_COUNT backups)
mapfile -t OLD_FILES < <(ls -1t "${ABS_BACKUP_DIR}"/lhm-*.sqlite 2>/dev/null | tail -n +"$((RETENTION_COUNT + 1))" || true)
for f in "${OLD_FILES[@]}"; do
  rm -f "${f}" "${f}.sha256"
  echo "[backup] Pruned old backup: $(basename "${f}")"
done
