#!/usr/bin/env bash
# Cepage 1-click install
# https://github.com/cgarrot/Cepage
#
# One-line install:
#   curl -fsSL https://raw.githubusercontent.com/cgarrot/Cepage/main/scripts/install.sh | bash
#
# Flags (when called with bash -s -- ...):
#   --dir <path>    Install directory (default: ~/cepage)
#   --no-open       Do not open the browser at the end
#   --no-start      Do not start API/web (just clone + install + db setup)
#   --yes           Auto-confirm any interactive prompt
#   --help          Show this help

set -euo pipefail

# ─── Configuration ──────────────────────────────────────────────────────────

REPO_URL="https://github.com/cgarrot/Cepage"
RAW_BASE="https://raw.githubusercontent.com/cgarrot/Cepage/main"
DEFAULT_DIR="${HOME}/cepage"
NODE_MIN_MAJOR=20
PNPM_MIN_MAJOR=9

CEPAGE_DIR="${CEPAGE_DIR:-$DEFAULT_DIR}"
OPEN_BROWSER=1
START_APP=1
ASSUME_YES=0
WEB_PORT="${WEB_PORT:-31961}"
API_PORT="${API_PORT:-31947}"
DB_PORT="${DB_PORT:-31945}"
DAEMON_HEALTH_PORT="${CEPAGE_DAEMON_HEALTH_PORT:-31982}"

# ─── Logging helpers ────────────────────────────────────────────────────────

# Detect color support, fall back to plain text.
if [ -t 1 ] && command -v tput > /dev/null 2>&1 && [ "$(tput colors 2> /dev/null || echo 0)" -ge 8 ]; then
  C_RESET=$(tput sgr0)
  C_BOLD=$(tput bold)
  C_DIM=$(tput dim)
  C_RED=$(tput setaf 1)
  C_GREEN=$(tput setaf 2)
  C_YELLOW=$(tput setaf 3)
  C_BLUE=$(tput setaf 4)
else
  C_RESET="" C_BOLD="" C_DIM="" C_RED="" C_GREEN="" C_YELLOW="" C_BLUE=""
fi

step() { printf "%s==>%s %s%s%s\n" "$C_BLUE" "$C_RESET" "$C_BOLD" "$*" "$C_RESET"; }
ok() { printf "  %s✓%s %s\n" "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf "  %s!%s %s\n" "$C_YELLOW" "$C_RESET" "$*" >&2; }
err() { printf "%sError:%s %s\n" "$C_RED" "$C_RESET" "$*" >&2; }
info() { printf "  %s%s%s\n" "$C_DIM" "$*" "$C_RESET"; }

confirm() {
  # When piped (curl | bash), stdin is the script — we read from /dev/tty.
  local prompt="$1"
  local default="${2:-N}"
  if [ "$ASSUME_YES" = "1" ]; then return 0; fi
  if [ ! -t 0 ] && [ -e /dev/tty ]; then
    printf "  %s? %s [%s]: " "$C_YELLOW" "$prompt" "$default" > /dev/tty
    read -r answer < /dev/tty
  else
    printf "  ? %s [%s]: " "$prompt" "$default"
    read -r answer
  fi
  answer="${answer:-$default}"
  case "$answer" in
    y | Y | yes | YES) return 0 ;;
    *) return 1 ;;
  esac
}

# ─── Flag parsing ───────────────────────────────────────────────────────────

print_help() {
  cat <<'EOF'
Cepage installer — sets up Postgres + the dev stack.

Usage:
  curl -fsSL https://raw.githubusercontent.com/cgarrot/Cepage/main/scripts/install.sh | bash
  bash install.sh [flags]

Flags:
  --dir <path>    Install directory (default: ~/cepage, override with $CEPAGE_DIR)
  --no-open       Skip opening the browser at the end
  --no-start      Just clone + install + db setup, don't start the dev servers
  --yes           Auto-confirm interactive prompts (for CI)
  --help          Show this help

Environment:
  CEPAGE_DIR    Same as --dir
  WEB_PORT               Web server port (default 31961)
  API_PORT               API server port (default 31947)
  DB_PORT                Postgres host port (default 31945)
  CEPAGE_DAEMON_HEALTH_PORT  Daemon health HTTP port (default 31982)
EOF
}

