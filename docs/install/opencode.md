# Install Cepage with OpenCode

> Run `opencode` in any directory (typically `~`), then paste this file as your
> first message. OpenCode will install Cepage end-to-end using its bash and
> read tools.

---

You are running inside the OpenCode CLI on the user's machine. Install and
start Cepage. Use the bash tool for every shell call. Do not invoke long-running
foreground processes — always backgrounding the dev servers.

## What Cepage is

An open-source canvas that orchestrates multiple coding agents (including
OpenCode itself) on the same React Flow surface. Stack: Postgres 16 in Docker,
NestJS API on port 31947, Next.js web on port 31961, plus a native daemon on the
host that actually runs the agents. Requires Node >= 20.9, pnpm >= 9, Docker,
git.

## Steps

Execute these as separate `bash` tool calls so the user can see progress:

### 1. Pre-flight

```bash
node --version && pnpm --version && docker info > /dev/null 2>&1 && git --version && echo PREFLIGHT_OK
```

If this prints `PREFLIGHT_OK`, skip step 2.

### 2. Install missing prerequisites

Detect the OS with `uname -s`:

- `Darwin`: `brew install node@20 git` and `npm i -g pnpm@9`. Docker: `brew install --cask docker && open -a Docker`, wait 20s.
- `Linux` (Debian/Ubuntu): `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs git docker.io && sudo systemctl start docker && npm i -g pnpm@9`
- Other Linux: install Node 20+, pnpm 9+, Docker via the official scripts.

### 3. Check port availability

```bash
for p in 31961 31947 31945 31982; do
  if lsof -ti:$p > /dev/null 2>&1; then echo "PORT_BUSY:$p"; fi
done
```

If anything prints, **stop**. Ask the user how to handle each busy port. Do not
kill processes.

### 4. Clone or update

```bash
CEPAGE_DIR="${CEPAGE_DIR:-$HOME/cepage}"
if [ -d "$CEPAGE_DIR/.git" ]; then
  cd "$CEPAGE_DIR" && git pull --ff-only
else
  git clone https://github.com/cgarrot/Cepage "$CEPAGE_DIR"
fi
cd "$CEPAGE_DIR"
```

### 5. Bootstrap env

```bash
[ -f .env ] || cp .env.example .env
```

### 6. Start Postgres

```bash
docker compose up -d
for i in $(seq 1 15); do
  docker compose exec -T postgres pg_isready -U postgres -d cepage > /dev/null 2>&1 && echo PG_READY && break
  sleep 2
done
```

### 7. Install deps and sync DB

```bash
pnpm install --frozen-lockfile || pnpm install
pnpm db:generate
pnpm db:push
```

### 8. Start the API in background

```bash
nohup pnpm api:dev > /tmp/cepage-api.log 2>&1 &
echo "API_PID:$!"
```

### 9. Wait for the API, then start the daemon and the web

The native daemon polls the API in a loop — it must start after the API is
healthy. Without it, every agent run you trigger stays queued in the database
and the UI shows an amber "Daemon offline" badge.

```bash
for i in $(seq 1 30); do curl -fsS http://localhost:31947/api/v1/health > /dev/null 2>&1 && echo API_READY && break; sleep 2; done
nohup pnpm daemon:dev > /tmp/cepage-daemon.log 2>&1 &
echo "DAEMON_PID:$!"
nohup pnpm web:dev    > /tmp/cepage-web.log    2>&1 &
echo "WEB_PID:$!"
for i in $(seq 1 45); do curl -fsS http://localhost:31961 > /dev/null 2>&1 && echo WEB_READY && break; sleep 2; done
```

If the API or the web never prints `*_READY` within the loop, tail the
matching log:

```bash
tail -n 50 /tmp/cepage-api.log
tail -n 50 /tmp/cepage-web.log
```

…and report to the user. Do not claim success.

### 10. Open in browser

```bash
case "$(uname -s)" in
  Darwin) open http://localhost:31961 ;;
  Linux)  xdg-open http://localhost:31961 || sensible-browser http://localhost:31961 || true ;;
esac
```

### 11. Verify

```bash
curl -fsS http://localhost:31947/api/v1/health | grep -q '"status":"ok"' && echo HEALTH_PASS || echo HEALTH_FAIL
curl -fsS -o /dev/null -w "%{http_code}" http://localhost:31961 | grep -qE "^2[0-9]{2}$" && echo WEB_PASS || echo WEB_FAIL
pgrep -f 'apps/daemon.*cli.js start' > /dev/null && echo DAEMON_PASS || echo DAEMON_FAIL
```

All three must print `*_PASS`.

### 12. Final message

```
Cepage is running at http://localhost:31961
Logs: /tmp/cepage-api.log, /tmp/cepage-daemon.log, /tmp/cepage-web.log
Stop:  cd ~/cepage && docker compose down && pkill -f "pnpm.*dev"
```

## Notes for OpenCode specifically

- Each `pnpm install` and Next.js compile can take 30-90 seconds — these are not hangs.
- Don't use the read tool on `node_modules/`, `.next/`, `dist/`, or `apps/web/.next/cache` — too large and not useful for the install flow.
- If you need to see what went wrong, only tail logs (`tail -n 50`), do not cat full log files.
- The first `pnpm install` of this monorepo downloads ~500 MB.
