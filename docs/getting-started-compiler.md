# Getting Started with the Skill Compiler

Your agent builds features. Cepage compiles them into reusable systems.

This guide covers the Skill Compiler surface, one of two ways to create skills in Cepage. The other is the Studio canvas, where you design workflows visually. Both feed the same typed skill library.

---

## What is the Skill Compiler?

The Skill Compiler turns a one-off agent session into a reusable, typed skill.

After you finish a session with Cursor, OpenCode, or Claude Code, you send the session artifacts to Cepage. Cepage extracts the execution graph, replaces concrete values like "Stripe" with typed parameters like `{{payment_provider}}`, runs a dry-run validation, and emits a skill you can call from the CLI, SDK, or MCP server.

**The five phases:**

1. **Capture** — You explicitly send session artifacts to Cepage.
2. **Extract** — Cepage parses the session into a canonical execution graph.
3. **Parameterize** — Concrete values become typed placeholders with a JSON Schema.
4. **Validate** — A dry-run with a mock LLM checks structural correctness at zero cost.
5. **Package** — The skill is saved to your library with a typed contract.

---

## Quick Start

### Capture a Cursor Session

Cursor stores sessions locally. After you finish a task, import it into Cepage:

```bash
# Import the most recent Cursor session
cepage import cursor --latest

# Or import a specific session by ID
cepage import cursor --session-id <session-id>

# Import and compile in one step
cepage import cursor --latest --publish
```

Cepage reads the Cursor SQLite export, reconstructs the execution graph, and opens the compilation review page in your browser.

### Capture an OpenCode Session

Run OpenCode through Cepage so the full SSE stream is captured automatically:

```bash
# Run OpenCode with capture enabled
cepage run opencode --capture --prompt "Build a Stripe integration"

# Or run from a file
cepage run opencode --capture --prompt-file ./task.md

# Capture but keep as a draft (no compilation yet)
cepage run opencode --capture --draft --prompt "Scaffold a REST API"
```

When the session ends, Cepage stores the graph and proposes compilable patterns.

### Capture a Claude Code Session

Claude Code support has two parts:

1. The native daemon can spawn Claude Code runs when the `claude` CLI is installed.
2. The CLI can install a post-session hook that packages finished Claude Code sessions and sends them to the Skill Compiler.

```bash
# Install the hook
cepage hook install claude-code

# Remove it later if needed
cepage hook install --uninstall claude-code
```

The hook is written to `~/.claude/hooks/cepage-compile.sh`. It uses the configured Cepage API URL, or `CEPAGE_API_URL` when set, and sends the session as a compile request after Claude Code finishes.

---

## Review and Edit Parameters

After capture, Cepage opens the compilation review page. This is where you decide what becomes configurable.

**What you see:**

- **Graph preview** — The extracted execution graph with all agent calls, file edits, test runs, and deploy steps.
- **Detected parameters** — Cepage suggests replacements for hardcoded values:
  - `"Stripe"` → `{{payment_provider}}`
  - `"sk_live_xxx"` → `{{api_key}}`
  - `"https://api.stripe.com"` → `{{api_base_url}}`
- **JSON Schema editor** — Edit the inferred schema: change types, add descriptions, mark fields as required or optional, set defaults.

**How to edit:**

1. Review each detected parameter. Remove false positives. Add missing ones.
2. Adjust the JSON Schema. Cepage infers types from observed values, but you know the domain better.
3. Preview the parameterized graph to see exactly what will change between runs.

---

## Dry-Run Before Publishing

A dry-run replays the compiled skill with a mock LLM and an isolated git worktree. It costs $0 and catches structural errors before you commit the skill to your library.

```bash
# Dry-run a skill before publishing
cepage skills dry-run <skill-slug>

# Dry-run with custom parameter values
cepage skills dry-run payment-integration \
  --input payment_provider=paypal \
  --input api_base_url=https://api.paypal.com

# Fail on warnings as well as hard errors
cepage skills dry-run payment-integration --mode strict
```

**What the dry-run checks:**

- All required parameters are present.
- Parameter values match their JSON Schema types.
- The execution graph is structurally valid (no orphaned nodes, no broken edges).
- File operations resolve to valid paths.

If the dry-run fails, the review page shows exactly which step failed and why. Fix the parameters or the schema, then re-run.

---

## Run a Compiled Skill

Once published, a skill is available everywhere.

### From the CLI

```bash
# Run with inline inputs
cepage skills run payment-integration \
  --input payment_provider=stripe \
  --input api_key=sk_live_xxx

# Run with a JSON file
cepage skills run payment-integration --inputs-file ./stripe-config.json

# Run and stream events in real time
cepage skills run payment-integration --input payment_provider=stripe --stream
```

### From the Library UI