parse_flags() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --dir)
        CEPAGE_DIR="$2"
        shift 2
        ;;
      --no-open)
        OPEN_BROWSER=0
        shift
        ;;
      --no-start)
        START_APP=0
        shift
        ;;
      --yes | -y)
        ASSUME_YES=1
        shift
        ;;
      --help | -h)
        print_help
        exit 0
        ;;
      *)
        warn "unknown flag: $1"
        shift
        ;;
    esac
  done
}

# ─── OS detection ───────────────────────────────────────────────────────────

detect_os() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux)
      if [ -f /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        case "${ID:-}" in
          ubuntu | debian) echo "debian" ;;
          fedora | rhel | centos | rocky | almalinux) echo "rhel" ;;
          *) echo "linux-other" ;;
        esac
      else
        echo "linux-other"
      fi
      ;;
    MINGW* | CYGWIN* | MSYS*)
      echo "windows"
      ;;
    *) echo "unknown" ;;
  esac
}

OS="$(detect_os)"

# ─── Version helpers ────────────────────────────────────────────────────────

major_version() {
  # Extracts the leading integer (e.g. "v20.10.0" -> 20).
  echo "$1" | sed -E 's/^[^0-9]*([0-9]+).*/\1/'
}

# ─── Prerequisite checks ────────────────────────────────────────────────────

print_install_hint() {
  local tool="$1"
  case "$OS:$tool" in
    macos:node) info "macOS: brew install node@20" ;;
    macos:pnpm) info "macOS: npm i -g pnpm@9 (or brew install pnpm)" ;;
    macos:docker) info "macOS: brew install --cask docker (then open Docker Desktop)" ;;
    macos:git) info "macOS: brew install git (or install Xcode CLT: xcode-select --install)" ;;
    debian:node) info "Debian/Ubuntu: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs" ;;
    debian:pnpm) info "Debian/Ubuntu: npm i -g pnpm@9" ;;
    debian:docker) info "Debian/Ubuntu: sudo apt-get install -y docker.io && sudo systemctl start docker && sudo usermod -aG docker \$USER (then re-login)" ;;
    debian:git) info "Debian/Ubuntu: sudo apt-get install -y git" ;;
    rhel:node) info "Fedora/RHEL: sudo dnf install -y nodejs npm" ;;
    rhel:pnpm) info "Fedora/RHEL: npm i -g pnpm@9" ;;
    rhel:docker) info "Fedora/RHEL: sudo dnf install -y moby-engine && sudo systemctl start docker" ;;
    rhel:git) info "Fedora/RHEL: sudo dnf install -y git" ;;
    *) info "See https://nodejs.org / https://pnpm.io / https://docker.com for ${tool}" ;;
  esac
}

require_tool() {
  local tool="$1"
  if ! command -v "$tool" > /dev/null 2>&1; then
    err "${tool} is required but not installed"
    print_install_hint "$tool"
    exit 1
  fi
}

require_version() {
  local tool="$1" min_major="$2" current_major
  current_major="$(major_version "$($tool --version 2>&1)")"
  if [ -z "$current_major" ] || [ "$current_major" -lt "$min_major" ]; then
    err "${tool} >= ${min_major} required (found ${current_major:-unknown})"
    print_install_hint "$tool"
    exit 1
  fi
}

require_or_print_install() {
  step "Checking prerequisites"

  require_tool git
  ok "git: $(git --version | head -n1)"

  require_tool node
  require_version node "$NODE_MIN_MAJOR"
  ok "node: $(node --version)"

  require_tool pnpm
  require_version pnpm "$PNPM_MIN_MAJOR"
  ok "pnpm: $(pnpm --version)"

  require_tool docker
  if ! docker info > /dev/null 2>&1; then
    err "docker is installed but the daemon is not running"
    case "$OS" in
      macos) info "Run: open -a Docker (then wait ~20s for the daemon to start)" ;;
      debian | rhel) info "Run: sudo systemctl start docker" ;;
      *) info "Start the Docker daemon, then re-run this script." ;;
    esac
    exit 1
  fi
  ok "docker: $(docker --version | head -n1)"

  require_tool curl
  ok "curl: $(curl --version | head -n1 | awk '{print $1, $2}')"
}

