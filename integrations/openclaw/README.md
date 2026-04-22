# Cepage in OpenClaw

This directory is a drop-in OpenClaw **plugin bundle** that registers the
Cepage MCP server as an MCP tool provider. Install it once and every
skill in your Cepage catalog becomes an MCP tool available during
OpenClaw Pi turns.

## What you get

Each saved Cepage skill (e.g. `weekly-stripe-report`, `summarize-inbox`)
shows up in OpenClaw as an MCP tool named `cepage__<slug>`, with the
same typed inputs you defined in the web studio. Your Pi agent can call
them mid-conversation like any other MCP tool.

> Note on naming: OpenClaw registers MCP tools as
> `<serverName>__<toolName>`, and Cepage emits tools as
> `cepage_<slug>`. With OpenClaw's prefix this becomes
> `cepage__cepage_<slug>` — not the most compact name in the world. If
> you rename the server in `.mcp.json` (`"cepage"` → e.g. `"lib"`) the
> tools become `lib__cepage_<slug>` instead.

## Install

From an OpenClaw workspace:

```bash
# Local install, pointed at this directory:
openclaw plugins install /path/to/zob-ai-v2/integrations/openclaw

# Confirm detection
openclaw plugins list
openclaw plugins inspect cepage

# Apply
openclaw gateway restart
```

The bundle is format `claude` (i.e. `.mcp.json`-style), so OpenClaw will
merge its MCP server entries into the effective embedded Pi settings.
See [OpenClaw plugin bundles docs](https://docs.openclaw.dev/plugins/bundles)
for the full semantics.

## Configuration

`.mcp.json` declares a single MCP server named `cepage`. By default it
launches `npx -y @cepage/mcp`, which:

- Reads `CEPAGE_URL` (default `http://localhost:31947`)
- Reads `CEPAGE_TOKEN` if your API requires auth
- Lists every skill in the catalog as an MCP tool

If you don't want `npx` at runtime, pin it explicitly by editing
`.mcp.json` to point at a local install of `@cepage/mcp` instead:

```json
{
  "mcpServers": {
    "cepage": {
      "command": "node",
      "args": ["/abs/path/to/packages/mcp/dist/bin/cepage-mcp.js"],
      "env": {
        "CEPAGE_URL": "http://localhost:31947"
      }
    }
  }
}
```

## Auth

For hosted Cepage, set `CEPAGE_TOKEN` in your environment before
starting OpenClaw, or add it explicitly in `.mcp.json`:

```json
{
  "mcpServers": {
    "cepage": {
      "command": "npx",
      "args": ["-y", "@cepage/mcp"],
      "env": {
        "CEPAGE_URL": "https://your-cepage.example.com",
        "CEPAGE_TOKEN": "${CEPAGE_TOKEN}"
      }
    }
  }
}
```

OpenClaw will interpolate `${CEPAGE_TOKEN}` from the ambient env at
plugin load time.

## Verifying the integration

Once installed, confirm tools surface on an embedded Pi turn:

```bash
openclaw pi tools list --filter cepage
# Expect: cepage__cepage_<slug>, one per skill in your catalog
```

If nothing shows up, inspect the plugin:

```bash
openclaw plugins inspect cepage
```

The inspector prints the resolved MCP server config and any diagnostics
from merging `.mcp.json`. If the server reports "process exited
immediately," usually `CEPAGE_URL` is unreachable; double-check the
daemon is running (`pnpm dev` in this repo's root).

## Trust model

- The bundle does **not** register native OpenClaw plugins — it only
  contributes an MCP server config. All execution happens in the
  `@cepage/mcp` subprocess, which only talks to your configured Cepage
  API.
- Secrets declared as `secret` in skill input schemas are redacted from
  Cepage's own logs by default (see `docs/security/secret-redaction.md`
  in the Cepage repo). OpenClaw additionally redacts URL credentials
  from its own logs.
