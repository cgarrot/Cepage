# Install Cepage with Claude Code

> Open Claude Code, then paste this entire file as your first message.
> Claude will use the Bash, Read, and Write tools to install Cepage end-to-end.

---

You are running inside Claude Code on the user's machine. Install and start
Cepage. You have full access to the Bash tool — use it to run shell commands.
Use the Read tool to inspect files when needed. Do not use Write to create
files unless explicitly required (the install only needs the existing `.env.example`).

## What Cepage is

A canvas to orchestrate Cursor, Claude Code, Codex and OpenCode side by side.
Stack: Postgres 16 (Docker), NestJS API on `:31947`, Next.js web on `:31961`,
plus a native daemon on the host that actually runs the agents.
Built with Node 20+, pnpm 9+, Docker, git.

## Plan

1. Verify prerequisites with one Bash call (`node --version && pnpm --version && docker info && git --version`).
2. If anything is missing, install it via the platform's package manager. On macOS use `brew`. On Linux use `apt` / `dnf`. **Do not try to install Docker silently** — if Docker is missing, print the install URL and stop.
3. Check ports 31961, 31947, 31945, 31982 are free with `lsof -ti:31961 -ti:31947 -ti:31945 -ti:31982`. If any are taken, **stop and ask the user** what to do.
4. Clone https://github.com/cgarrot/Cepage into `~/cepage` (or `git pull --ff-only` if it already exists).
5. `cp .env.example .env` (skip if `.env` already exists).
6. `docker compose up -d` and wait for Postgres to be healthy.
7. `pnpm install --frozen-lockfile` (fall back to `pnpm install` if the lockfile is out of date).
8. `pnpm db:generate && pnpm db:push`.
9. Start the API in background: `nohup pnpm api:dev > /tmp/cepage-api.log 2>&1 &`
10. Poll `curl -fsS http://localhost:31947/api/v1/health` every 2s, up to 60s. Stop when it returns 200.
11. Start the native daemon and the web in background:
    ```bash
    nohup pnpm daemon:dev > /tmp/cepage-daemon.log 2>&1 &
    nohup pnpm web:dev    > /tmp/cepage-web.log    2>&1 &
    ```
    The daemon is what actually spawns agents on the host — without it every
    agent run stays queued and the UI shows an amber "Daemon offline" badge.
    It must start after the API is healthy because it polls the API in a loop.
12. Poll `curl -fsS http://localhost:31961` every 2s, up to 90s.
13. Run `open http://localhost:31961` (macOS) or `xdg-open http://localhost:31961` (Linux).
14. Print this final message exactly:
    ```
    Cepage is running at http://localhost:31961
    Logs: /tmp/cepage-api.log, /tmp/cepage-daemon.log, /tmp/cepage-web.log
    ```

## Verification (mandatory before claiming success)

Run all three checks. All three must pass:

```bash
curl -fsS http://localhost:31947/api/v1/health | grep -q '"status":"ok"' && echo HEALTH_PASS || echo HEALTH_FAIL
curl -fsS -o /dev/null -w "%{http_code}" http://localhost:31961 | grep -qE "^2[0-9]{2}$" && echo WEB_PASS || echo WEB_FAIL
pgrep -f 'apps/daemon.*cli.js start' > /dev/null && echo DAEMON_PASS || echo DAEMON_FAIL
```

If anything fails, **do not tell the user the install succeeded**. Tail the
matching log file (`/tmp/cepage-api.log`, `/tmp/cepage-daemon.log`, or
`/tmp/cepage-web.log`), summarize the last error, and ask for direction.

## Boundaries

- Do not ask the user for AI provider keys (Anthropic, OpenAI, Cursor, etc.) during install. The canvas opens empty and configuration happens in-app later.
- Do not modify the user's shell rc files unless installing Node via nvm requires it.
- Do not run `kill -9` on user processes without explicit confirmation in the chat.
- Use the TodoWrite tool to track your install steps so the user can follow your progress live.

## If the user says "uninstall" later

Read [CEPAGE-UNINSTALL.md](../uninstall/claude-code.md) and execute that flow.
