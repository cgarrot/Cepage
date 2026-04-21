# Install Cepage on this machine

> Copy this entire file as a prompt to your AI coding agent (Claude Code, Cursor,
> OpenCode, Codex, Aider, Continue...). The agent will install Cepage from
> scratch by following the steps below. Time-to-canvas: 1-3 minutes on a fresh
> machine, ~30 seconds on a warm one.

---

You are an AI coding agent with shell access. Your task is to install and start
Cepage on this machine, then open the canvas in the user's browser.

## Context

Cepage is an open-source canvas to orchestrate Cursor, Claude Code, Codex and
OpenCode together. It is a monorepo running:

- **Postgres 16** in a Docker container (only external service required)
- **NestJS API** on port `31947`
- **Next.js web canvas** on port `31961`
- **Daemon HTTP health** on port `31982` (local status for `cepage-daemon status`)
- **Native daemon** on the host — the only component that actually runs
  agents. The API dispatches, the daemon executes.

Stack requirements: Node.js >= 20.9, pnpm >= 9, Docker (running), git.

## Steps to execute

Execute these steps in order. Stop and report to the user on any failure.

### 1. Verify prerequisites

Check that all of these are installed and runnable:

- `node --version` -> must be `>= 20.9.0`
- `pnpm --version` -> must be `>= 9.0.0`
- `docker --version` and `docker info` -> must succeed (Docker daemon running)
- `git --version` -> any modern version

If any is missing, install it via the platform's package manager:

- **macOS**: `brew install node@20 pnpm docker git` then `open -a Docker` and wait 20s
- **Debian/Ubuntu**: `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs git docker.io && sudo systemctl start docker && npm i -g pnpm@9`
- **Fedora/RHEL**: `sudo dnf install -y nodejs git moby-engine && sudo systemctl start docker && npm i -g pnpm@9`
- **Windows (WSL2 only)**: instruct the user to install Docker Desktop with WSL2 backend, then re-run from inside the WSL2 shell

If `node` is older than 20, prefer installing `nvm` and running `nvm install 20`
rather than overriding the system Node.

### 2. Check for port conflicts

Cepage uses ports `31961` (web), `31947` (API), `31945` (Postgres on the host), and `31982` (daemon health HTTP).
Check each one with `lsof -ti:<port>` (macOS/Linux) or `netstat -ano | findstr :<port>` (Windows).

If a port is occupied:
- For `31945`: ask the user whether to stop the running Postgres or change `DATABASE_URL` in `.env`.
- For `31961` / `31947` / `31982`: ask the user to free it or set `WEB_PORT` / `API_PORT` / `CEPAGE_DAEMON_HEALTH_PORT` in `.env` to a different value before continuing.

### 3. Clone the repo

Clone into `~/cepage` (or `$CEPAGE_DIR` if the env var is set):

```bash
CEPAGE_DIR="${CEPAGE_DIR:-$HOME/cepage}"
if [ -d "$CEPAGE_DIR/.git" ]; then
  cd "$CEPAGE_DIR" && git pull --ff-only
else
  git clone https://github.com/cgarrot/Cepage "$CEPAGE_DIR"
  cd "$CEPAGE_DIR"
fi
```

### 4. Bootstrap the environment file

```bash
[ -f .env ] || cp .env.example .env
```

Default values in `.env.example` work out of the box for first run. Do NOT
prompt the user for API keys at install time — Cepage opens to a working canvas
without any agent credentials. Agent keys (Cursor, Claude, etc.) are entered
from the UI later.

### 5. Start Postgres

```bash
docker compose up -d
```

Wait until Postgres is healthy. Check with:

```bash
docker compose ps postgres | grep -q "healthy" || docker compose exec -T postgres pg_isready -U postgres -d cepage
```

Retry up to 30 seconds before giving up.

### 6. Install JavaScript dependencies

```bash
pnpm install --frozen-lockfile
```

If the lockfile is missing or out of date, fall back to `pnpm install`.

### 7. Generate Prisma client and sync the schema

```bash
pnpm db:generate
pnpm db:push
```

`db:push` is intentionally used here (not `db:migrate:dev`) because it works
without an interactive prompt. The script `scripts/run-prisma.mjs` reads
`DATABASE_URL` from `.env` automatically.

### 8. Start the API in the background

```bash
pnpm api:dev > /tmp/cepage-api.log 2>&1 &
```

Note: `pnpm api:dev` calls `prisma db push` again automatically on startup —
this is safe and idempotent.

