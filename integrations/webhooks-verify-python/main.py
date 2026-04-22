"""Minimal FastAPI receiver for Cepage webhook deliveries.

Run locally with::

    CEPAGE_WEBHOOK_SECRET=whsec_xxx \\
      uv run uvicorn main:app --port 4000 --reload
"""

from __future__ import annotations

import json
import os
import sys

from cepage.signature import verify_webhook_signature
from fastapi import FastAPI, HTTPException, Request

SECRET = os.environ.get("CEPAGE_WEBHOOK_SECRET")
if not SECRET:
    print("CEPAGE_WEBHOOK_SECRET is required", file=sys.stderr)
    sys.exit(1)

app = FastAPI()


@app.post("/cepage-webhook")
async def receive_webhook(request: Request) -> dict[str, str]:
    raw = await request.body()
    body = raw.decode("utf-8")
    header = request.headers.get("cepage-signature")

    if not verify_webhook_signature(secret=SECRET, body=body, header=header):
        raise HTTPException(status_code=401, detail="bad signature")

    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="invalid json") from exc

    print(
        "webhook delivered:",
        json.dumps(
            {
                "event": payload.get("event"),
                "id": payload.get("id"),
                "data": payload.get("data"),
            },
            indent=2,
        ),
    )
    return {"status": "ok"}
