# Cepage in Claude Desktop

Claude Desktop ships with native MCP client support; adding Cepage is a
one-file change.

## 1. Locate the config

| OS      | Path                                                                     |
| ------- | ------------------------------------------------------------------------ |
| macOS   | `~/Library/Application Support/Claude/claude_desktop_config.json`        |
| Linux   | `~/.config/Claude/claude_desktop_config.json`                            |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json`                            |

Create the file if it doesn't exist.

## 2. Paste in the Cepage entry

```json
{
  "mcpServers": {
    "cepage": {
      "command": "npx",
      "args": ["-y", "@cepage/mcp"],
      "env": {
        "CEPAGE_URL": "http://localhost:31947"
      }
    }
  }
}
```

See [`claude_desktop_config.json`](./claude_desktop_config.json) for a
copy-pasteable version (including placeholder for `CEPAGE_TOKEN`).

## 3. Restart Claude Desktop

Fully quit (⌘Q on macOS, not just window close) and reopen. Every
Cepage skill shows up in the MCP tool picker (the hammer icon in the
chat composer) as `cepage_<slug>`.

## Verifying

Ask the model:

> List every tool from the `cepage` MCP server.

It should reply with one entry per skill in your catalog. If the list
is empty, check the MCP log in Claude Desktop's developer options.

## Auth for hosted Cepage

Add the bearer token to the `env` block:

```json
{
  "mcpServers": {
    "cepage": {
      "command": "npx",
      "args": ["-y", "@cepage/mcp"],
      "env": {
        "CEPAGE_URL": "https://your-cepage.example.com",
        "CEPAGE_TOKEN": "sk-..."
      }
    }
  }
}
```
