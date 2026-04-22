# Cepage reference integrations

Cepage is useful on its own (the web studio, the CLI, the SDK), but most
teams want to call their saved skills from the agent platforms and IDEs
they already use. This directory collects working reference
configurations for every editor or agent framework we've personally
tested against, plus the matching smoke-test script.

Every integration uses the same underlying transport: the
`@cepage/mcp` stdio server (see [`packages/mcp`](../packages/mcp/)). It
speaks [Model Context Protocol](https://modelcontextprotocol.io/) and
exposes every skill in your catalog as a typed MCP tool. Running it
looks the same regardless of which client you wire to it:

```bash
npx -y @cepage/mcp
# or, from this monorepo:
node packages/mcp/dist/bin/cepage-mcp.js
```

The server reads three env vars:

| Var            | Required?                | What it does                                                     |
| -------------- | ------------------------ | ---------------------------------------------------------------- |
| `CEPAGE_URL`   | optional                 | Override the API base. Default: `http://localhost:31947`. Do not include `/api/v1` — the server appends it. |
| `CEPAGE_TOKEN` | if your API needs auth   | Bearer token sent on every request.                              |
| `CEPAGE_MCP_SKILL_FILTER` | optional     | Comma-separated list of skill slugs to expose (default: all).    |

See each subdirectory for a drop-in config file and platform-specific
notes:

| Integration                                                         | Transport                      | What you get                                                    |
| ------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------- |
| [`cursor`](./cursor/README.md)                                      | MCP stdio (via `~/.cursor/mcp.json`) | `@cepage:<slug>` tools inside any Cursor agent                   |
| [`openclaw`](./openclaw/README.md)                                  | MCP stdio (via `.mcp.json` bundle)   | Cepage skills as tools in OpenClaw channels and extensions      |
| [`hermes-agent`](./hermes-agent/README.md)                          | MCP stdio (via `~/.hermes/config.yaml`) | Cepage skills surfaced in Hermes' CLI/TUI                       |
| [`claude-desktop`](./claude-desktop/README.md)                      | MCP stdio (via `claude_desktop_config.json`) | Cepage tools in Claude Desktop                                  |
| [`webhooks-verify-node`](./webhooks-verify-node/)                   | Incoming HTTP                  | Minimal Express receiver that verifies `Cepage-Signature` headers |
| [`webhooks-verify-python`](./webhooks-verify-python/)               | Incoming HTTP                  | Equivalent FastAPI receiver in Python                           |

## Picking a transport

- **MCP stdio** is the default for desktop-style clients (Cursor, Claude
  Desktop, Hermes CLI, OpenClaw extensions). It spawns the `@cepage/mcp`
  binary as a subprocess and talks to it over stdin/stdout. No HTTP
  exposure is needed.
- **The HTTP API** (with the `@cepage/sdk` / `cepage-sdk` clients, or
  raw `curl`) is the right call from server-side agents, cron jobs,
  CI pipelines, or webhook handlers.
- **Outbound webhooks** are how Cepage pushes run lifecycle events into
  your existing infra (Slack relays, analytics, incident tools). Every
  delivery is signed with HMAC-SHA256 — see the two `webhooks-verify-*`
  examples for a drop-in verifier.

## Running the end-to-end smoke test

```bash
# From the repo root. No external API required — the script boots a
# tiny mock Cepage HTTP server, spawns `@cepage/mcp` against it, and
# runs one tool roundtrip over stdio.
pnpm integrations:smoke
```

The same command runs in CI so every reference config here stays
compatible with the current MCP surface.
