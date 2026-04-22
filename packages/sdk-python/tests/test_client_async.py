"""Tests for the asynchronous AsyncCepageClient."""

from __future__ import annotations

import json

import httpx
import pytest

from cepage import CepageValidationError

pytestmark = pytest.mark.asyncio


async def test_async_skills_list(async_client_factory, envelope_factory):  # type: ignore[no-untyped-def]
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=envelope_factory(
                {
                    "schemaVersion": "1",
                    "generatedAt": "x",
                    "skills": [
                        {"id": "a", "title": "A", "summary": "", "version": "1", "kind": "workflow"}
                    ],
                }
            ),
        )

    client, _ = async_client_factory(handler)
    try:
        skills = await client.skills.list()
        assert len(skills) == 1
        assert skills[0].id == "a"
    finally:
        await client.aclose()


async def test_async_run_no_wait(async_client_factory, envelope_factory):  # type: ignore[no-untyped-def]
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        body = json.loads(request.content)
        assert body["triggeredBy"] == "sdk"
        return httpx.Response(
            200,
            json=envelope_factory(
                {"id": "run-1", "status": "queued", "skillId": "foo", "inputs": {}}
            ),
        )

    client, _ = async_client_factory(handler)
    try:
        run = await client.skills.run("foo", inputs={}, wait=False)
        assert run.status == "queued"
    finally:
        await client.aclose()


async def test_async_run_waits_for_terminal_sse(async_client_factory, envelope_factory):  # type: ignore[no-untyped-def]
    stream_body = (
        'event: snapshot\ndata: {"id":"run-1","status":"queued"}\n\n'
        'event: succeeded\ndata: {"id":"run-1","status":"succeeded"}\n\n'
    )

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path.endswith("/skills/foo/runs"):
            return httpx.Response(
                200,
                json=envelope_factory(
                    {"id": "run-1", "status": "queued", "skillId": "foo", "inputs": {}}
                ),
            )
        if "stream" in request.url.path:
            return httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                content=stream_body.encode(),
            )
        if request.url.path.endswith("/skill-runs/run-1"):
            return httpx.Response(
                200,
                json=envelope_factory(
                    {
                        "id": "run-1",
                        "status": "succeeded",
                        "skillId": "foo",
                        "inputs": {},
                        "outputs": {"reportMd": "ok"},
                    }
                ),
            )
        return httpx.Response(404)

    client, _ = async_client_factory(handler)
    try:
        run = await client.skills.run("foo", inputs={}, timeout=5.0)
        assert run.status == "succeeded"
        assert run.outputs == {"reportMd": "ok"}
    finally:
        await client.aclose()


async def test_async_validation_error(async_client_factory, error_envelope_factory):  # type: ignore[no-untyped-def]
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            json=error_envelope_factory(
                "INVALID_INPUT",
                "bad",
                errors=[{"path": "/startDate", "message": "required"}],
            ),
        )

    client, _ = async_client_factory(handler)
    try:
        with pytest.raises(CepageValidationError) as exc_info:
            await client.skills.run("foo", inputs={}, wait=False)
        assert exc_info.value.errors[0].path == "/startDate"
    finally:
        await client.aclose()


async def test_async_webhooks_crud(async_client_factory, envelope_factory):  # type: ignore[no-untyped-def]
    calls: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path))
        sample = {
            "id": "wh_1",
            "url": "https://example.test/hook",
            "events": ["*"],
            "skillId": None,
            "active": True,
            "description": None,
            "createdAt": "t",
            "updatedAt": "t",
        }
        if request.method == "POST" and request.url.path.endswith("/webhooks"):
            return httpx.Response(
                201,
                json=envelope_factory({**sample, "secret": "whsec_ok"}),
            )
        if request.method == "POST" and request.url.path.endswith("/ping"):
            return httpx.Response(
                200,
                json=envelope_factory(
                    {"id": "d_1", "status": "delivered", "httpStatus": 202}
                ),
            )
        if request.method == "DELETE":
            return httpx.Response(200, json=envelope_factory({"deleted": True}))
        if request.method == "GET":
            return httpx.Response(200, json=envelope_factory([sample]))
        return httpx.Response(404)

    client, _ = async_client_factory(handler)
    try:
        created = await client.webhooks.create(
            {"url": "https://example.test/hook", "events": ["*"]},
        )
        assert created.secret == "whsec_ok"
        items = await client.webhooks.list()
        assert len(items) == 1
        ping = await client.webhooks.ping("wh_1")
        assert ping.http_status == 202
        await client.webhooks.delete("wh_1")
    finally:
        await client.aclose()

    methods = [m for m, _ in calls]
    assert methods == ["POST", "GET", "POST", "DELETE"]
