"""Tests for the webhooks resource on both sync and async clients."""

from __future__ import annotations

import hmac
import json
from hashlib import sha256

import httpx
import pytest

from cepage import (
    CepageClient,
    parse_webhook_signature_header,
    verify_webhook_signature,
)

SAMPLE = {
    "id": "wh_1",
    "url": "https://example.test/hook",
    "events": ["skill_run.completed"],
    "skillId": None,
    "active": True,
    "description": None,
    "createdAt": "t",
    "updatedAt": "t",
}


def test_webhooks_list_returns_items(sync_client_factory, envelope_factory):  # type: ignore[no-untyped-def]
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path.endswith("/webhooks")
        return httpx.Response(200, json=envelope_factory([SAMPLE]))

    client, _ = sync_client_factory(handler)
    items = client.webhooks.list()
    assert len(items) == 1
    assert items[0].id == "wh_1"
    assert items[0].events == ["skill_run.completed"]


def test_webhooks_create_returns_secret(sync_client_factory, envelope_factory):  # type: ignore[no-untyped-def]
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        body = json.loads(request.content)
        assert body["url"] == "https://example.test/hook"
        assert body["events"] == ["skill_run.completed"]
        return httpx.Response(
            201,
            json=envelope_factory({**SAMPLE, "secret": "whsec_abc"}),
        )

    client, _ = sync_client_factory(handler)
    created = client.webhooks.create(
        {"url": "https://example.test/hook", "events": ["skill_run.completed"]},
    )
    assert created.secret == "whsec_abc"
    assert created.id == "wh_1"


def test_webhooks_update_snake_to_camel(sync_client_factory, envelope_factory):  # type: ignore[no-untyped-def]
    captured: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(json.loads(request.content))
        assert request.method == "PATCH"
        return httpx.Response(200, json=envelope_factory({**SAMPLE, "active": False}))

    client, _ = sync_client_factory(handler)
    updated = client.webhooks.update(
        "wh_1",
        {"active": False, "skill_id": "some-skill", "secret_action": "rotate"},
    )
    assert updated.active is False
    assert captured[0]["skillId"] == "some-skill"
    assert captured[0]["secretAction"] == "rotate"
    assert "skill_id" not in captured[0]


def test_webhooks_delete(sync_client_factory, envelope_factory):  # type: ignore[no-untyped-def]
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "DELETE"
        return httpx.Response(200, json=envelope_factory({"deleted": True}))

    client, _ = sync_client_factory(handler)
    client.webhooks.delete("wh_1")


def test_webhooks_ping(sync_client_factory, envelope_factory):  # type: ignore[no-untyped-def]
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path.endswith("/webhooks/wh_1/ping")
        return httpx.Response(
            200,
            json=envelope_factory({"id": "d_1", "status": "delivered", "httpStatus": 200}),
        )

    client, _ = sync_client_factory(handler)
    result = client.webhooks.ping("wh_1")
    assert result.status == "delivered"
    assert result.http_status == 200


def test_webhooks_rotate_secret(sync_client_factory, envelope_factory):  # type: ignore[no-untyped-def]
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path.endswith("/webhooks/wh_1/rotate-secret")
        return httpx.Response(
            200,
            json=envelope_factory({**SAMPLE, "secret": "whsec_new"}),
        )

    client, _ = sync_client_factory(handler)
    rotated = client.webhooks.rotate_secret("wh_1")
    assert rotated.secret == "whsec_new"


# ─── signature helpers ────────────────────────────────────────────────────


def _make_header(secret: str, ts: int, body: str) -> str:
    sig = hmac.new(secret.encode(), f"{ts}.{body}".encode(), sha256).hexdigest()
    return f"v1,t={ts},sig={sig}"


def test_parse_webhook_signature_header_parses_canonical() -> None:
    parsed = parse_webhook_signature_header("v1,t=1700000000,sig=deadbeef")
    assert parsed is not None
    assert parsed.timestamp == 1_700_000_000
    assert parsed.signature == "deadbeef"


@pytest.mark.parametrize(
    "header",
    [
        None,
        "",
        "t=1,sig=abc",
        "v1,t=not-a-number,sig=abc",
    ],
)
def test_parse_webhook_signature_header_rejects_invalid(header: str | None) -> None:
    assert parse_webhook_signature_header(header) is None


def test_verify_webhook_signature_accepts_valid() -> None:
    secret = "whsec_top_secret"
    ts = 1_700_000_000
    body = '{"event":"skill_run.completed","id":"r_1"}'
    header = _make_header(secret, ts, body)
    assert verify_webhook_signature(secret=secret, body=body, header=header, now=ts + 5)


def test_verify_webhook_signature_rejects_stale() -> None:
    secret = "whsec_stale"
    ts = 1_700_000_000
    body = "payload"
    header = _make_header(secret, ts, body)
    assert not verify_webhook_signature(
        secret=secret,
        body=body,
        header=header,
        now=ts + 10_000,
        tolerance_sec=60,
    )


def test_verify_webhook_signature_rejects_tampered() -> None:
    secret = "whsec_tamper"
    ts = 1_700_000_000
    header = _make_header(secret, ts, "original")
    assert not verify_webhook_signature(
        secret=secret,
        body="tampered",
        header=header,
        now=ts,
    )


def test_verify_webhook_signature_rejects_wrong_secret() -> None:
    ts = 1_700_000_000
    header = _make_header("right", ts, "payload")
    assert not verify_webhook_signature(
        secret="wrong",
        body="payload",
        header=header,
        now=ts,
    )


def test_context_manager_closes_client() -> None:
    with CepageClient(api_url="https://cepage.test/api/v1") as client:
        assert client.api_url == "https://cepage.test/api/v1"
        # Smoke check: resource attribute is created
        assert client.webhooks is not None
