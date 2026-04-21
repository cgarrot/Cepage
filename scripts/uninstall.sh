#!/usr/bin/env bash
# Cepage uninstall
# https://github.com/cgarrot/Cepage
#
# One-line uninstall (interactive, preserves data by default):
#   curl -fsSL https://raw.githubusercontent.com/cgarrot/Cepage/main/scripts/uninstall.sh | bash
#
# One-line uninstall (non-interactive, full purge):
#   curl -fsSL https://raw.githubusercontent.com/cgarrot/Cepage/main/scripts/uninstall.sh | bash -s -- --purge --yes
#
# Flags:
#   --dir <path>     Install directory (default: ~/cepage, override with $CEPAGE_DIR)
#   --yes, -y        Auto-confirm all prompts (containers + repo). Volumes/images still need --purge.
#   --purge          Also remove Docker volumes AND images (irreversible, deletes DB data)
#   --keep-data      Explicit alias of the default (preserve volumes + images)
#   --help, -h       Show this help

set -euo pipefail

# ─── Configuration ──────────────────────────────────────────────────────────

DEFAULT_DIR="${HOME}/cepage"
CEPAGE_DIR="${CEPAGE_DIR:-$DEFAULT_DIR}"
ASSUME_YES=0
PURGE=0

VOLUMES=(
  cepage_pgdata
  cepage_prod_workspaces
  cepage_prod_opencode_data
  cepage_prod_opencode_config
)

IMAGES=(
  cepage-api:local
  cepage-web:local
  cepage-opencode:local
  cepage-worker:local
)

# ─── Logging ────────────────────────────────────────────────────────────────

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
skip() { printf "  %s·%s %s\n" "$C_DIM" "$C_RESET" "$*"; }
warn() { printf "  %s!%s %s\n" "$C_YELLOW" "$C_RESET" "$*" >&2; }
err() { printf "%sError:%s %s\n" "$C_RED" "$C_RESET" "$*" >&2; }
info() { printf "  %s%s%s\n" "$C_DIM" "$*" "$C_RESET"; }

confirm() {
  local prompt="$1"
  local default="${2:-N}"
  if [ "$ASSUME_YES" = "1" ]; then return 0; fi
  if [ ! -t 0 ] && [ -e /dev/tty ]; then
    printf "  %s? %s [%s]: " "$C_YELLOW" "$prompt" "$default" > /dev/tty
    read -r answer < /dev/tty
  elif [ -t 0 ]; then
    printf "  ? %s [%s]: " "$prompt" "$default"
    read -r answer
  else
    # No tty available (CI without explicit --yes) → use default and print why.
    info "no tty available, using default '$default' for: $prompt"
    answer="$default"
  fi
  answer="${answer:-$default}"
  case "$answer" in
    y | Y | yes | YES) return 0 ;;
    *) return 1 ;;
  esac
}

# ─── Flags ──────────────────────────────────────────────────────────────────

print_help() {
  cat <<'EOF'
Cepage uninstaller — removes containers, repo, and (optionally) data.

Usage:
  curl -fsSL https://raw.githubusercontent.com/cgarrot/Cepage/main/scripts/uninstall.sh | bash
  curl -fsSL ... | bash -s -- --purge --yes
  bash uninstall.sh [flags]

Flags:
  --dir <path>     Install directory (default: ~/cepage, override with $CEPAGE_DIR)
  --yes, -y        Auto-confirm interactive prompts (containers + repo deletion).
                   Volumes/images still need --purge to be removed.
  --purge          Also remove Docker volumes AND images.
                   THIS DELETES YOUR POSTGRES DATA AND WORKSPACES.
  --keep-data      Explicit alias of the default (preserve volumes + images).
  --help, -h       Show this help.

Default behaviour:
  - Stop and remove all `cepage-*` containers + the `cepage` network.
  - Stop background dev processes started by scripts/install.sh.
  - Remove the source directory (after a confirmation).
  - PRESERVE Docker volumes (Postgres data, workspaces) and images.

Safe to re-run. Idempotent. Exit 0 even if nothing was installed.
EOF
}

parse_flags() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --dir)
        CEPAGE_DIR="$2"
        shift 2
        ;;
      --yes | -y)
        ASSUME_YES=1
        shift
        ;;
      --purge)
        PURGE=1
        shift
        ;;
      --keep-data)
        PURGE=0
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

