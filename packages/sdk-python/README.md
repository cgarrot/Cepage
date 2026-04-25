# cepage (Python SDK)

`cepage` is the official Python client for the [Cepage](https://github.com/cepage/cepage)
HTTP API. It mirrors the TypeScript SDK (`@cepage/sdk`) so you can list your
typed skills, run them with validated inputs, stream progress, and manage
schedules from any Python 3.9+ application or notebook.

## Installation

```bash
pip install cepage
# or
uv add cepage
```

## Quickstart

### Synchronous

```python
from cepage import CepageClient

with CepageClient(api_url="http://localhost:31947/api/v1") as cepage:
    skills = cepage.skills.list()
    print([s.id for s in skills])

    run = cepage.skills.run(
        "weekly-stripe-report",
        inputs={"startDate": "2026-04-14", "endDate": "2026-04-21"},
    )
    print(run.status, run.outputs)
```

### Asynchronous

```python
import asyncio
from cepage import AsyncCepageClient


async def main() -> None:
    async with AsyncCepageClient(api_url="http://localhost:31947/api/v1") as cepage:
        run = await cepage.skills.run("weekly-stripe-report", inputs={...})
        print(run.outputs)


asyncio.run(main())
```

## Streaming events

Both clients expose `runs.stream(run_id)` which yields `SkillRunEvent` objects
for every SSE frame (`snapshot`, `started`, `progress`, `log`, `output`,
`succeeded`, `failed`, `cancelled`). `runs.wait(run_id)` is a convenience
helper that consumes the stream until a terminal event arrives.

```python
for event in cepage.runs.stream("run_123"):
    print(event.type, event.data)
```

## Typed inputs

`inputs` is a plain `dict[str, Any]`; the API validates it against the skill's
declared JSON Schema and returns a `CepageValidationError` (subclass of
`CepageHTTPError`) when fields are missing or malformed:

```python
from cepage import CepageValidationError

try:
    cepage.skills.run("weekly-stripe-report", inputs={})
except CepageValidationError as err:
    for detail in err.errors:
        print(detail.path, detail.message)
```

## Generated skill dataclasses

Cepage's OpenAPI document is dynamic: every typed skill contributes its own `<Slug>Inputs` and `<Slug>Outputs` schemas. The Python SDK keeps the HTTP client hand-written, but can generate local stdlib dataclasses for those dynamic schemas:

```bash
python packages/sdk-python/scripts/generate-python-sdk-types.py
```

By default the script reads `packages/sdk/.openapi-cache.json`. Override it with `OPENAPI_SPEC_PATH=/path/to/openapi.json`. The output is `cepage/generated_types.py`, which is ignored by git because it depends on the active skill catalog for the instance you generated from.

## Scheduling

```python
schedule = cepage.schedules.create(
    {
        "skill_id": "weekly-stripe-report",
        "cron": "0 9 * * 1",
        "request": {"inputs": {"startDate": "auto", "endDate": "auto"}},
    }
)
cepage.schedules.run_now(schedule.id)
```

## Webhooks

Subscribe to skill run lifecycle events. The `create` call returns the
signing `secret` exactly once — store it immediately:

```python
created = cepage.webhooks.create(
    {
        "url": "https://your-service.example.com/cepage",
        "events": ["skill_run.completed", "skill_run.failed"],
        "description": "prod incident channel",
    }
)
# `created.secret` is shown once; it is not returned by any later call.
SIGNING_SECRET = created.secret

# Send a test delivery and confirm your endpoint is wired up.
cepage.webhooks.ping(created.id)
```

### Verifying the signature

Every delivery carries a `Cepage-Signature: v1,t=<unix>,sig=<hex>`
header computed as `HMAC-SHA256(secret, "<t>.<body>")`. Use the
helper from `cepage.signature` in your webhook handler:

```python
from cepage.signature import verify_webhook_signature


def handler(request) -> tuple[int, str]:
    body = request.body.decode("utf-8")
    ok = verify_webhook_signature(
        secret=SIGNING_SECRET,
        body=body,
        header=request.headers.get("cepage-signature"),
    )
    if not ok:
        return 401, "bad signature"
    # dispatch on the delivery envelope
    return 204, ""
```

The helper rejects deliveries whose timestamp drifts more than five
minutes from wall-clock time (configurable via `tolerance_sec`).

## Authentication and custom transports

`CepageClient` accepts an optional `token` for Bearer auth. For advanced
transports (proxies, retries, custom TLS), pass your own `httpx.Client`
via `httpx_client=...`; the SDK will reuse it and leave ownership to you.

## Error envelope

Every non-2xx response is mapped to a typed exception:

| Status          | Exception                  |
| --------------- | -------------------------- |
| 400 `INVALID_INPUT` | `CepageValidationError`    |
| other 4xx / 5xx | `CepageHTTPError`          |
| wait timeout    | `CepageTimeoutError`       |

The original API envelope (`{"success": false, "error": {...}}`) is always
available as `err.body` for custom handling.

## Development

```bash
cd packages/sdk-python
uv venv
uv pip install -e ".[dev]"
python scripts/generate-python-sdk-types.py
pytest
ruff check .
mypy cepage
```
