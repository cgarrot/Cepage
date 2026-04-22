# @cepage/mcp

MCP stdio server that exposes saved **[Cepage](https://github.com/cgarrot/Cepage)** skills as typed tools to any MCP-compatible client (Cursor, Claude Code, Codex, OpenCode, VS Code Copilot, Zed, Cline, Replit, Hermes, …).

```
┌──────────────┐         stdio MCP          ┌────────────────────┐   HTTP    ┌──────────┐
│ Cursor /     │ ───────────────────────►   │   @cepage/mcp       │ ──────►  │  Cepage  │
│ Claude Code  │         tools/list          │  (this package)     │          │    API   │
│ Codex / …    │ ◄───────────────────────   │   tools/call        │ ◄──────  └──────────┘
└──────────────┘                             └────────────────────┘
```

Every Cepage user-skill (anything saved with **Save as skill** in the Library) becomes an MCP tool with its JSON Schema preserved end-to-end. The host model fills in typed arguments, the MCP server runs the skill against a Cepage instance, and the result comes back as a JSON text block in the tool response.

## Install

```bash
npm install -g @cepage/mcp
# or run ad-hoc without installing
npx @cepage/mcp --help
```

## Configure your client

Point your MCP-capable client at the `cepage-mcp` binary.

### Cursor

```jsonc
// .cursor/mcp.json
{
  "mcpServers": {
    "cepage": {
      "command": "npx",
      "args": ["-y", "@cepage/mcp"],
      "env": {
        "CEPAGE_URL": "http://localhost:31947",
        "CEPAGE_MCP_SKILL_FILTER": "weekly-stripe-report,daily-digest"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add cepage npx -y @cepage/mcp
```

### Codex CLI

```bash
codex mcp add cepage npx -y @cepage/mcp
```

### OpenCode

```bash
oc mcp add cepage npx -y @cepage/mcp
```

### Hermes (via `mcp_tool.py`)

```yaml
mcp:
  servers:
    - name: cepage
      command: [npx, -y, "@cepage/mcp"]
      env:
        CEPAGE_URL: "http://localhost:31947"
```

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `CEPAGE_URL` | `http://localhost:31947` | Base URL of the Cepage HTTP API. |
| `CEPAGE_TOKEN` | _(none)_ | Bearer token sent as `Authorization: Bearer <token>`. |
| `CEPAGE_MCP_SKILL_FILTER` | _(all skills)_ | Comma-separated list of skill slugs to expose. Useful when a single Cepage instance hosts many skills but a specific IDE session only needs a few. |

CLI flags mirror the env vars (`--api`, `--token`, `--filter`, `--timeout`). Run `cepage-mcp --help` for details.

## What the client sees

For every skill in the Cepage catalog, the server publishes an MCP tool:

- **Name**: `cepage_<slug_with_underscores>` (Cepage `weekly-stripe-report` → MCP `cepage_weekly_stripe_report`).
- **Description**: `${title} — ${summary}`.
- **Input schema**: the skill's JSON Schema with internal `x-…` extensions stripped (MCP clients stay happy).

Calling a tool:

1. The MCP server POSTs to `/api/v1/skills/:slug/runs?wait=true` with the provided arguments.
2. The API validates inputs against the skill's schema, scaffolds a session (or calls a direct handler in phase 3), and streams lifecycle events.
3. When the run finishes, the server returns the skill's typed outputs as a single JSON-encoded `text` content item.

Failures are surfaced with `isError: true` and an explanation (`INVALID_INPUT`, `OUTPUT_SCHEMA_MISMATCH`, transport errors, …) so the host model can decide whether to retry.

## Programmatic use

The package also exposes the server as a library so you can embed it elsewhere (for instance, to add custom auth or a custom transport).

```ts
import { createCepageMcpServer } from '@cepage/mcp';

const { start } = createCepageMcpServer({
  apiUrl: 'http://localhost:31947',
  token: process.env.CEPAGE_TOKEN,
  filter: ['weekly-stripe-report'],
  runTimeoutMs: 120_000,
});
await start();
```

## Development

This package lives inside the [Cepage monorepo](https://github.com/cgarrot/Cepage). To iterate locally:

```bash
pnpm --filter @cepage/mcp dev       # tsc --watch
pnpm --filter @cepage/mcp test      # tests + build
pnpm --filter @cepage/mcp lint
```
