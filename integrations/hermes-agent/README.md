# Cepage in Hermes

Wire Cepage into [Hermes](https://github.com/your-org/hermes-agent)
through its MCP server configuration. Once installed, every saved
Cepage skill becomes an MCP tool available in Hermes CLI/TUI sessions
and on any enabled platform (Telegram, Discord, Slack, etc.).

## Prerequisites

- Hermes installed (`hermes --version` works)
- Node 20+ on your `$PATH` (Hermes spawns the MCP stdio server via
  `npx`)
- A reachable Cepage API (`http://localhost:31947/api/v1` by default)

## 1. Append the server to your Hermes config

Copy the snippet from [`config.yaml`](./config.yaml) into your existing
Hermes config (typically `~/.hermes/config.yaml`). The relevant block
is:

```yaml
mcp_servers:
  cepage:
    command: npx
    args: ["-y", "@cepage/mcp"]
    env:
      CEPAGE_URL: "http://localhost:31947"
      # Uncomment and set if your API requires auth:
      # CEPAGE_TOKEN: "${CEPAGE_TOKEN}"
```

Hermes supports `${ENV_VAR}` interpolation for env values, so you can
keep secrets out of the YAML file.

## 2. Enable the Cepage toolset

Hermes creates an `mcp-cepage` toolset from the server above. Include
it either per-session or per-platform.

Per-session:

```bash
hermes chat --toolsets hermes-cli,mcp-cepage
```

Per-platform in `~/.hermes/config.yaml`:

```yaml
toolsets:
  - hermes-cli
  - mcp-cepage
```

Or interactively:

```bash
hermes tools
# toggle `mcp-cepage` on for the platforms you want
```

## 3. Try it out

From a Hermes chat:

```
/tools list          # expect: several cepage_<slug> tools
```

Then prompt the agent normally — it can call any Cepage skill as a
regular tool. Example:

```
Run the weekly-stripe-report skill for the last 7 days and post a
three-bullet summary.
```

## Scoping tools (optional)

If your Cepage catalog has many skills and you only want a subset
exposed in Hermes, use Hermes' built-in include/exclude filters:

```yaml
mcp_servers:
  cepage:
    command: npx
    args: ["-y", "@cepage/mcp"]
    env:
      CEPAGE_URL: "http://localhost:31947"
    tools:
      include:
        - cepage_weekly_stripe_report
        - cepage_summarize_inbox
      prompts: false
      resources: false
```

> Note: Hermes matches tools by the *raw* MCP tool name which Cepage
> emits as `cepage_<slug_with_underscores>`. Run `/tools list` once
> without any filter to see the exact names, then narrow down.

## Remote Cepage

If Cepage is hosted rather than running on `localhost`, keep the stdio
transport but point it at the remote URL via env vars:

```yaml
mcp_servers:
  cepage:
    command: npx
    args: ["-y", "@cepage/mcp"]
    env:
      CEPAGE_URL: "https://your-cepage.example.com"
      CEPAGE_TOKEN: "${CEPAGE_TOKEN}"
```

A streamable-HTTP MCP endpoint on the hosted playground is tracked in
the follow-up task `p2-hosted-demo`.

## Troubleshooting

- **`mcp-cepage` toolset doesn't exist.** Hermes only auto-creates the
  toolset after a successful `listTools()` call. Check
  `~/.hermes/logs/latest.log` for connection errors — the two most
  common are `CEPAGE_URL` unreachable and a stale `CEPAGE_TOKEN`.
- **Tool calls return 401.** Either your token expired or Cepage was
  restarted with a fresh per-user secret. Rotate it in the UI and
  update your Hermes config.
- **Tools are missing.** Run Cepage's own verification first:
  `curl http://localhost:31947/api/v1/skills | jq '.items[] | .slug'`.
  If the skill shows up there but not in Hermes, widen any
  `tools.include` filter.
