"""Tests for the synchronous CepageClient."""

from __future__ import annotations

import json

import httpx
import pytest

from cepage import (
    CepageHTTPError,
    CepageValidationError,
)


def test_skills_list_parses_catalog(sync_client_factory, envelope_factory):  # type: ignore[no-untyped-def]
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path.endswith("/workflow-skills")
        return httpx.Response(
            200,
            json=envelope_factory(
                {
                    "schemaVersion": "1",
                    "generatedAt": "2026-04-21",
                    "skills": [
                        {
                            "id": "foo",
                            "title": "Foo",
                            "summary": "",
                            "version": "1",
                            "kind": "workflow",
                        }
                    ],
                }
            ),
        )

    client, _ = sync_client_factory(handler)
    skills = client.skills.list()
    assert len(skills) == 1
    assert skills[0].id == "foo"


def test_skills_list_forwards_kind_query(sync_client_factory, envelope_factory):  # type: ignore[no-untyped-def]
    seen: list[httpx.URL] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url)
        return httpx.Response(
            200,
            json=envelope_factory(
                {"schemaVersion": "1", "generatedAt": "x", "skills": []}
            ),
        )

    client, _ = sync_client_factory(handler)
    client.skills.list(kind=["workflow_template", "prompt_only"])
    assert "kind=workflow_template%2Cprompt_only" in str(seen[0])


def test_skills_run_no_wait_returns_queued(sync_client_factory, envelope_factory):  # type: ignore[no-untyped-def]
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path.endswith("/skills/foo/runs")
        body = json.loads(request.content)
        assert body["triggeredBy"] == "sdk"
        assert body["inputs"] == {"a": 1}
        return httpx.Response(
            200,
            json=envelope_factory(
                {
                    "id": "run-1",
                    "status": "queued",
                    "skillId": "foo",
                    "inputs": {"a": 1},
                }
            ),
        )

    client, _ = sync_client_factory(handler)
    run = client.skills.run("foo", inputs={"a": 1}, wait=False)
    assert run.status == "queued"


def test_skills_run_waits_via_sse(sync_client_factory, envelope_factory):  # type: ignore[no-untyped-def]
    stream_body = (
        'event: snapshot\ndata: {"id":"run-1","status":"queued"}\n\n'
        'event: started\ndata: {"id":"run-1","status":"running"}\n\n'
        'event: succeeded\ndata: {"id":"run-1","status":"succeeded"}\n\n'
    )

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path.endswith("/skills/foo/runs"):
            return httpx.Response(
                200,
                json=envelope_factory(
                    {
                        "id": "run-1",
                        "status": "queued",
                        "skillId": "foo",
                        "inputs": {},
                    }
                ),
            )
        if "stream" in request.url.path and request.method == "GET":
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
                        "outputs": {"reportMd": "hi"},
                    }
                ),
            )
        return httpx.Response(
            404,
            json={"success": False, "error": {"code": "NOT_FOUND", "message": "x"}},
        )

    client, _ = sync_client_factory(handler)
    run = client.skills.run("foo", inputs={}, timeout=5.0)
    assert run.status == "succeeded"
    assert run.outputs == {"reportMd": "hi"}


def test_4xx_raises_cepage_http_error(sync_client_factory, error_envelope_factory):  # type: ignore[no-untyped-def]
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json=error_envelope_factory("FORBIDDEN", "Cannot run this skill."),
        )

    client, _ = sync_client_factory(handler)
    with pytest.raises(CepageHTTPError) as exc_info:
        client.skills.list()
    assert exc_info.value.status == 403
    assert exc_info.value.code == "FORBIDDEN"


def test_400_invalid_input_raises_validation_error(sync_client_factory, error_envelope_factory):  # type: ignore[no-untyped-def]
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            json=error_envelope_factory(
                "INVALID_INPUT",
                "Input failed validation.",
                errors=[{"path": "/startDate", "message": "required", "keyword": "required"}],
            ),
        )

    client, _ = sync_client_factory(handler)
    with pytest.raises(CepageValidationError) as exc_info:
        client.skills.run("foo", inputs={}, wait=False)
    err = exc_info.value
    assert err.status == 400
    assert len(err.errors) == 1
    assert err.errors[0].path == "/startDate"


def test_schedules_crud(sync_client_factory, envelope_factory):  # type: ignore[no-untyped-def]
    calls: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path))
        if request.method == "POST" and request.url.path.endswith("/scheduled-skill-runs"):
            body = json.loads(request.content)
            assert body["skillId"] == "foo"
            assert body["cron"] == "0 9 * * 1"
            return httpx.Response(
                201,
                json=envelope_factory(
                    {
                        "id": "s1",
                        "skillId": "foo",
                        "cron": "0 9 * * 1",
                        "request": {},
                        "status": "active",
                        "nextRunAt": "2026-04-28",
                    }
                ),
            )
        if request.method == "PATCH":
            return httpx.Response(
                200,
                json=envelope_factory(
                    {
                        "id": "s1",
                        "skillId": "foo",
                        "cron": "0 9 * * 1",
                        "request": {},
                        "status": "paused",
                        "nextRunAt": "x",
                    }
                ),
            )
        if request.method == "DELETE":
            return httpx.Response(200, json=envelope_factory({}))
        if "run-now" in request.url.path:
            return httpx.Response(
                200,
                json=envelope_factory(
                    {
                        "id": "s1",
                        "skillId": "foo",
                        "cron": "0 9 * * 1",
                        "request": {},
                        "status": "active",
                        "nextRunAt": "x",
                    }
                ),
            )
        return httpx.Response(404)

    client, _ = sync_client_factory(handler)
    created = client.schedules.create(
        {"skill_id": "foo", "cron": "0 9 * * 1", "request": {"inputs": {}}},
    )
    assert created.id == "s1"
    updated = client.schedules.update("s1", {"status": "paused"})
    assert updated.status == "paused"
    client.schedules.run_now("s1")
    client.schedules.delete("s1")
    assert [(m, p.split("/")[-1]) for m, p in calls] == [
        ("POST", "scheduled-skill-runs"),
        ("PATCH", "s1"),
        ("POST", "run-now"),
        ("DELETE", "s1"),
    ]


def test_context_manager_closes_owned_httpx_client(sync_client_factory, envelope_factory):  # type: ignore[no-untyped-def]
    # When the SDK owns its httpx.Client, exiting the context manager closes it.
    from cepage import CepageClient

    with CepageClient(api_url="https://cepage.test/api/v1") as client:
        assert client.api_url == "https://cepage.test/api/v1"
    # `close()` is idempotent, so a second close shouldn't raise.
    client.close()
