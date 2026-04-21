# Uninstall Cepage from this machine

> Copy this entire file as a prompt to your AI coding agent. The agent will
> detect what's installed, ask you what to remove, and clean up safely.
> Default: keeps your DB data and Docker images. Use `--purge` semantics if you
> want to nuke everything.

---

You are an AI coding agent with shell access. Your task is to uninstall Cepage
from this machine. **Default behavior is to preserve user data** (Postgres
volumes, workspace volumes, OpenCode config). Only delete data if the user
explicitly confirms.

## Context

Cepage installs the following artifacts:

| Artifact | Type | Default action |
|---|---|---|
| `~/cepage` (or `$CEPAGE_DIR`) | filesystem | remove (with confirmation) |
| Docker containers `cepage-*` | runtime | remove |
| Docker network `cepage` | runtime | remove |
| Docker volume `cepage_pgdata` (Postgres data) | data | **keep** unless user says purge |
| Docker volume `cepage_prod_workspaces` | data | **keep** unless user says purge |
| Docker volume `cepage_prod_opencode_data`, `cepage_prod_opencode_config` | data | **keep** unless user says purge |
| Docker images `cepage-*:local` | disk space | **keep** unless user says purge |
| Background processes `pnpm api:dev` / `pnpm daemon:dev` / `pnpm web:dev` | runtime | stop |
| `/tmp/cepage-*.log`, `/tmp/cepage-*.pid` | tmp | remove |

## Detect

Run these checks first to figure out what is actually installed. Stop and tell
the user "nothing to uninstall" if the install dir does not exist AND no Cepage
containers/volumes are present.

```bash
CEPAGE_DIR="${CEPAGE_DIR:-$HOME/cepage}"
echo "INSTALL_DIR_EXISTS=$([ -d "$CEPAGE_DIR" ] && echo yes || echo no)"
echo "CONTAINERS:"; docker ps -a --filter "name=cepage" --format "  {{.Names}} ({{.Status}})" 2>/dev/null
echo "VOLUMES:";   docker volume ls --filter "name=cepage" --format "  {{.Name}}"             2>/dev/null
echo "IMAGES:";    docker images --filter "reference=cepage*" --format "  {{.Repository}}:{{.Tag}}" 2>/dev/null
echo "PROCESSES:"; pgrep -fl "cepage" 2>/dev/null || true
```

## Ask the user (one question at a time)

For each artifact group, ask once and respect the answer. Default values shown
in `[brackets]`.

1. "Stop running Cepage processes and remove containers + network? **[Y/n]**"
2. "Delete the source directory at `$CEPAGE_DIR`? **[Y/n]**"
3. "Delete Docker volumes (Postgres data + workspaces — **IRREVERSIBLE**)? **[y/N]**"
4. "Delete Docker images (~ 2 GB disk)? **[y/N]**"

Defaults are intentionally asymmetric: containers/repo are easy to rebuild,
volumes contain user work and DB data.

## Execute (only what the user confirmed)

Do the steps in this order. Each must be tolerant of "already gone" (use
`|| true` or check before).

### A. Stop processes (if confirmed Q1)

```bash
[ -d "$CEPAGE_DIR" ] && (cd "$CEPAGE_DIR" && docker compose down 2>/dev/null) || true

# Kill dev servers spawned by install (best-effort, scoped to cepage paths)
for pidfile in /tmp/cepage-api.pid /tmp/cepage-daemon.pid /tmp/cepage-web.pid; do
  [ -f "$pidfile" ] && kill "$(cat "$pidfile")" 2>/dev/null || true
  rm -f "$pidfile"
done
pkill -f "$CEPAGE_DIR" 2>/dev/null || true
```

Do NOT use a broad `pkill -f "next dev"` or `pkill -f "nest start"` — those can
match unrelated user processes.

### B. Remove repo (if confirmed Q2)

```bash
rm -rf "$CEPAGE_DIR"
```

### C. Remove volumes (only if confirmed Q3)

```bash
for v in cepage_pgdata cepage_prod_workspaces cepage_prod_opencode_data cepage_prod_opencode_config; do
  docker volume rm "$v" 2>/dev/null || true
done
```

### D. Remove images (only if confirmed Q4)

```bash
for i in cepage-api:local cepage-web:local cepage-opencode:local cepage-worker:local; do
  docker image rm "$i" 2>/dev/null || true
done
```

### E. Cleanup leftover network

```bash
docker network rm cepage 2>/dev/null || true
rm -f /tmp/cepage-api.log /tmp/cepage-daemon.log /tmp/cepage-web.log
```

## Recap

Print a one-screen summary like this:

```
Cepage uninstall complete.

Removed:
  ✓ containers (3)
  ✓ network (cepage)
  ✓ source directory (~/cepage)
  ✓ background processes (2)

Preserved:
  • Docker volumes (cepage_pgdata, …) — your DB data is intact
  • Docker images (cepage-*:local)    — re-install will be fast

To purge the rest later:
  docker volume rm cepage_pgdata cepage_prod_workspaces cepage_prod_opencode_data cepage_prod_opencode_config
  docker image rm cepage-api:local cepage-web:local cepage-opencode:local
```

If the user purged everything, say so explicitly:

```
Cepage fully removed. ~2.4 GB freed.
```

## Boundaries

- Never delete `~/.docker`, `~/.npm`, `~/.pnpm-store`, `~/.config/git`, or anything outside the artifacts listed above.
- Never run `docker system prune` (would delete unrelated user data).
- Never run `rm -rf $HOME/something` without an explicit confirmation tied to that exact path.
- If any step fails (e.g. permission denied on volume removal), report it but continue with the remaining steps. The user can fix and re-run; the script is idempotent.
- If the user has uncommitted changes in `~/cepage`, mention them in the recap *before* deletion and double-confirm.