Open [`/library`](http://localhost:31961/library) in your browser. Each skill has an auto-generated form built from its JSON Schema. Fill in the fields, click Run, and watch the SSE stream in the run detail page.

### From the TypeScript SDK

```ts
import { CepageClient } from '@cepage/sdk';

const cepage = new CepageClient({ apiUrl: 'http://localhost:31947/api/v1' });

const run = await cepage.skills.run('payment-integration', {
  inputs: {
    paymentProvider: 'stripe',
    apiKey: process.env.STRIPE_KEY,
  },
});

console.log(run.outputs);
```

For generated catalog types, run `pnpm --filter @cepage/sdk generate` against `GET /api/v1/openapi.json` or a cached spec. This emits the dynamic per-skill schemas under `packages/sdk/src/generated/` without replacing the hand-written HTTP client.

### From the Python SDK

```python
from cepage import CepageClient

with CepageClient(api_url="http://localhost:31947/api/v1") as cepage:
    run = cepage.skills.run(
        "payment-integration",
        inputs={
            "paymentProvider": "stripe",
            "apiKey": os.environ["STRIPE_KEY"],
        },
    )
    print(run.outputs)
```

For Python generated dataclasses, run `python packages/sdk-python/scripts/generate-python-sdk-types.py`. The generated module is local build output and is intentionally ignored by git.

### From an MCP Client

Cepage exposes every compiled skill as an MCP tool. Connect Cepage to Cursor, Claude Code, or any MCP-compatible agent:

```json
{
  "mcpServers": {
    "cepage": {
      "command": "npx",
      "args": ["@cepage/mcp"]
    }
  }
}
```

Then ask your agent: *"Run the payment-integration skill with provider set to PayPal."*

---

## Examples

### Example 1: Payment Provider Integration

You ask Cursor to build a Stripe integration. It creates backend routes, frontend components, webhook handlers, and tests. Here is how you turn that session into a reusable skill.

**Step 1: Capture**

```bash
cepage import cursor --latest
```

**Step 2: Review**

Cepage detects four parameterizable values:

| Detected Value | Proposed Parameter | Type |
|---|---|---|
| "Stripe" | `payment_provider` | string |
| "sk_live_xxx" | `api_key` | string |
| "https://api.stripe.com" | `api_base_url` | string |
| 12 | `webhook_event_count` | integer |

You review, adjust descriptions, and set `webhook_event_count` to optional with a default of 10.

**Step 3: Dry-run**

```bash
cepage skills dry-run payment-integration \
  --input payment_provider=paypal \
  --input api_base_url=https://api.paypal.com
```

Result: PASS. Structural checks pass. Parametric coverage: 3/3 required fields.

**Step 4: Publish and reuse**

Publish from the compilation review page, then run it from the CLI:

```bash
cepage skills run payment-integration \
  --input payment_provider=paypal \
  --input api_key=YOUR_PAYPAL_KEY \
  --input api_base_url=https://api.paypal.com
```

The same workflow that cost $12 and 5 minutes to explore now runs in 2 minutes for $0.45.

### Example 2: API Client Generation

You run OpenCode through Cepage to scaffold a REST API client from an OpenAPI spec.

**Step 1: Capture**

```bash
cepage run opencode --capture --prompt-file ./generate-client.md
```

The prompt asks OpenCode to generate a TypeScript client with typed request/response models.

**Step 2: Review**

Cepage parameterizes:

- The spec URL → `{{openapi_spec_url}}`
- The output directory → `{{output_dir}}`
- The target language → `{{language}}` (enum: typescript, python, go)

**Step 3: Dry-run and publish**

```bash
cepage skills dry-run api-client-generator \
  --input openapi_spec_url=https://petstore.swagger.io/v2/swagger.json \
  --input language=typescript \
  --input output_dir=./src/client
```

If the report passes, publish from the compilation review page.

**Step 4: Reuse**

```bash
# Generate a Python client for a different API
cepage skills run api-client-generator \
  --input openapi_spec_url=https://api.example.com/openapi.json \
  --input language=python \
  --input output_dir=./clients/python
```

---

## Operating Modes

| Mode | What it does | Cost | When to use |
|---|---|---|---|
| **Compile** | Extract, parameterize, package | $0.01 | After any successful session |
| **Dry-run** | Replay with mock LLM, no API calls | $0 | CI checks, regression tests |
| **Full** | Run the compiled skill with real agents | $0.45–$12 | Production deployment |

---

## Next Steps

- **Explore the Studio canvas:** Save workflows visually with human-in-the-loop approval nodes. See the [Skill Library](../README.md#skill-library) section in the main README.
- **Browse the workflow catalog:** [`docs/workflow-prompt-library/`](workflow-prompt-library/)
- **Check the API reference:** [`docs/07-API-CONTRACTS.md`](07-API-CONTRACTS.md)

---

## Troubleshooting

**"No sessions found" when importing Cursor**

Cursor stores sessions in `~/.cursor/chats/`. Make sure Cursor has run at least one session and that the SQLite database exists. If you use a non-standard Cursor data directory, pass `--cursor-data-dir`:

```bash
cepage import cursor --latest --cursor-data-dir /path/to/cursor/data
```

**"Extraction failed" on OpenCode capture**

The SSE stream may have been interrupted. Try re-running with `--capture` again. If the session graph is incomplete, you can still save it as a raw skill without compilation and add parameters manually on the Studio canvas.

**"claude CLI not found in PATH" when installing the hook**

Install Claude Code and make sure `claude` is available in the shell that runs `cepage hook install claude-code`. If you use a wrapper or custom binary path for daemon runs, set `CLAUDE_BIN`.

**Dry-run fails with "missing required parameter"**

Check the JSON Schema in the review page. Mark the field as optional with a default, or provide it during the dry-run with `--input key=value`.

**"Skill not found" when running**

Skills are identified by slug. Use `cepage skills list` to see available skills. The slug is shown in the compilation review page when you publish.

---

*Last updated: 2026-04-25*
