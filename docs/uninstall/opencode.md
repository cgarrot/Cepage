# Uninstall Cepage with OpenCode

> Run `opencode` in any directory, then paste this file as your first message.
> OpenCode will detect, ask, and clean up.

---

You are running inside the OpenCode CLI on the user's machine. Uninstall
Cepage. Default: preserve user data. Only purge volumes and images on explicit
confirmation.

## Plan (one bash tool call per step)

### 1. Detect what is installed

```bash
CEPAGE_DIR="${CEPAGE_DIR:-$HOME/cepage}"
{
  echo "DIR_EXISTS=$([ -d "$CEPAGE_DIR" ] && echo yes || echo no)"
  echo "PATH=$CEPAGE_DIR"
  echo "CONTAINERS:"; docker ps -a --filter "name=cepage" --format "  {{.Names}} ({{.Status}})" 2>/dev/null
  echo "VOLUMES:";    docker volume ls --filter "name=cepage" --format "  {{.Name}}" 2>/dev/null
  echo "IMAGES:";     docker images --filter "reference=cepage*" --format "  {{.Repository}}:{{.Tag}}" 2>/dev/null
} 2>&1
```

If `DIR_EXISTS=no` and no containers/volumes/images are listed, tell the user
"Cepage is not installed" and stop.

### 2. Check for uncommitted git changes

```bash
[ -d "$CEPAGE_DIR/.git" ] && (cd "$CEPAGE_DIR" && git status --porcelain | head -10) || true
```

If output is non-empty, ask the user whether to back up before deletion.

### 3. Ask the user (4 questions, single-letter answers)

```
1. Stop containers and remove network + stop dev processes?  [Y/n]
2. Delete the source directory ($CEPAGE_DIR)?                [Y/n]
3. Delete Docker volumes (DB data + workspaces, IRREVERSIBLE)? [y/N]
4. Delete Docker images (~ 2 GB)?                            [y/N]
```

Track the answers, do not skip any.

### 4. Execute confirmed steps in order

```bash
CEPAGE_DIR="${CEPAGE_DIR:-$HOME/cepage}"

# A. Stop runtime (if Q1=y)
[ -d "$CEPAGE_DIR" ] && (cd "$CEPAGE_DIR" && docker compose down 2>/dev/null) || true
for pidfile in /tmp/cepage-api.pid /tmp/cepage-daemon.pid /tmp/cepage-web.pid; do
  [ -f "$pidfile" ] && kill "$(cat "$pidfile")" 2>/dev/null
  rm -f "$pidfile"
done
pkill -f "$CEPAGE_DIR" 2>/dev/null || true

# B. Remove source dir (if Q2=y)
rm -rf "$CEPAGE_DIR"

# C. Remove volumes (ONLY if Q3=y)
# for v in cepage_pgdata cepage_prod_workspaces cepage_prod_opencode_data cepage_prod_opencode_config; do
#   docker volume rm "$v" 2>/dev/null || true
# done

# D. Remove images (ONLY if Q4=y)
# for i in cepage-api:local cepage-web:local cepage-opencode:local cepage-worker:local; do
#   docker image rm "$i" 2>/dev/null || true
# done

# E. Final cleanup (always)
docker network rm cepage 2>/dev/null || true
rm -f /tmp/cepage-api.log /tmp/cepage-daemon.log /tmp/cepage-web.log
```

Uncomment sections C and D only when the user has confirmed Q3 / Q4.

### 5. Recap

```
Cepage uninstall complete.

Removed:
  - <list>

Preserved:
  - <list with one-liner showing how to remove later>

To fully purge later:
  docker volume rm cepage_pgdata cepage_prod_workspaces cepage_prod_opencode_data cepage_prod_opencode_config
  docker image rm cepage-api:local cepage-web:local cepage-opencode:local cepage-worker:local
```

## Notes for OpenCode specifically

- Each step is intentionally a separate bash call so the user can interrupt mid-flow if a question reveals new info.
- Never include `--force` flags on `rm -rf` — `rm -rf` already handles non-existent paths quietly with `|| true`.
- Do not call `docker system prune`, `docker container prune`, or `docker volume prune` — they affect non-Cepage artifacts.
- The script is idempotent. If the user reruns it, the second pass should print "nothing to uninstall" cleanly.
