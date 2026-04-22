# @cepage/cli

The `cepage` CLI runs, lists, and schedules typed skills against a Cepage API
from your terminal. It's a thin wrapper around [`@cepage/sdk`](../../packages/sdk/README.md)
— every command just forwards to the SDK and pretty-prints the result (or
emits raw JSON when `--json` is passed).

## Install

From the monorepo:

```bash
pnpm build
node apps/cli/dist/src/cli.js skills list
```

When published (planned):

```bash
npm i -g @cepage/cli
cepage auth login --api-url http://localhost:31947/api/v1
cepage skills list
```

## Config

Config precedence (first match wins):

1. CLI flags — `--api-url`, `--token`
2. Env — `CEPAGE_API_URL`, `CEPAGE_TOKEN`
3. File — `~/.cepage/config.json` (written by `cepage auth login`)
4. Default — `http://localhost:31947/api/v1`

See the current resolution with:

```bash
cepage config          # pretty-printed
cepage config --json   # machine-readable
```

## Commands

```
cepage skills list [--kind workflow|prompt_only|workflow_template]
cepage skills get <slug>
cepage skills run <slug> [--input key=value]... [--inputs-file path.json] [--no-wait] [--timeout seconds]
cepage runs list [--skill <slug>] [--limit <n>]
cepage runs get <id>
cepage runs cancel <id>
cepage runs stream <id>
cepage schedules list
cepage schedules create --skill <slug> --cron <expr> [--inputs-file path.json] [--input k=v]... [--label text] [--status active|paused]
cepage schedules update <id> [--cron <expr>] [--label text] [--status active|paused]
cepage schedules delete <id>
cepage schedules run-now <id>
cepage webhooks list
cepage webhooks get <id>
cepage webhooks create --url <url> [--event evt]... [--skill <slug>] [--description <text>] [--inactive]
cepage webhooks update <id> [--url <url>] [--event evt]... [--active|--inactive] [--rotate-secret]
cepage webhooks delete <id>
cepage webhooks ping <id>
cepage webhooks rotate-secret <id>
cepage auth login [--api-url <url>] [--token <token>]
cepage auth logout
cepage config
```

### Global flags

| Flag | Description |
| --- | --- |
| `--api-url <url>` | Override API base URL |
| `--token <token>` | Override API token |
| `--json` | Emit machine-readable JSON |
| `--no-color` | Disable ANSI colour output |
| `-h`, `--help` | Show help |

## Typed inputs

`--input key=value` can be passed multiple times. Values are best-effort JSON-decoded:

```bash
# Primitives get inferred types
cepage skills run weekly-stripe-report \
  --input startDate=2026-04-14 \
  --input endDate=2026-04-21 \
  --input limit=50 \
  --input verbose=true

# Nested keys via dot syntax
cepage skills run inbox-summary --input filter.priority=P1

# Arrays and objects via inline JSON
cepage skills run ticket-classifier \
  --input tags='["bug","p0"]' \
  --input overrides='{"dryRun":true}'

# Large payloads belong in a file
cepage skills run big-import --inputs-file ./payload.json
```

## Examples

```bash
# Run and wait for the result
cepage skills run weekly-stripe-report \
  --input startDate=2026-04-14 \
  --input endDate=2026-04-21

# Run in the background
cepage skills run weekly-stripe-report --no-wait --input ... # prints the runId
cepage runs stream run_abc123                                # follow the SSE stream

# Manage schedules
cepage schedules create --skill weekly-stripe-report \
  --cron '0 9 * * 1' --inputs-file ./inputs.json

# Cancel a running skill
cepage runs cancel run_abc123

# Subscribe to skill run events (the secret is shown ONCE; save it).
cepage webhooks create \
  --url https://your-service.example.com/cepage \
  --event skill_run.completed \
  --event skill_run.failed \
  --description 'prod incident channel'

# Send a test delivery to verify your endpoint is wired up.
cepage webhooks ping wh_01HNXZ...

# Rotate the HMAC signing secret (the old secret stops being valid).
cepage webhooks rotate-secret wh_01HNXZ...
```

### Webhook signature verification

Every delivery includes a `Cepage-Signature: v1,t=<unix>,sig=<hex>` header
computed as `HMAC-SHA256(secret, "<t>.<body>")`. Verify it with the SDK
helper shipped alongside the CLI:

```ts
import { verifyWebhookSignature } from '@cepage/sdk/signature';

const ok = await verifyWebhookSignature({
  secret: process.env.CEPAGE_WEBHOOK_SECRET!,
  body: await req.text(),
  header: req.headers.get('cepage-signature'),
});
```

The equivalent Python helper lives in `cepage.signature.verify_webhook_signature`.

## Exit codes

| Code | Meaning |
| ---- | ------- |
| 0    | Success (or in-flight status when `--no-wait`) |
| 1    | Run failed / server returned a typed error |
| 2    | Usage error (invalid args, missing required flags) |

## Development

```bash
pnpm --filter @cepage/cli build
pnpm --filter @cepage/cli test
pnpm --filter @cepage/cli lint
```
