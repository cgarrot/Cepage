

# Cepage

**One canvas. Every AI agent. The right tool for every task.**  
Use Cursor, Claude Code, Codex and OpenCode side by side, on the same infinite canvas.





---

## Why Cepage

You're already using Cursor, Claude Code, Codex, OpenCode — and probably more. Each one excels at something different: inline editing, deep reasoning, autonomous runs, test scaffolding, code review. They're all great. They're also four separate windows, four context resets, and a lot of copy-paste.

**Cepage is the orchestration layer above them.**

Spawn any agent on the same canvas. Wire them together. Let one critique another. Watch them work in parallel. Pick the best output and merge. The agents stay best-in-class — Cepage is just the conductor.

```
You ──► Cepage canvas ──┬──► Cursor   (refactor)
                        ├──► Codex    (tests)
                        ├──► Claude   (review)
                        └──► OpenCode (autonomous loop)
```

### What it gives you today

- **Multi-agent in one workspace.** Spawn agents from different vendors on the same canvas, with shared context.
- **A graph, not a transcript.** Every prompt, response, branch, and contradiction is a typed node you can re-arrange, fork, or delete — no more lost context in chat scrollback.
- **Live and bidirectional.** Agents stream their work into the canvas as they go. Humans can edit, override, or contradict any node mid-run.
- **Time-travel.** Replay any session step by step. Branch from any past state.
- **Skill Library.** Save any session as a reusable workflow with typed inputs/outputs (JSON Schema). Run it from the UI via an auto-form, from the API, on a schedule (cron), or from a global Cmd/Ctrl+K palette. Every run streams progress back over SSE and lands in a searchable history.
- **Skill Compiler.** Turn a Cursor, OpenCode, or Claude Code session into a compiled, parameterized skill. Extract the execution graph, replace hardcoded values with typed parameters, dry-run at zero cost, and reuse the same workflow for different inputs.

### Pronounced *say-pahzh*

**Cépage** is the French word for a grape variety — Cabernet, Merlot, Syrah. Each one has its own strengths. Great wines come from blending them: an *assemblage*. **Cépage** is the same idea, applied to AI agents: every model has a strength, the magic is in the blend.

---

## Status

This is an **early public preview**. The architecture is solid and the canvas works end-to-end, but there are sharp edges. Be ready to:

- Live with a fixed `local-user` identity (no auth, no multi-tenant).
- Use OpenCode and Cursor Agent today; other adapters are coming.
- Hit the occasional rough edge — please open an issue when you do.

