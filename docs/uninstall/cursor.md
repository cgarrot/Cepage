# Uninstall Cepage with Cursor Agent

> Open Cursor, switch to Agent mode, then paste this entire file as your
> request. Cursor will detect, confirm, and clean up.

---

You are running inside Cursor in Agent mode. Uninstall Cepage from this
machine. Default behaviour is to preserve user data — only purge volumes and
images if the user explicitly approves.

## Step 1 — Detect

Run this single shell call to inventory everything:

```bash
CEPAGE_DIR="${CEPAGE_DIR:-$HOME/cepage}"
echo "=== Install dir ===";  [ -d "$CEPAGE_DIR" ] && echo "$CEPAGE_DIR (present)" || echo "missing"
echo "=== Containers ===";   docker ps -a --filter "name=cepage" --format "{{.Names}} ({{.Status}})" 2>/dev/null
echo "=== Volumes ===";      docker volume ls --filter "name=cepage" --format "{{.Name}}" 2>/dev/null
echo "=== Images ===";       docker images --filter "reference=cepage*" --format "{{.Repository}}:{{.Tag}}" 2>/dev/null
echo "=== Processes ==="; pgrep -fl "$CEPAGE_DIR" 2>/dev/null || echo "(none)"
echo "=== Uncommitted ==="; [ -d "$CEPAGE_DIR/.git" ] && (cd "$CEPAGE_DIR" && git status --porcelain | head -10) || echo "(no git repo)"
```

If everything reads "missing"/"(none)", stop and tell the user "Cepage is not
installed on this machine."

## Step 2 — Ask

Show the inventory output, then ask each question on its own line, accepting
single-letter responses:

1. Stop containers + remove network + stop dev processes? **[Y/n]**
2. Delete `$CEPAGE_DIR`? **[Y/n]**
3. Delete Docker volumes (DB data + workspaces — **IRREVERSIBLE**)? **[y/N]**
4. Delete Docker images (~ 2 GB)? **[y/N]**

Defaults: containers/repo = yes, volumes/images = no.

If the inventory shows uncommitted git changes, surface them before the user
answers Q2 and offer to copy them to `$HOME/cepage-backup-$(date +%s)`.

## Step 3 — Execute

For each confirmed step, run a single shell call (so the user sees output):

### Stop runtime (Q1=y)

```bash
[ -d "$CEPAGE_DIR" ] && (cd "$CEPAGE_DIR" && docker compose down 2>/dev/null) || true
for pidfile in /tmp/cepage-api.pid /tmp/cepage-daemon.pid /tmp/cepage-web.pid; do
  [ -f "$pidfile" ] && kill "$(cat "$pidfile")" 2>/dev/null
  rm -f "$pidfile"
done
pkill -f "$CEPAGE_DIR" 2>/dev/null || true
```

### Remove source (Q2=y)

```bash
rm -rf "$CEPAGE_DIR"
```

### Remove volumes (Q3=y, otherwise skip)

```bash
for v in cepage_pgdata cepage_prod_workspaces cepage_prod_opencode_data cepage_prod_opencode_config; do
  docker volume rm "$v" 2>/dev/null && echo "removed $v" || true
done
```

### Remove images (Q4=y, otherwise skip)

```bash
for i in cepage-api:local cepage-web:local cepage-opencode:local cepage-worker:local; do
  docker image rm "$i" 2>/dev/null && echo "removed $i" || true
done
```

### Final cleanup (always)

```bash
docker network rm cepage 2>/dev/null || true
rm -f /tmp/cepage-api.log /tmp/cepage-daemon.log /tmp/cepage-web.log
```

## Step 4 — Recap

Print:

```
Cepage uninstall complete.
  Removed:    <list of removed artifacts>
  Preserved:  <list of preserved artifacts and how to remove them later>
  Disk freed: ~<estimate> MB
```

## Don't

- Don't `docker system prune` — would touch unrelated containers/volumes.
- Don't `pkill -f "next"` or `pkill -f "nest"` — those match other Node projects. Always scope to `$CEPAGE_DIR`.
- Don't delete anything in `$HOME` other than `$CEPAGE_DIR` itself, even if the user typed `--purge`.