# ─── Detection ──────────────────────────────────────────────────────────────

DETECTED_DIR=0
DETECTED_CONTAINERS=()
DETECTED_VOLUMES=()
DETECTED_IMAGES=()

detect_installation() {
  step "Detecting Cepage artifacts"

  if [ -d "$CEPAGE_DIR" ]; then
    DETECTED_DIR=1
    ok "source dir: $CEPAGE_DIR"
  else
    skip "source dir: $CEPAGE_DIR (not present)"
  fi

  if command -v docker > /dev/null 2>&1 && docker info > /dev/null 2>&1; then
    # Containers (anything matching name=cepage-*).
    while IFS= read -r line; do
      [ -n "$line" ] && DETECTED_CONTAINERS+=("$line")
    done < <(docker ps -a --filter "name=cepage" --format "{{.Names}}" 2> /dev/null)

    # Volumes (only the canonical names).
    for v in "${VOLUMES[@]}"; do
      if docker volume inspect "$v" > /dev/null 2>&1; then
        DETECTED_VOLUMES+=("$v")
      fi
    done

    # Images (canonical local images).
    for i in "${IMAGES[@]}"; do
      if docker image inspect "$i" > /dev/null 2>&1; then
        DETECTED_IMAGES+=("$i")
      fi
    done

    if [ "${#DETECTED_CONTAINERS[@]}" -gt 0 ]; then
      ok "containers: ${DETECTED_CONTAINERS[*]}"
    else
      skip "containers: none"
    fi
    if [ "${#DETECTED_VOLUMES[@]}" -gt 0 ]; then
      ok "volumes: ${DETECTED_VOLUMES[*]}"
    else
      skip "volumes: none"
    fi
    if [ "${#DETECTED_IMAGES[@]}" -gt 0 ]; then
      ok "images: ${DETECTED_IMAGES[*]}"
    else
      skip "images: none"
    fi
  else
    warn "Docker not available — skipping container/volume/image detection"
  fi

  if [ "$DETECTED_DIR" = "0" ] && [ "${#DETECTED_CONTAINERS[@]}" = "0" ] \
    && [ "${#DETECTED_VOLUMES[@]}" = "0" ] && [ "${#DETECTED_IMAGES[@]}" = "0" ]; then
    echo
    echo "${C_GREEN}Nothing to uninstall.${C_RESET} Cepage is not installed on this machine."
    exit 0
  fi
}

# ─── Cleanup steps ──────────────────────────────────────────────────────────

REMOVED=()
PRESERVED=()

stop_processes() {
  step "Stopping containers and dev processes"
  if [ -d "$CEPAGE_DIR" ]; then
    (cd "$CEPAGE_DIR" && docker compose down 2> /dev/null) || true
  fi
  # Also try to remove any stragglers by name in case compose down missed them.
  for c in "${DETECTED_CONTAINERS[@]}"; do
    docker rm -f "$c" > /dev/null 2>&1 || true
  done

  # Best-effort: stop dev processes started by install.sh (PID files).
  for pidfile in /tmp/cepage-api.pid /tmp/cepage-daemon.pid /tmp/cepage-web.pid; do
    if [ -f "$pidfile" ]; then
      kill "$(cat "$pidfile")" 2> /dev/null || true
      rm -f "$pidfile"
    fi
  done

  # Path-scoped pkill — only kills processes whose cmdline contains the install dir.
  if command -v pkill > /dev/null 2>&1 && [ -d "$CEPAGE_DIR" ]; then
    pkill -f "$CEPAGE_DIR" 2> /dev/null || true
  fi

  REMOVED+=("containers (${#DETECTED_CONTAINERS[@]})" "dev processes")
  ok "containers stopped"
}

remove_repo() {
  if [ "$DETECTED_DIR" != "1" ]; then return 0; fi

  step "Source directory"
  if confirm "Delete $CEPAGE_DIR ?" "Y"; then
    # Surface uncommitted git changes before nuking, give one last chance.
    if [ -d "$CEPAGE_DIR/.git" ]; then
      local dirty
      dirty="$(cd "$CEPAGE_DIR" && git status --porcelain 2> /dev/null | head -5)"
      if [ -n "$dirty" ]; then
        warn "uncommitted changes detected in $CEPAGE_DIR:"
        echo "$dirty" | sed 's/^/    /' >&2
        if ! confirm "Delete anyway? Your changes will be lost." "N"; then
          PRESERVED+=("$CEPAGE_DIR (kept due to uncommitted changes)")
          skip "preserved $CEPAGE_DIR"
          return 0
        fi
      fi
    fi
    rm -rf "$CEPAGE_DIR"
    REMOVED+=("source directory")
    ok "removed $CEPAGE_DIR"
  else
    PRESERVED+=("$CEPAGE_DIR")
    skip "kept $CEPAGE_DIR"
  fi
}