### 9. Wait for the API to answer healthchecks

Poll `http://localhost:31947/api/v1/health` every 2 seconds for up to 60 seconds.
Expect HTTP 200 with body `{"data":{"status":"ok"}}`.

```bash
for i in $(seq 1 30); do
  curl -fsS http://localhost:31947/api/v1/health > /dev/null && break
  sleep 2
done
```

If the API never answers, tail `/tmp/cepage-api.log` and report the last 30
lines to the user.

### 10. Start the native daemon and the web in the background

The daemon is what actually spawns agents on the host. Without it, every
agent run stays queued in the database and the UI shows an amber
"Daemon offline" badge. It must start AFTER the API is healthy because it
polls the API in a loop.

```bash
pnpm daemon:dev > /tmp/cepage-daemon.log 2>&1 &
pnpm web:dev    > /tmp/cepage-web.log    2>&1 &
```

### 11. Wait for the web to be ready

Poll `http://localhost:31961` every 2 seconds for up to 90 seconds (Next.js dev
takes longer to compile on first run). Expect any 2xx response.

### 12. Open the browser

```bash
# macOS
open http://localhost:31961

# Linux
xdg-open http://localhost:31961 || sensible-browser http://localhost:31961

# Windows (from WSL2)
explorer.exe http://localhost:31961
```

### 13. Verify the daemon is still alive

The daemon exposes a small HTTP health server (default port `31982` from
`CEPAGE_DAEMON_HEALTH_PORT`). Prefer curling `/healthz`; fall back to checking
the process if HTTP is not ready yet.

```bash
curl -fsS http://127.0.0.1:31982/healthz > /dev/null 2>&1 \
  && echo DAEMON_OK \
  || (ps -p "$(pgrep -f 'apps/daemon.*cli.js start' | head -1)" > /dev/null 2>&1 \
        && echo DAEMON_OK_PROC \
        || (echo DAEMON_DEAD; tail -n 50 /tmp/cepage-daemon.log))
```

### 14. Final report to the user

Print exactly this (replace `<DIR>` with the install dir):

```
Cepage is running.
  Canvas:  http://localhost:31961
  API:     http://localhost:31947/api/v1
  Logs:    /tmp/cepage-api.log  /tmp/cepage-daemon.log  /tmp/cepage-web.log
  Source:  <DIR>

To stop:    cd <DIR> && docker compose down && pkill -f "pnpm.*dev"
To uninstall: paste CEPAGE-UNINSTALL.md into me.
```

## On failure

Do not retry blindly. For each error class:

| Symptom | What to do |
|---|---|
| `node` < 20 | Install Node 20 via nvm, do not modify global symlinks if other projects depend on Node 18 |
| `docker info` fails (daemon not running) | On Mac, `open -a Docker` and wait 20 seconds. On Linux, `sudo systemctl start docker`. Re-check before continuing. |
| `port already in use` | Stop and ask the user. Never `kill -9` user processes without permission. |
| `pnpm install` fails on optional native deps | Re-run with `pnpm install --ignore-scripts`, then run `pnpm rebuild` separately |
| `prisma generate` fails with "engine not found" | Run `pnpm --filter @cepage/db exec prisma generate` directly |
| API never responds | Show last 50 lines of `/tmp/cepage-api.log` and stop. Do not assume what is wrong. |
| Web compiles but shows blank page | Check `NEXT_PUBLIC_API_URL` in `.env` — must match the API host:port the user can reach |

## Test (verify install succeeded)

After step 14, run this verification:

```bash
curl -fsS http://localhost:31947/api/v1/health | grep -q '"status":"ok"' && echo PASS || echo FAIL
curl -fsS -o /dev/null -w "%{http_code}" http://localhost:31961 | grep -qE "^2[0-9]{2}$" && echo PASS || echo FAIL
```

Both must print `PASS`. If either fails, the install is broken — do not tell
the user it succeeded.

## Notes for the agent

- Never edit files under `node_modules/`, `.next/`, or `dist/`.
- The first `pnpm install` downloads ~500 MB and can take 1-3 minutes on a slow connection.
- The first `pnpm web:dev` compile takes 30-60 seconds. Do not interpret this as a hang.
- If the user already has Cepage installed (`~/cepage` exists with a `.git`), do `git pull --ff-only` instead of cloning. Preserve their `.env`.
- Do not install or configure any agent (Cursor / Claude Code / Codex) on the user's behalf during install. The canvas works empty. Agent setup happens from the UI.
