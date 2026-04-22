# Cepage in Cursor

Wire Cepage's MCP server into Cursor so every saved skill in your
catalog shows up as an MCP tool any Cursor agent can call.

## Prerequisites

- Cursor 0.45+ (MCP support landed in late 2024)
- Node 20+ on your `$PATH`
- A running Cepage instance you can hit from `localhost` (`pnpm dev` from
  the repo root is fine)

## 1. Drop the config in

Copy [`mcp.json`](./mcp.json) to `~/.cursor/mcp.json`:

```bash
cp integrations/cursor/mcp.json ~/.cursor/mcp.json
```

If you already have an `~/.cursor/mcp.json`, merge the `mcpServers.cepage`
entry into yours; Cursor accepts any number of MCP servers side by side.

## 2. Restart Cursor

Use the command palette entry **"MCP: Restart Servers"** or quit and
relaunch the app. Cursor will spawn `npx -y @cepage/mcp` as a child
process and list every skill in your catalog as
`cepage_<slug>` inside the Agent tool picker.

## 3. Try it out

From any Cursor agent chat:

1. `@` to open the tool picker, scroll to **cepage**
2. Pick a skill (e.g. `weekly-stripe-report`)
3. Fill in the typed inputs — the form is auto-generated from the
   skill's JSON Schema
4. The agent gets the skill output as a tool result and can keep
   reasoning with it

## Env variables

| Var          | Required                | Purpose                                |
| ------------ | ----------------------- | -------------------------------------- |
| `CEPAGE_URL` | optional                | Override the API (default: `http://localhost:31947`) |
| `CEPAGE_TOKEN` | if the API needs auth | Bearer token (e.g. in hosted mode)     |

If you set these in your shell rc files Cursor will inherit them; if
you prefer a config-file-only setup, pass them via the `env:` block in
`mcp.json`.

## Troubleshooting

- **No tools show up.** Open Cursor's MCP logs (Command Palette →
  "MCP: Open Logs") — the first lines usually say whether the
  `@cepage/mcp` process exited or couldn't reach the API.
- **`listTools` is empty.** Visit
  `http://localhost:31947/api/v1/workflow-skills` from the same
  machine; if that's empty, no skills are registered.
- **The server shows up but tool calls time out.** Increase the
  per-call timeout in `mcp.json` via `"requestTimeout": 60000`, or
  check that your skill actually terminates (run it once from
  `/library/<slug>` in the web UI first).
