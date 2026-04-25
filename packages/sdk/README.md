# @cepage/sdk

Typed TypeScript client for the [Cepage](https://github.com/cepage/cepage) HTTP API.

Use it from any Node 20+, Deno, Bun, or browser app to:

- List the skill catalog (filesystem + DB merged) and fetch individual skills
- Execute a skill with typed inputs and wait for its outputs
- Stream live SSE events for a run (queued → running → succeeded/failed)
- Manage scheduled skill runs (create, update, pause, run now)
- Call the save-as-skill authoring endpoints on sessions
- Consume generated per-skill types from Cepage's dynamic OpenAPI document

The SDK has **zero runtime dependencies** — it's just a thin wrapper over the
global `fetch` API — and ships with full TypeScript types for every request
and response.

## Install

```bash
npm install @cepage/sdk
# or
pnpm add @cepage/sdk
# or
yarn add @cepage/sdk
```

## Quickstart

```ts
import { CepageClient } from '@cepage/sdk';

const cepage = new CepageClient({
  apiUrl: 'https://cepage.example.com/api/v1',
  token: process.env.CEPAGE_TOKEN,
});

const skills = await cepage.skills.list();

const run = await cepage.skills.run('weekly-stripe-report', {
  inputs: { startDate: '2026-04-14', endDate: '2026-04-21' },
});

if (run.status === 'succeeded') {
  console.log(run.outputs);
}
```

`skills.run()` blocks by default until the run reaches a terminal state
(`succeeded`, `failed`, or `cancelled`). Pass `{ wait: false }` to return
as soon as the run is queued, and poll or stream yourself later.

## Typed inputs

Use the generics on `skills.run<TInputs>()` to get full autocompletion and
type safety:

```ts
interface WeeklyStripeReportInputs {
  startDate: string;
  endDate: string;
}

const run = await cepage.skills.run<WeeklyStripeReportInputs>(
  'weekly-stripe-report',
  { inputs: { startDate: '2026-04-14', endDate: '2026-04-21' } },
);
```

## Generated catalog types

Cepage exposes a dynamic OpenAPI 3.1 document at `GET /api/v1/openapi.json`. The document contains the stable API schemas plus one generated `Inputs` / `Outputs` schema pair for every typed skill in the catalog.

From the monorepo, generate TypeScript types and per-skill wrappers with:

```bash
pnpm --filter @cepage/sdk generate
```

The generator reads, in order:

1. `CEPAGE_OPENAPI_PATH`, when set.
2. `packages/sdk/.openapi-cache.json`, when present.
3. `CEPAGE_OPENAPI_URL`, defaulting to `http://localhost:31947/api/v1/openapi.json`.

It writes `src/generated/openapi.ts` and `src/generated/skills/index.ts`. The generated code is schema/types only; the hand-written transport, resources, errors, retries, and webhook verifier remain the public runtime surface.

## Streaming events

```ts
for await (const event of cepage.runs.stream(run.id)) {
  console.log(event.type, event.data);
  if (event.type === 'succeeded' || event.type === 'failed') break;
}
```

## Error handling

The SDK exports three error classes you can discriminate with `instanceof`:

```ts
import {
  CepageHttpError,
  CepageValidationError,
  CepageTimeoutError,
} from '@cepage/sdk';

try {
  await cepage.skills.run('weekly-stripe-report', { inputs: {} });
} catch (err) {
  if (err instanceof CepageValidationError) {
    for (const e of err.errors) console.warn(e.path, e.message);
  } else if (err instanceof CepageHttpError) {
    console.error(err.status, err.message);
  } else if (err instanceof CepageTimeoutError) {
    console.error('run exceeded wait budget');
  } else throw err;
}
```

## Custom `fetch`

Pass a `fetchImpl` to override the global `fetch`. This is useful in
restricted environments (Cloudflare Workers, test suites, etc.).

```ts
import { CepageClient } from '@cepage/sdk';
import fetch from 'node-fetch';

const cepage = new CepageClient({
  apiUrl: 'https://cepage.example.com/api/v1',
  fetchImpl: fetch as unknown as typeof globalThis.fetch,
});
```

## API shape

```ts
client.skills.list()            // GET  /workflow-skills
client.skills.get(slug)         // GET  /workflow-skills/:slug
client.skills.listUserSkills()  // GET  /skills
client.skills.run(slug, opts)   // POST /skills/:slug/runs (+ wait)

client.runs.list(opts)          // GET  /skill-runs
client.runs.get(id)             // GET  /skill-runs/:id
client.runs.cancel(id)          // POST /skill-runs/:id/cancel
client.runs.stream(id)          // GET  /skill-runs/:id/stream (SSE)
client.runs.wait(id, timeoutMs) // SSE + terminal polling convenience

client.schedules.list()         // GET    /scheduled-skill-runs
client.schedules.get(id)        // GET    /scheduled-skill-runs/:id
client.schedules.create(body)   // POST   /scheduled-skill-runs
client.schedules.update(id, b)  // PATCH  /scheduled-skill-runs/:id
client.schedules.delete(id)     // DELETE /scheduled-skill-runs/:id
client.schedules.runNow(id)     // POST   /scheduled-skill-runs/:id/run-now

client.sessions.detectInputs(id)       // POST /sessions/:id/detect-inputs
client.sessions.saveAsSkill(id, body)  // POST /sessions/:id/save-as-skill

client.webhooks.list()                 // GET    /webhooks
client.webhooks.get(id)                // GET    /webhooks/:id
client.webhooks.create(body)           // POST   /webhooks         (returns secret once)
client.webhooks.update(id, body)       // PATCH  /webhooks/:id
client.webhooks.delete(id)             // DELETE /webhooks/:id
client.webhooks.ping(id)               // POST   /webhooks/:id/ping
client.webhooks.rotateSecret(id)       // POST   /webhooks/:id/rotate-secret
```

## Verifying webhook signatures

Every webhook delivery carries a `Cepage-Signature: v1,t=<unix>,sig=<hex>`
header computed as `HMAC-SHA256(secret, "<t>.<body>")`. Use the
`verifyWebhookSignature` helper to authenticate incoming deliveries:

```ts
import { verifyWebhookSignature } from '@cepage/sdk';

async function handler(req: Request): Promise<Response> {
  const body = await req.text();
  const ok = await verifyWebhookSignature({
    secret: process.env.CEPAGE_WEBHOOK_SECRET!,
    body,
    header: req.headers.get('cepage-signature'),
  });
  if (!ok) return new Response('invalid signature', { status: 401 });
  const delivery = JSON.parse(body);
  // ...route by delivery.type
  return new Response('ok');
}
```

The verifier is implemented on top of `crypto.subtle` so it runs
unchanged in Node 20+, Bun, Deno, Cloudflare Workers, and browsers.

## Development

```bash
pnpm --filter @cepage/sdk generate
pnpm --filter @cepage/sdk build
pnpm --filter @cepage/sdk test
pnpm --filter @cepage/sdk lint
```

## License

MIT
