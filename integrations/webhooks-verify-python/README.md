# Webhook receiver (Python / FastAPI)

Minimal FastAPI server that verifies the `Cepage-Signature` header and
logs every delivery.

## Run

```bash
cd integrations/webhooks-verify-python
uv sync
CEPAGE_WEBHOOK_SECRET=whsec_xxx uv run uvicorn main:app --port 4000 --reload
```

## Create the subscription

```bash
cepage webhooks create \
  --url http://localhost:4000/cepage-webhook \
  --events 'skill_run.completed,skill_run.failed'
# Copy the `secret` from the response into CEPAGE_WEBHOOK_SECRET above.

cepage webhooks ping <id>
```

## How verification works

Same scheme as the Node example. The shared helper is
[`cepage.signature.verify_webhook_signature`](../../packages/sdk-python/cepage/signature.py)
(ships with the `cepage-sdk` Python package). It:

- Parses `v1,t=<unix>,sig=<hex>` into a dataclass
- Checks the timestamp is within 5 minutes of `time.time()`
- Computes `HMAC-SHA256(secret, f"{t}.{body}")` and compares with
  `hmac.compare_digest` to avoid timing leaks

## Notes

- The receiver reads the raw request body (not the parsed JSON), because
  signing happens before JSON reparse. FastAPI's `await request.body()`
  returns the same bytes Cepage hashed.
- In production you'd usually persist deliveries to a queue before
  acking; for readability this example just prints them.