# ─── Port checks ────────────────────────────────────────────────────────────

port_in_use() {
  local port="$1"
  if command -v lsof > /dev/null 2>&1; then
    lsof -ti:"$port" > /dev/null 2>&1
  elif command -v ss > /dev/null 2>&1; then
    ss -ltn "( sport = :$port )" 2> /dev/null | grep -q ":$port"
  elif command -v netstat > /dev/null 2>&1; then
    netstat -an 2> /dev/null | grep -E "[.:]$port .*LISTEN" > /dev/null
  else
    return 1
  fi
}

check_ports() {
  step "Checking ports ${WEB_PORT}, ${API_PORT}, ${DB_PORT}, ${DAEMON_HEALTH_PORT}"
  local busy=0
  for p in "$WEB_PORT" "$API_PORT" "$DB_PORT" "$DAEMON_HEALTH_PORT"; do
    if port_in_use "$p"; then
      warn "port $p is already in use"
      busy=1
    else
      ok "port $p free"
    fi
  done
  if [ "$busy" = "1" ]; then
    if ! confirm "Some ports are busy. Continue anyway?" "N"; then
      err "aborting — free the ports or set WEB_PORT/API_PORT/DB_PORT/CEPAGE_DAEMON_HEALTH_PORT and re-run"
      exit 1
    fi
  fi
}

# ─── Repo setup ─────────────────────────────────────────────────────────────

clone_or_pull() {
  step "Setting up source at ${CEPAGE_DIR}"
  if [ -d "$CEPAGE_DIR/.git" ]; then
    info "directory already exists, pulling latest"
    (cd "$CEPAGE_DIR" && git pull --ff-only) || warn "git pull failed (using existing checkout)"
    ok "updated"
  else
    if [ -e "$CEPAGE_DIR" ]; then
      err "$CEPAGE_DIR exists but is not a git repo"
      exit 1
    fi
    git clone --depth 1 "$REPO_URL" "$CEPAGE_DIR"
    ok "cloned"
  fi
  cd "$CEPAGE_DIR"
}

bootstrap_env() {
  step "Preparing .env"
  if [ -f .env ]; then
    info ".env already exists, leaving it alone"
  else
    cp .env.example .env
    ok ".env created from .env.example"
  fi
}

# ─── Postgres ───────────────────────────────────────────────────────────────

boot_postgres() {
  step "Starting Postgres (docker compose up -d)"
  docker compose up -d postgres
  info "waiting for Postgres to be ready"
  local helper="$CEPAGE_DIR/scripts/wait-for-port.sh"
  if [ -x "$helper" ]; then
    "$helper" localhost "$DB_PORT" 30
  else
    # Fallback inline wait if the helper isn't executable yet (chmod race).
    for _ in $(seq 1 15); do
      if docker compose exec -T postgres pg_isready -U postgres -d cepage > /dev/null 2>&1; then
        break
      fi
      sleep 2
    done
  fi
  ok "Postgres ready on :${DB_PORT}"
}

# ─── Dependencies + DB sync ─────────────────────────────────────────────────

install_deps() {
  step "Installing pnpm dependencies (this can take 1-3 min)"
  if ! pnpm install --frozen-lockfile; then
    warn "frozen lockfile install failed, retrying without --frozen-lockfile"
    pnpm install
  fi
  ok "dependencies installed"
}

migrate_db() {
  step "Generating Prisma client + syncing schema"
  pnpm db:generate
  pnpm db:push
  ok "database schema in sync"
}

# ─── Start the dev stack ────────────────────────────────────────────────────

