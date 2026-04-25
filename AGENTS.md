# AGENTS.md — Cépage repo

pnpm + Turborepo monorepo (`apps/*`, `packages/*`). Node ≥ 20.9, pnpm 9.x, Postgres 16 (`docker compose up -d`).

## Where to work

- NestJS bootstrap: `apps/api` (package `@cepage/api-app`, entry `src/main.ts`). Control plane only — it no longer spawns any agent CLI or OpenCode server. Keep it minimal; all business logic lives in `packages/api`.
- Native daemon: `apps/daemon` (package `@cepage/daemon-app`, entry `src/index.ts`). Runs on the host, polls the API on localhost, consumes only `agent_run` + `runtime_*`.
- CLI: `apps/cli` (package `@cepage/cli`, bin `cepage`). Thin wrapper around `@cepage/sdk` for listing, running, and scheduling skills from the terminal. Config lives at `~/.cepage/config.json`; env overrides are `CEPAGE_API_URL` and `CEPAGE_TOKEN`.
- Nest API: modules under `packages/api/src/modules/*` — `activity`, `agents`, `collaboration`, `connectors`, `execution`, `graph`, `runtime`, `sessions`, `workflow-copilot`, `workflow-skills`, `user-skills`, `skill-runs`, `skill-authoring`, `skill-compiler`, `skill-mining`, `session-analysis`, `scheduled-skill-runs`, `openapi`. The typed-skill library (`docs/product-plan/03-typed-skill-contract.md`) flows through the save/run/schedule/compiler modules; `openapi` generates the dynamic OpenAPI 3.1 document (`GET /api/v1/openapi.json`) that powers the TypeScript SDK (`packages/sdk`), Python SDK (`packages/sdk-python`), and MCP server (`packages/mcp`).
- Pure graph: `packages/graph-core` (no I/O, tested in isolation).
- Agent runtimes: `packages/agent-core` (ESM). OpenCode uses `@opencode-ai/sdk`; Cursor Agent and Claude Code are CLI-backed adapters loaded by the native daemon. The API keeps `importAgentCore()` (`new Function('return import(...)')`) for the few remaining synchronous paths (workflow-copilot, file-summarizer).
- Frontend: `apps/web` (Next.js 15 / React 19) consuming `packages/app-ui` (React Flow canvas), `packages/state` (Zustand), `packages/client-api` (HTTP + Socket.IO), `packages/ui-kit`, `packages/i18n`.
- DB schema: `packages/db/prisma/schema.prisma` (Prisma 5.22).
- Shared types/DTOs: `packages/shared-core`. Env validation: `packages/config` (Zod).

## Commands

- Root via Turborepo: `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm test`. `pnpm typecheck` ≡ `pnpm build` (packages validate TS via compiled output).
- Targeted dev: `pnpm api:dev` (port `API_PORT`/31947), `pnpm web:dev` (31961), `pnpm daemon:dev` (native daemon polling the API on localhost; health HTTP defaults to `CEPAGE_DAEMON_HEALTH_PORT`/31982). `agent_run` and `runtime_*` jobs are consumed only by the daemon — the API never dispatches them in-process anymore.
- Prisma: `pnpm db:generate`, `pnpm db:migrate:dev`, `pnpm db:push` (wrapper `scripts/run-prisma.mjs`).
- Per-package tests: `pnpm --filter @cepage/<pkg> run test` (e.g. `graph-core`, `api`, `state`, `app-ui`, `agent-core`, `i18n`).
- E2E workflows: `pnpm workflow:test:real` (`scripts/workflow-real-tester.mjs`).

## Notes

- Global HTTP prefix: `api/v1`. CORS via `CORS_ORIGIN`. Body limit `WORKFLOW_COPILOT_MAX_JSON_BODY_BYTES`.
- WebSocket: Socket.IO mounted by NestJS on the same port as the API.
- ESM vs CommonJS: `agent-core`, `app-ui`, `state`, `client-api`, `i18n`, `ui-kit` are **ESM**; `api`, `graph-core`, `shared-core`, `config` are **CommonJS**.
- Tests: `node --test` on compiled `dist/` — always `pnpm build` first. ESLint runs with `--max-warnings=0`.
- `pnpm api:dev` runs `prisma db push` on startup to align the local schema; any committed change should go through `pnpm db:migrate:dev`.
- Prototype: fixed identity `local-user` (not production-ready). `AGENT_WORKING_DIRECTORY` must point at a real local folder for OpenCode runs to succeed.

## Agent runtimes (native daemon)

Architecture inspired by Multica: all runtimes (OpenCode, cursor-agent, Claude Code, future CLIs) run **outside** containers, in the native daemon `apps/daemon`. The `docker-compose.prod.yml` stack is control plane only (Postgres + API + Web).

Lifecycle:
1. The API writes an `ExecutionJob` (`kind: agent_run` or `runtime_*`) to Postgres.
2. The native daemon polls `POST /api/v1/execution/daemon/claim` (localhost guard) and receives the job.
3. For `agent_run`: it prepares the local workspace (clone/update Git if needed), bridges `runAgentStream` from `@cepage/agent-core`, and batches events to `POST /api/v1/execution/daemon/messages` every ~500 ms.
4. For `runtime_start` / `runtime_stop` / `runtime_restart`: it spawns / kills / re-enqueues local runtime processes keyed by `runNodeId`.
5. Daemon progress and state reach the UI via `GET /api/v1/execution/daemon/status` (`DaemonStatusBadge` in `ChatHeader`).

To add a new runtime:
1. Create/extend the adapter in `packages/agent-core/src/registry.ts` (`ADAPTERS`): the daemon consumes it via `runAgentStream`.
2. If the runtime needs a locally installed CLI binary (e.g. `cursor-agent`, `claude`), document the prerequisite in the README and add the check in `apps/daemon` (PATH discovery / version probe).
3. If the runtime exposes a long-running process (`runtime_start`), implement `prepareDaemonRuntimeStart` in `RuntimeService` and the corresponding spawn in the daemon `JobRunner`.

No extra compose service / `Dockerfile.<name>` / shared volume is required: everything stays on the host.

### EXECUTION_WORKER_MODE

Env var `'api' | 'off'` (default `api`). In `api` mode, the API consumes only **non-daemon** jobs (workflow, connectors, triggers, approvals) via `ExecutionWorkerService`. The `DAEMON_JOB_KINDS` filter prevents the API from accidentally claiming an `agent_run` or `runtime_*` even if the database still has old rows.
