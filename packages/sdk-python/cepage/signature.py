"""HMAC-SHA256 signature helpers for Cepage webhooks.

Mirrors :mod:`@cepage/sdk/signature`. Use this module inside your
webhook receiver to verify that a payload really came from your
Cepage instance::

    from cepage.signature import verify_webhook_signature

    def handler(request):
        body = request.body.decode("utf-8")
        ok = verify_webhook_signature(
            secret=SECRET,
            body=body,
            header=request.headers.get("cepage-signature"),
        )
        if not ok:
            return Response(status=401)
        ...

The header format matches Stripe's ``v1,t=<unix>,sig=<hex>`` scheme
so downstream verifiers can share the same regex if needed.
"""

from __future__ import annotations

import hmac
import time
from dataclasses import dataclass
from hashlib import sha256


@dataclass
class ParsedSignature:
    scheme: str
    timestamp: int
    signature: str


def parse_webhook_signature_header(header: str | None) -> ParsedSignature | None:
    """Parse a ``Cepage-Signature`` header into its components.

    Returns ``None`` if the header is missing or malformed; callers
    should treat that the same as a signature mismatch.
    """
    if not header:
        return None
    scheme: str | None = None
    timestamp: int | None = None
    signature: str | None = None
    for raw_part in header.split(","):
        part = raw_part.strip()
        if part == "v1":
            scheme = "v1"
            continue
        if "=" not in part:
            continue
        key, _, value = part.partition("=")
        if key == "t":
            try:
                timestamp = int(value)
            except ValueError:
                return None
        elif key == "sig":
            signature = value
    if scheme is None or signature is None or timestamp is None:
        return None
    return ParsedSignature(scheme=scheme, timestamp=timestamp, signature=signature)


def verify_webhook_signature(
    *,
    secret: str,
    body: str,
    header: str | None,
    tolerance_sec: int = 300,
    now: int | None = None,
) -> bool:
    """Return ``True`` if the signature matches the body under ``secret``.

    - Uses ``hmac.compare_digest`` to avoid timing attacks.
    - Rejects deliveries whose timestamp is more than ``tolerance_sec``
      seconds from ``now`` (default: current system time).
    """
    parsed = parse_webhook_signature_header(header)
    if parsed is None:
        return False
    current = now if now is not None else int(time.time())
    if abs(current - parsed.timestamp) > tolerance_sec:
        return False
    signed = f"{parsed.timestamp}.{body}".encode()
    expected = hmac.new(secret.encode("utf-8"), signed, sha256).hexdigest()
    return hmac.compare_digest(expected, parsed.signature)


__all__ = [
    "ParsedSignature",
    "parse_webhook_signature_header",
    "verify_webhook_signature",
]
