#!/usr/bin/env bash
set -euo pipefail

# Optional helper: generate a self-signed TLS certificate with SAN for LAN HTTPS mode.
# NOT required for default LAN HTTP mode (see ADR-0009).
# Usage:
#   ./deploy/scripts/gen-self-signed-cert.sh [LAN_IP] [OUT_DIR] [DAYS]

LAN_IP="${1:-192.168.9.165}"
OUT_DIR="${2:-deploy/docker/certs}"
DAYS="${3:-825}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl is required to generate self-signed certificates." >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"
KEY_FILE="${OUT_DIR}/server.key"
CRT_FILE="${OUT_DIR}/server.crt"

if [[ -f "${KEY_FILE}" || -f "${CRT_FILE}" ]]; then
  echo "Refusing to overwrite existing cert/key in ${OUT_DIR}. Remove them manually first." >&2
  exit 2
fi

openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout "${KEY_FILE}" \
  -out "${CRT_FILE}" \
  -days "${DAYS}" \
  -subj "/CN=linux-hardware-monitor.local" \
  -addext "subjectAltName=IP:${LAN_IP},IP:127.0.0.1,DNS:localhost,DNS:linux-hardware-monitor.local"

chmod 0600 "${KEY_FILE}"
chmod 0644 "${CRT_FILE}"
echo "Generated self-signed LAN certificate:"
echo "  Key:  ${KEY_FILE}"
echo "  Cert: ${CRT_FILE}"
echo "Enable optional HTTPS mode with:"
echo "  docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.https.yml up -d"
