# Webhook receiver (Node.js / Express)

Minimal server that verifies Cepage's `Cepage-Signature` header and
logs every delivery. Drop it behind a public URL (e.g. ngrok / Cloudflare
Tunnel) and add the URL to a Cepage webhook subscription.

## Run

```bash
cd integrations/webhooks-verify-node
npm install
CEPAGE_WEBHOOK_SECRET=whsec_xxx PORT=4000 npm start
```

Then in another terminal, create a subscription pointing at it:

```bash
cepage webhooks create \
  --url http://localhost:4000/cepage-webhook \
  --events 'skill_run.completed,skill_run.failed'
# Copy the `secret` from the response into CEPAGE_WEBHOOK_SECRET above.

cepage webhooks ping <id>
# Expect: { delivered: true, httpStatus: 200 } in the CLI
# and a `webhook.ping` log line in this server's stdout.
```

## How verification works

Cepage signs each delivery with HMAC-SHA256 using your subscription
secret. The header format is:

```
Cepage-Signature: v1,t=<unix_seconds>,sig=<hex_hmac_sha256>
```

This example uses the zero-dep verifier shipped in
[`@cepage/sdk/signature`](../../packages/sdk/src/signature.ts), which
runs on Node 20+, Deno, Bun, browsers, and edge runtimes.

## Files

- `server.js` — raw Express receiver. Uses `express.raw()` so the
  signed body bytes match exactly what Cepage hashed.
- `package.json` — pins `@cepage/sdk` and `express`.
