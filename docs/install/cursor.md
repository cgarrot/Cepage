# Install Cepage with Cursor Agent

> Open Cursor, switch to Agent mode, then paste this entire file as your
> request. Cursor will install Cepage end-to-end using its terminal access.

---

You are running inside Cursor in Agent mode on the user's machine. Install and
start Cepage end-to-end. You can run shell commands and read files. Do not edit
project source files — the install only requires the existing `.env.example`.

## What Cepage is

A multi-agent canvas that lets the user drive Cursor, Claude Code, Codex and
OpenCode from a single React Flow surface. Stack: Postgres 16 (Docker), NestJS
API on `:31947`, Next.js web on `:31961`, plus a native daemon on the host that
actually runs the agents. Requires Node 20+, pnpm 9+, Docker, git.

## Pre-flight checks (one terminal call each)

```bash
node --version          # need >= 20.9
pnpm --version          # need >= 9
docker info             # daemon must be running
git --version           # any version
lsof -ti:31961 -ti:31947 -ti:31945 -ti:31982   # all four should print nothing
```

If `node` or `pnpm` is missing or too old:

- macOS: `brew install node@20 && npm i -g pnpm@9`
- Debian/Ubuntu: `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs && npm i -g pnpm@9`

If Docker is missing or not running:

- macOS: `brew install --cask docker && open -a Docker` then wait 20 seconds
- Linux: install Docker Engine via the official script at https://get.docker.com and `sudo systemctl start docker`

If any port is in use, **stop and ask the user** which one to free or how to
remap it. Never kill processes without permission.

## Install

Run these from the user's home directory:

```bash
CEPAGE_DIR="${CEPAGE_DIR:-$HOME/cepage}"
git clone https://github.com/cgarrot/Cepage "$CEPAGE_DIR" 2>/dev/null || (cd "$CEPAGE_DIR" && git pull --ff-only)
cd "$CEPAGE_DIR"
[ -f .env ] || cp .env.example .env
docker compose up -d
pnpm install --frozen-lockfile || pnpm install
pnpm db:generate
pnpm db:push
```

## Start

Three background processes, in order. The native daemon polls the API in a
loop — start the API first, then once it's healthy bring up the daemon and the
web. Without the daemon, agent runs stay queued forever and the UI shows an
amber "Daemon offline" badge.

```bash
nohup pnpm api:dev > /tmp/cepage-api.log 2>&1 &
for i in $(seq 1 30); do curl -fsS http://localhost:31947/api/v1/health > /dev/null && break; sleep 2; done
nohup pnpm daemon:dev > /tmp/cepage-daemon.log 2>&1 &
nohup pnpm web:dev    > /tmp/cepage-web.log    2>&1 &
```

## Wait & open

Poll the web root, then open the browser:

```bash
for i in $(seq 1 45); do curl -fsS http://localhost:31961 > /dev/null && break; sleep 2; done
open http://localhost:31961 || xdg-open http://localhost:31961
```

## Verify before declaring success

```bash
curl -fsS http://localhost:31947/api/v1/health | grep -q '"status":"ok"' && echo HEALTH_PASS || echo HEALTH_FAIL
curl -fsS -o /dev/null -w "%{http_code}" http://localhost:31961 | grep -qE "^2[0-9]{2}$" && echo WEB_PASS || echo WEB_FAIL
pgrep -f 'apps/daemon.*cli.js start' > /dev/null && echo DAEMON_PASS || echo DAEMON_FAIL
```

All three must print `*_PASS`. Otherwise tail the matching log
(`/tmp/cepage-api.log`, `/tmp/cepage-daemon.log`, `/tmp/cepage-web.log`) on the
last 50 lines and report the error to the user.

## Final message

```
Cepage is running.
  Canvas:  http://localhost:31961
  API:     http://localhost:31947/api/v1
  Logs:    /tmp/cepage-api.log  /tmp/cepage-daemon.log  /tmp/cepage-web.log
  Source:  ~/cepage

To stop:    cd ~/cepage && docker compose down && pkill -f "pnpm.*dev"
```

## Don't

- Don't open the project in Cursor before the install completes — the file
  watcher will compete with the dev server compile.
- Don't ask for any API keys. The canvas opens to a working empty state.
- Don't enable any "auto-run all commands" Cursor toggle that bypasses
  the user's approval.