start_app() {
  step "Starting API in background"
  : > /tmp/cepage-api.log
  nohup pnpm api:dev > /tmp/cepage-api.log 2>&1 &
  echo $! > /tmp/cepage-api.pid

  info "waiting for API on :${API_PORT}/api/v1/health"
  if ! "$CEPAGE_DIR/scripts/wait-for-port.sh" localhost "$API_PORT" 60 /api/v1/health; then
    err "API never answered. Last 30 lines of /tmp/cepage-api.log:"
    tail -n 30 /tmp/cepage-api.log >&2 || true
    exit 1
  fi
  ok "API ready"

  # The native daemon is what actually runs agents on the host. Without it,
  # agent_run and runtime_* jobs stay queued in the DB and the UI shows an
  # amber "Daemon offline" badge. It must start AFTER the API is up because
  # it polls the API in a loop.
  step "Starting native daemon in background"
  : > /tmp/cepage-daemon.log
  nohup pnpm daemon:dev > /tmp/cepage-daemon.log 2>&1 &
  echo $! > /tmp/cepage-daemon.pid
  ok "daemon launched (pid $(cat /tmp/cepage-daemon.pid))"

  step "Starting web in background"
  : > /tmp/cepage-web.log
  nohup pnpm web:dev > /tmp/cepage-web.log 2>&1 &
  echo $! > /tmp/cepage-web.pid

  info "waiting for web on :${WEB_PORT} (first compile can take 60s+)"
  if ! "$CEPAGE_DIR/scripts/wait-for-port.sh" localhost "$WEB_PORT" 90 /; then
    err "web never answered. Last 30 lines of /tmp/cepage-web.log:"
    tail -n 30 /tmp/cepage-web.log >&2 || true
    exit 1
  fi
  ok "web ready"

  # Sanity-check the daemon process is still alive (the build stage inside
  # run-daemon-dev.mjs can fail silently after launch).
  if [ -f /tmp/cepage-daemon.pid ] && kill -0 "$(cat /tmp/cepage-daemon.pid)" 2> /dev/null; then
    ok "daemon alive"
  else
    warn "daemon exited early — agents will not run. See /tmp/cepage-daemon.log"
  fi
}

# ─── Browser ────────────────────────────────────────────────────────────────

open_browser() {
  if [ "$OPEN_BROWSER" = "0" ]; then return 0; fi
  local url="http://localhost:${WEB_PORT}"
  step "Opening ${url}"
  case "$OS" in
    macos) open "$url" > /dev/null 2>&1 || true ;;
    debian | rhel | linux-other)
      if command -v xdg-open > /dev/null 2>&1; then
        xdg-open "$url" > /dev/null 2>&1 || true
      elif command -v sensible-browser > /dev/null 2>&1; then
        sensible-browser "$url" > /dev/null 2>&1 || true
      fi
      ;;
    windows)
      if command -v explorer.exe > /dev/null 2>&1; then
        explorer.exe "$url" > /dev/null 2>&1 || true
      fi
      ;;
  esac
}

# ─── Final report ───────────────────────────────────────────────────────────

print_recap() {
  echo
  echo "${C_GREEN}${C_BOLD}Cepage is running.${C_RESET}"
  echo
  echo "  Canvas:  http://localhost:${WEB_PORT}"
  echo "  API:     http://localhost:${API_PORT}/api/v1"
  echo "  Logs:    /tmp/cepage-api.log  /tmp/cepage-daemon.log  /tmp/cepage-web.log"
  echo "  Source:  ${CEPAGE_DIR}"
  echo
  echo "  Stop:        cd ${CEPAGE_DIR} && docker compose down && \\"
  echo "               kill \$(cat /tmp/cepage-api.pid /tmp/cepage-daemon.pid /tmp/cepage-web.pid 2>/dev/null) 2>/dev/null"
  echo "  Uninstall:   curl -fsSL ${RAW_BASE}/scripts/uninstall.sh | bash"
  echo
}

# ─── Main ───────────────────────────────────────────────────────────────────

main() {
  parse_flags "$@"
  echo
  echo "${C_BOLD}Cepage installer${C_RESET}  ${C_DIM}(target: ${CEPAGE_DIR}, OS: ${OS})${C_RESET}"
  echo

  require_or_print_install
  check_ports
  clone_or_pull
  bootstrap_env
  boot_postgres
  install_deps
  migrate_db

  if [ "$START_APP" = "1" ]; then
    start_app
    open_browser
    print_recap
  else
    ok "install complete (skipping --no-start). Run \`pnpm api:dev\`, \`pnpm daemon:dev\`, and \`pnpm web:dev\` to start."
  fi
}

main "$@"
