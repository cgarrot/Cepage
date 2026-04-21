# Uninstall Cepage with Claude Code

> Open Claude Code, then paste this entire file. Claude will detect what's
> installed, ask before deleting anything destructive, and produce a recap.

---

You are running inside Claude Code on the user's machine. Uninstall Cepage.
Default behaviour is to preserve user data (Postgres volumes, workspaces). Use
the Bash tool for shell calls. Use AskUserQuestion (or plain chat) for each
confirmation.

## Detect first, ask second, delete last

### 1. Detect

```bash
CEPAGE_DIR="${CEPAGE_DIR:-$HOME/cepage}"
echo "DIR=$([ -d "$CEPAGE_DIR" ] && echo present || echo missing) ($CEPAGE_DIR)"
docker ps -a --filter "name=cepage" --format "container: {{.Names}} ({{.Status}})" 2>/dev/null
docker volume ls --filter "name=cepage" --format "volume: {{.Name}}" 2>/dev/null
docker images --filter "reference=cepage*" --format "image: {{.Repository}}:{{.Tag}}" 2>/dev/null
```

If everything is missing, tell the user "Cepage is not installed on this machine" and stop.

### 2. Check for uncommitted work

```bash
[ -d "$CEPAGE_DIR/.git" ] && (cd "$CEPAGE_DIR" && git status --porcelain | head -20)
```

If anything appears, **stop and ask the user** whether to back it up before deleting.

### 3. Ask (use TodoWrite to show progress through these questions)

- Q1: Stop containers + remove network + stop dev processes? **[Y/n]**
- Q2: Delete source directory `$CEPAGE_DIR`? **[Y/n]**
- Q3: Delete Docker volumes (DB + workspaces — **IRREVERSIBLE**)? **[y/N]**
- Q4: Delete Docker images (~ 2 GB)? **[y/N]**

### 4. Execute confirmed steps only

```bash
# A. Stop & remove containers (if Q1=y)
[ -d "$CEPAGE_DIR" ] && (cd "$CEPAGE_DIR" && docker compose down 2>/dev/null) || true
for pidfile in /tmp/cepage-api.pid /tmp/cepage-daemon.pid /tmp/cepage-web.pid; do
  [ -f "$pidfile" ] && kill "$(cat "$pidfile")" 2>/dev/null
  rm -f "$pidfile"
done
pkill -f "$CEPAGE_DIR" 2>/dev/null || true

# B. Remove source dir (if Q2=y)
rm -rf "$CEPAGE_DIR"

# C. Remove volumes (only if Q3=y)
for v in cepage_pgdata cepage_prod_workspaces cepage_prod_opencode_data cepage_prod_opencode_config; do
  docker volume rm "$v" 2>/dev/null || true
done

# D. Remove images (only if Q4=y)
for i in cepage-api:local cepage-web:local cepage-opencode:local cepage-worker:local; do
  docker image rm "$i" 2>/dev/null || true
done

# E. Final cleanup
docker network rm cepage 2>/dev/null || true
rm -f /tmp/cepage-api.log /tmp/cepage-daemon.log /tmp/cepage-web.log
```

### 5. Recap

Print what was removed and what was preserved. Be explicit about what stays
(volumes, images) and how to nuke them later if the user changes their mind.

## Boundaries

- Never run `docker system prune`.
- Never delete anything outside `$CEPAGE_DIR` or the explicit volume/image/container names listed above.
- Use `pkill -f "$CEPAGE_DIR"` (path-scoped), never `pkill -f "next dev"` or `pkill -f "nest"` (would hit unrelated processes).
- Each step must be idempotent — re-running this prompt on a half-uninstalled state should not error out.