Install is one curl command, or one prompt to your favourite coding agent. See [Get started](#get-started-in-90-seconds) below.

### Supported agents


| Agent                   | Status                | Notes                                                                       |
| ----------------------- | --------------------- | --------------------------------------------------------------------------- |
| OpenCode                | Available             | Spawned via the OpenCode runtime, full streaming.                           |
| Cursor Agent            | Available             | Spawned as a CLI process. Requires `CURSOR_API_KEY`.                        |
| Claude Code             | Available             | Spawned via the `claude` CLI; supports catalog discovery, streaming, and compiler hooks. |
| Codex                   | Planned               | Coming after Claude Code.                                                   |
| Aider, Continue, custom | Contributions welcome | The adapter contract lives in `[packages/agent-core](packages/agent-core)`. |


---

## Get started in 90 seconds

Pick the path that fits how you work. All three drop you on the same canvas.

### Option 1 — Let your AI agent install it *(recommended)*

Copy [`CEPAGE-INSTALL.md`](./CEPAGE-INSTALL.md) into Claude Code, Cursor,
OpenCode, Codex, Aider, Continue — anything with shell access. Hit run. Done.

Optimised, agent-specific variants live under [`docs/install/`](docs/install/):

- [Claude Code](docs/install/claude-code.md)
- [Cursor](docs/install/cursor.md)
- [OpenCode](docs/install/opencode.md)

The agent installs prerequisites, clones the repo, brings up Postgres,
syncs the database, starts the dev stack, and opens your browser at
[http://localhost:31961](http://localhost:31961).

### Option 2 — One curl command

```bash
curl -fsSL https://raw.githubusercontent.com/cgarrot/Cepage/main/scripts/install.sh | bash
```

Installs into `~/cepage` (override with `CEPAGE_DIR=…`). Requires Node 20+,
pnpm 9+, Docker, git. See [`scripts/install.sh --help`](scripts/install.sh) for
flags (`--no-open`, `--no-start`, `--yes`).

### Option 3 — Manual (for the curious)

**Requirements**: Node 20.9+, pnpm 9+, Docker, git, plus the agent CLIs you want to spawn (OpenCode, `cursor-agent`, `claude`, …) installed locally.

```bash
git clone https://github.com/cgarrot/Cepage cepage && cd cepage
cp .env.example .env
docker compose up -d                  # Postgres
pnpm install
pnpm db:generate && pnpm db:push
pnpm dev                              # api + web in parallel (turbo)
pnpm daemon:dev                       # in another terminal — native daemon that runs agents
```

Browse to **[http://localhost:31961](http://localhost:31961)**.

| Surface              | URL                             |
| -------------------- | ------------------------------- |
| Web canvas           | `http://localhost:31961`         |
| REST API             | `http://localhost:31947/api/v1`  |
| Realtime (Socket.IO) | `/ws/socket.io` on the API port |
| Health probe         | `http://localhost:31947/api/v1/health` |
| Daemon status (UI)   | "Daemon" badge in the chat header |

> Heads up: `pnpm api:dev` runs `prisma db push` on startup so prototype tables stay in sync. For real schema changes, always go through `pnpm db:migrate:dev` and commit the migration.
>
> The native daemon (`pnpm daemon:dev` in dev, `cepage-daemon start` in prod) runs on the host machine and is the only consumer of `agent_run` and `runtime_*` jobs. The chat header surfaces a "Daemon" badge that turns amber when no daemon is connected — runs you trigger will stay queued until you start one.

---

## Uninstall

Three mirrored paths. Default behaviour **preserves your data** (Postgres
volumes, workspaces). You have to opt in with `--purge` (script) or confirm
"yes" interactively (agent prompt) to delete it.

### Option 1 — Via your AI agent

Copy [`CEPAGE-UNINSTALL.md`](./CEPAGE-UNINSTALL.md) into the same agent. It
detects what's installed, asks before each destructive step, and prints a
recap. Per-agent variants live in [`docs/uninstall/`](docs/uninstall/).

### Option 2 — One curl command

```bash
# Interactive, preserves DB data and Docker images
curl -fsSL https://raw.githubusercontent.com/cgarrot/Cepage/main/scripts/uninstall.sh | bash

# Non-interactive, full purge (removes DB data + workspaces + images)
curl -fsSL https://raw.githubusercontent.com/cgarrot/Cepage/main/scripts/uninstall.sh | bash -s -- --purge --yes
```

Flags:

| Flag | Effect |
|---|---|
| *(default)* | Stop containers, remove repo, **keep** volumes + images. |
| `--keep-data` | Explicit alias of the default. |
| `--purge` | Also delete Docker volumes (DB data, workspaces) and images. **Irreversible.** |
| `--yes`, `-y` | Auto-confirm (CI / scripted use). Volumes/images still need `--purge`. |
| `--dir <path>` | Override install dir (default `~/cepage`, or `$CEPAGE_DIR`). |

### Option 3 — Manual (5 commands)

```bash
cd ~/cepage && docker compose down                          # containers + network
rm -rf ~/cepage                                             # source

# Optional — only run these if you want to delete your data:
docker volume rm cepage_pgdata
# Legacy volumes/images from earlier installs (pre native-daemon) — safe to ignore if missing:
docker volume rm cepage_prod_workspaces \
  cepage_prod_opencode_data cepage_prod_opencode_config 2>/dev/null
docker image rm cepage-api:local cepage-web:local
docker image rm cepage-opencode:local 2>/dev/null
docker network rm cepage 2>/dev/null
```

The script is idempotent: re-running it on a half-uninstalled state is safe and exits 0 cleanly.

---

## How it works

Three layers, kept intentionally small:

1. **The canvas** (`apps/web` + `packages/app-ui`) — a React Flow surface where every node is typed (human prompt, agent run, draft, contradiction, request) and every edge has a meaning (`spawned`, `replies-to`, `contradicts`, `merges`).
2. **The graph engine** (`packages/graph-core` + `packages/api`) — a NestJS backend that owns sessions, nodes, edges, runtime events, and replays them through Socket.IO. Pure graph logic stays in `graph-core`, no I/O.
3. **The agent layer** (`packages/agent-core` + `apps/daemon`) — a thin adapter contract. Each agent (OpenCode, Cursor Agent, Claude Code, …) plugs in by implementing `discoverCatalog` + `run`. The native daemon polls the API in localhost, claims `agent_run` / `runtime_*` jobs, spawns the underlying CLI/runtime on the host, and streams events back to the API in 500 ms batches. The API itself never spawns agents — it just stores and dispatches.

That's it. No vendor lock-in, no proprietary protocol. If you can run an agent, you can wire it into Cepage.

---

## Skill Library

Everything you build on the canvas can be turned into a **typed, reusable skill**.

- **Save-as-skill.** From any session, click _Save as skill_. Cepage detects `{{PLACEHOLDER}}` variables in your agent and control nodes and proposes a JSON Schema you can edit in a 3-step modal.
- **Run from anywhere.** Once saved, a skill is available at [`/library/<slug>`](http://localhost:31961/library) with an auto-generated form. You can also run it via the REST API, the global Cmd/Ctrl+K palette, a cron schedule, or (in phase 2) the `@cepage/mcp` stdio server and the `cepage` CLI.
- **Typed contract.** Inputs and outputs are validated with ajv at the API boundary. A failed run returns structured errors the UI can render under the right field.
- **Observability.** Every run is a row you can open — inputs, outputs, errors, duration, triggering surface, and a live SSE stream while it's executing.

The API surface (all under `/api/v1`):

| Endpoint | What it does |
| --- | --- |
| `POST /sessions/:id/detect-inputs` | Suggest a JSON Schema from the session graph. |
| `POST /sessions/:id/save-as-skill` | Persist the session as a `UserSkill`. |
| `GET /skills` / `GET /skills/:slug` | List + read user skills. |
| `POST /skills/:slug/runs` | Run a skill with typed inputs. Returns a `SkillRun`. |
| `GET /skill-runs/:runId/stream` | SSE stream of lifecycle events for a run. |
| `POST /scheduled-skill-runs` | Schedule a recurring skill run via cron. |
| `GET /openapi.json` | Dynamic OpenAPI 3.1 document — one typed `POST /skills/:slug/runs` endpoint per skill in the catalog, with inputs/outputs schemas inlined. |

Under the hood, filesystem-defined skills (`docs/workflow-prompt-library/**`) and DB-backed user skills are merged into a single catalog — both kinds are runnable from the same endpoints and the same Library UI.

**TypeScript SDK.** `npm i @cepage/sdk` gives you a zero-dependency client with typed wrappers for every surface:

```ts
import { CepageClient } from '@cepage/sdk';

const cepage = new CepageClient({ apiUrl: 'http://localhost:31947/api/v1' });
const run = await cepage.skills.run('weekly-stripe-report', {
  inputs: { startDate: '2026-04-14', endDate: '2026-04-21' },
});
console.log(run.outputs);
```

See [`packages/sdk/README.md`](packages/sdk/README.md) for streaming, schedules, and error handling.

**Python SDK.** `pip install cepage` gives you the same surface in Python (sync and async):

```python
from cepage import CepageClient

with CepageClient(api_url="http://localhost:31947/api/v1") as cepage:
    run = cepage.skills.run(
        "weekly-stripe-report",
        inputs={"startDate": "2026-04-14", "endDate": "2026-04-21"},
    )
    print(run.outputs)
```

See [`packages/sdk-python/README.md`](packages/sdk-python/README.md) for async usage, streaming, and error handling.

**CLI.** `@cepage/cli` exposes the same operations from your terminal:

```bash
cepage auth login --api-url http://localhost:31947/api/v1
cepage skills list
cepage skills run weekly-stripe-report \
  --input startDate=2026-04-14 \
  --input endDate=2026-04-21
cepage runs stream run_abc123
cepage schedules create --skill weekly-stripe-report --cron '0 9 * * 1' --inputs-file ./inputs.json
```

See [`apps/cli/README.md`](apps/cli/README.md) for every command and flag.

---

## Skill Compiler

The Skill Compiler turns one-off agent sessions into reusable, typed skills.

After Cursor, OpenCode, or Claude Code finishes a task, you send the session to Cepage. Cepage extracts the execution graph, replaces concrete values like "Stripe" with typed parameters like `{{payment_provider}}`, runs a zero-cost dry-run validation, and emits a skill you can call from the CLI, SDK, or any MCP client.

**How it works in 30 seconds:**

```bash
# Capture a Cursor session
cepage import cursor --latest

# Capture an OpenCode session
cepage run opencode --capture --prompt "Build a Stripe integration"

# Auto-compile Claude Code sessions after they finish
cepage hook install claude-code

# Review parameters in the browser, then dry-run
cepage skills dry-run payment-integration --input payment_provider=paypal

# Run the compiled skill
cepage skills run payment-integration --input payment_provider=paypal --input api_key=xxx
```

**What you get:**

- **Extract** — Parse transcripts, diffs, and tool calls into a canonical execution graph.
- **Parameterize** — Replace hardcoded values with typed placeholders and a JSON Schema.
- **Validate** — Dry-run with a mock LLM in an isolated worktree. Costs $0. Catches structural errors before publication.
- **Distribute** — The dynamic OpenAPI document exposes per-skill input/output schemas, and the SDK generators turn those schemas into TypeScript and Python types.
- **Reuse** — Run the skill from the Library UI, CLI, TypeScript SDK, Python SDK, or any MCP-compatible agent.

See the full guide: [Getting Started with the Skill Compiler](docs/getting-started-compiler.md).

---

## Roadmap

Honest list of what's next, roughly in order:

- **Codex adapter**
- **Polish Claude Code hook import UX**
- **Real auth** (drop the `local-user` shim)
- **Hosted demo** — a public canvas you can poke at without installing
- **Native binary install** — single-file binary for users who don't want Node + Docker on their machine
- **Adapter SDK** — make adding a new agent a 30-line PR
- **Templates** — starter canvases for common workflows (refactor + test, research + draft, etc.)
- **Interop layer for skills** — `@cepage/mcp` stdio server, auto-generated TS and Python SDKs, a `cepage` CLI, and outbound HMAC-signed webhooks so any IDE or agent framework can call a Cepage skill.

If one of these matters to you, open an issue or thumbs-up an existing one — that's how we prioritise.

---

## Examples

End-to-end pipelines built on top of Cepage live in `[examples/](examples)`. They orchestrate external services through the generic `POST /api/v1/sessions/from-skill/:skillId` endpoint and are not part of the core engine — copy, fork, adapt.

---

## Repository layout


| Path                                           | Role                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `[apps/web](apps/web)`                         | Next.js shell that mounts the canvas                             |
| `[apps/api](apps/api)`                         | NestJS bootstrap (HTTP + WebSocket on the same port)             |
| `[apps/daemon](apps/daemon)`                   | Native daemon — polls the API and runs agents on the host        |
| `[packages/api](packages/api)`                 | Backend modules: sessions, graph, agents, runtime, collaboration |
| `[packages/graph-core](packages/graph-core)`   | Pure graph engine, no I/O, fully unit-tested                     |
| `[packages/agent-core](packages/agent-core)`   | Multi-runtime adapter layer (OpenCode, Cursor, …)                |
| `[packages/db](packages/db)`                   | Prisma schema + Postgres tooling                                 |
| `[packages/app-ui](packages/app-ui)`           | Canvas UI (React Flow)                                           |
| `[packages/state](packages/state)`             | Client state store (Zustand)                                     |
| `[packages/client-api](packages/client-api)`   | HTTP + Socket.IO client                                          |
| `[packages/shared-core](packages/shared-core)` | Shared types and DTOs                                            |
| `[packages/ui-kit](packages/ui-kit)`           | Shared UI primitives                                             |
| `[packages/config](packages/config)`           | Environment validation (Zod)                                     |
| `[integrations/](integrations)`                | Drop-in configs for Cursor, OpenClaw, Hermes, Claude Desktop, webhook verifiers |


---

## Quality checks

Before opening a pull request, run from the repo root:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

---

## Documentation

- [Architecture and conventions](AGENTS.md)
- [Getting Started with the Skill Compiler](docs/getting-started-compiler.md)
- [Workflow skill catalog](docs/workflow-prompt-library/)

---

## Community

This is the very first public version. The fastest way to help right now:

- **Star the repo** — it's the cheapest signal that someone cares.
- **Try the quickstart** and open an issue when something breaks.
- **Suggest the next adapter** you want plugged in.
- **Build a demo** with Cepage and tag us — we'll boost it.

Discord and X handles will land in the next release. Until then, GitHub issues and discussions are the canonical channels.

---

## Contributing and security

- [Contribution guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)

---

## License

[MIT](LICENSE) — do whatever you want, please leave the copyright line in.