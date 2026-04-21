#!/usr/bin/env bash
# Wait for a TCP port (and optionally an HTTP path) to become available.
#
# Usage:
#   wait-for-port.sh <host> <port> [timeout_seconds] [http_path]
#
# Examples:
#   wait-for-port.sh localhost 31945 30                    # raw TCP probe
#   wait-for-port.sh localhost 31947 60 /api/v1/health     # HTTP 2xx probe
#
# Exits 0 on success, 1 on timeout. Quiet by default; set WAIT_DEBUG=1 to log.

set -euo pipefail

HOST="${1:-}"
PORT="${2:-}"
TIMEOUT="${3:-30}"
HTTP_PATH="${4:-}"

if [ -z "$HOST" ] || [ -z "$PORT" ]; then
  echo "usage: $0 <host> <port> [timeout_seconds] [http_path]" >&2
  exit 2
fi

log() {
  if [ "${WAIT_DEBUG:-0}" = "1" ]; then
    echo "[wait-for-port] $*" >&2
  fi
}

# Probe a raw TCP port. Try multiple tools so the script works on minimal
# Linux images (no nc, no curl, only bash /dev/tcp) and on macOS (BSD nc).
probe_tcp() {
  if command -v nc > /dev/null 2>&1; then
    nc -z -w 2 "$HOST" "$PORT" > /dev/null 2>&1
    return $?
  fi
  # Bash built-in /dev/tcp fallback (subshell to swallow connection errors).
  (exec 3<> "/dev/tcp/$HOST/$PORT") > /dev/null 2>&1
  local rc=$?
  exec 3<&- 2> /dev/null || true
  exec 3>&- 2> /dev/null || true
  return $rc
}

# Probe an HTTP path for any 2xx response.
probe_http() {
  local url="http://${HOST}:${PORT}${HTTP_PATH}"
  if ! command -v curl > /dev/null 2>&1; then
    log "curl missing, falling back to TCP probe"
    probe_tcp
    return $?
  fi
  local code
  code="$(curl -fsS -o /dev/null -w "%{http_code}" --max-time 2 "$url" 2> /dev/null || echo "000")"
  case "$code" in
    2*) return 0 ;;
    *) return 1 ;;
  esac
}

deadline=$(($(date +%s) + TIMEOUT))
attempt=0

while [ "$(date +%s)" -lt "$deadline" ]; do
  attempt=$((attempt + 1))
  if [ -n "$HTTP_PATH" ]; then
    if probe_http; then
      log "HTTP ready after ${attempt} attempt(s) on ${HOST}:${PORT}${HTTP_PATH}"
      exit 0
    fi
  else
    if probe_tcp; then
      log "TCP ready after ${attempt} attempt(s) on ${HOST}:${PORT}"
      exit 0
    fi
  fi
  sleep 2
done

echo "[wait-for-port] timeout after ${TIMEOUT}s waiting for ${HOST}:${PORT}${HTTP_PATH}" >&2
exit 1