remove_volumes() {
  if [ "${#DETECTED_VOLUMES[@]}" = "0" ]; then return 0; fi

  step "Docker volumes (Postgres data + workspaces)"
  local should_remove=0
  if [ "$PURGE" = "1" ]; then
    should_remove=1
  elif confirm "Delete volumes ${DETECTED_VOLUMES[*]} ? IRREVERSIBLE." "N"; then
    should_remove=1
  fi

  if [ "$should_remove" = "1" ]; then
    for v in "${DETECTED_VOLUMES[@]}"; do
      if docker volume rm "$v" > /dev/null 2>&1; then
        REMOVED+=("volume $v")
        ok "removed $v"
      else
        warn "failed to remove $v (is a container still attached?)"
      fi
    done
  else
    for v in "${DETECTED_VOLUMES[@]}"; do
      PRESERVED+=("volume $v")
    done
    skip "kept ${#DETECTED_VOLUMES[@]} volume(s) — your data is safe"
  fi
}

remove_images() {
  if [ "${#DETECTED_IMAGES[@]}" = "0" ]; then return 0; fi

  step "Docker images (cepage-*:local)"
  local should_remove=0
  if [ "$PURGE" = "1" ]; then
    should_remove=1
  elif confirm "Delete images ${DETECTED_IMAGES[*]} ? Re-install will need to pull/build them again." "N"; then
    should_remove=1
  fi

  if [ "$should_remove" = "1" ]; then
    for i in "${DETECTED_IMAGES[@]}"; do
      if docker image rm "$i" > /dev/null 2>&1; then
        REMOVED+=("image $i")
        ok "removed $i"
      else
        warn "failed to remove $i (in use? try after stopping containers)"
      fi
    done
  else
    for i in "${DETECTED_IMAGES[@]}"; do
      PRESERVED+=("image $i")
    done
    skip "kept ${#DETECTED_IMAGES[@]} image(s)"
  fi
}

cleanup_extras() {
  step "Final cleanup"
  docker network rm cepage > /dev/null 2>&1 && REMOVED+=("network cepage") && ok "removed network cepage" || skip "network cepage already gone"
  rm -f /tmp/cepage-api.log /tmp/cepage-daemon.log /tmp/cepage-web.log \
    /tmp/cepage-api.pid /tmp/cepage-daemon.pid /tmp/cepage-web.pid
  ok "removed log/pid files in /tmp"
}

# ─── Recap ──────────────────────────────────────────────────────────────────

print_recap() {
  echo
  echo "${C_GREEN}${C_BOLD}Cepage uninstall complete.${C_RESET}"
  echo

  if [ "${#REMOVED[@]}" -gt 0 ]; then
    echo "${C_GREEN}Removed:${C_RESET}"
    for item in "${REMOVED[@]}"; do
      printf "  ✓ %s\n" "$item"
    done
    echo
  fi

  if [ "${#PRESERVED[@]}" -gt 0 ]; then
    echo "${C_DIM}Preserved (your data is safe):${C_RESET}"
    for item in "${PRESERVED[@]}"; do
      printf "  · %s\n" "$item"
    done
    echo
    echo "${C_DIM}To purge the rest later:${C_RESET}"
    echo "  curl -fsSL https://raw.githubusercontent.com/cgarrot/Cepage/main/scripts/uninstall.sh | bash -s -- --purge --yes"
    echo
  fi
}

# ─── Main ───────────────────────────────────────────────────────────────────

main() {
  parse_flags "$@"
  echo
  echo "${C_BOLD}Cepage uninstaller${C_RESET}  ${C_DIM}(target: ${CEPAGE_DIR}, purge: ${PURGE})${C_RESET}"
  echo

  detect_installation

  if confirm "Proceed with uninstall?" "Y"; then
    :
  else
    echo "Aborted."
    exit 0
  fi

  stop_processes
  remove_repo
  remove_volumes
  remove_images
  cleanup_extras

  print_recap
}

main "$@"
