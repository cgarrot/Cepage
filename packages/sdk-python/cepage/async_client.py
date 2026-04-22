"""Asynchronous Cepage client."""

from __future__ import annotations

import asyncio
import builtins
import time
from collections.abc import AsyncIterator
from types import TracebackType
from typing import Any

import httpx

from ._envelope import raise_for_error, unwrap
from ._sse import ParsedFrame
from .client import (
    _TERMINAL_EVENTS,
    DEFAULT_TIMEOUT,
    DEFAULT_WAIT,
    _clean_query,
    _snake_to_camel,
)
from .errors import CepageTimeoutError
from .types import (
    CreateScheduleBody,
    CreateWebhookBody,
    DetectInputsResult,
    SaveAsSkillBody,
    ScheduledSkillRun,
    SkillRun,
    SkillRunEvent,
    UpdateScheduleBody,
    UpdateWebhookBody,
    UserSkill,
    Webhook,
    WebhookPingResult,
    WebhookWithSecret,
    WorkflowSkill,
)


class _AsyncHttpBackend:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self._client = client

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: Any = None,
    ) -> Any:
        response = await self._client.request(
            method,
            path,
            params=_clean_query(params),
            json=json_body if json_body is not None else None,
        )
        raw = response.text
        parsed: Any = None
        if raw:
            try:
                parsed = response.json()
            except ValueError:
                parsed = raw
        if response.is_success:
            return unwrap(parsed)
        raise_for_error(response.status_code, parsed, raw)
        return None  # pragma: no cover

    async def stream_events(self, path: str) -> AsyncIterator[ParsedFrame]:
        async with self._client.stream(
            "GET", path, headers={"accept": "text/event-stream"}
        ) as response:
            if not response.is_success:
                raw = (await response.aread()).decode("utf-8", errors="replace")
                parsed: Any = raw
                try:
                    import json

                    parsed = json.loads(raw) if raw else None
                except Exception:
                    parsed = raw
                raise_for_error(response.status_code, parsed, raw)
            buffer = ""
            async for chunk in response.aiter_bytes():
                buffer += chunk.decode("utf-8", errors="replace")
                while True:
                    idx = buffer.find("\n\n")
                    if idx == -1:
                        break
                    frame = buffer[:idx]
                    buffer = buffer[idx + 2 :]
                    parsed_frame = _parse_frame(frame)
                    if parsed_frame is not None:
                        yield parsed_frame


def _parse_frame(frame: str) -> ParsedFrame | None:
    from ._sse import parse_frame  # local import to avoid re-exporting

    return parse_frame(frame)


class AsyncSkillsResource:
    def __init__(self, backend: _AsyncHttpBackend, runs: AsyncRunsResource) -> None:
        self._http = backend
        self._runs = runs

    async def list(
        self,
        *,
        kind: str | builtins.list[str] | None = None,
    ) -> builtins.list[WorkflowSkill]:
        if isinstance(kind, list):
            kind_q: str | None = ",".join(kind)
        else:
            kind_q = kind
        data = await self._http.request("GET", "/workflow-skills", params={"kind": kind_q})
        items = data.get("skills") if isinstance(data, dict) else data
        items = items or []
        return [WorkflowSkill.from_dict(d) for d in items]

    async def get(self, slug: str) -> WorkflowSkill:
        data = await self._http.request("GET", f"/workflow-skills/{slug}")
        return WorkflowSkill.from_dict(data or {})

    async def list_user_skills(self) -> builtins.list[UserSkill]:
        data = await self._http.request("GET", "/skills")
        items = data if isinstance(data, list) else (data or {}).get("items") or []
        return [UserSkill.from_dict(d) for d in items]

    async def get_user_skill(self, slug: str) -> UserSkill:
        data = await self._http.request("GET", f"/skills/{slug}")
        return UserSkill.from_dict(data or {})

    async def run(
        self,
        slug: str,
        *,
        inputs: dict[str, Any] | None = None,
        triggered_by: str = "sdk",
        idempotency_key: str | None = None,
        correlation_id: str | None = None,
        wait: bool = True,
        timeout: float = DEFAULT_WAIT,
    ) -> SkillRun:
        if not slug:
            raise ValueError("slug is required")
        body: dict[str, Any] = {"inputs": inputs or {}, "triggeredBy": triggered_by}
        if idempotency_key:
            body["idempotencyKey"] = idempotency_key
        if correlation_id:
            body["correlationId"] = correlation_id
        data = await self._http.request("POST", f"/skills/{slug}/runs", json_body=body)
        run = SkillRun.from_dict(data or {})
        if not wait or run.is_terminal:
            return run
        return await self._runs.wait(run.id, timeout=timeout)


class AsyncRunsResource:
    def __init__(self, backend: _AsyncHttpBackend) -> None:
        self._http = backend

    async def list(
        self,
        *,
        skill_id: str | None = None,
        limit: int | None = None,
    ) -> builtins.list[SkillRun]:
        data = await self._http.request(
            "GET",
            "/skill-runs",
            params={"skillId": skill_id, "limit": limit},
        )
        items = data if isinstance(data, list) else (data or {}).get("items") or []
        return [SkillRun.from_dict(d) for d in items]

    async def get(self, run_id: str) -> SkillRun:
        data = await self._http.request("GET", f"/skill-runs/{run_id}")
        return SkillRun.from_dict(data or {})

    async def cancel(self, run_id: str) -> SkillRun:
        data = await self._http.request("POST", f"/skill-runs/{run_id}/cancel")
        return SkillRun.from_dict(data or {})

    async def stream(self, run_id: str) -> AsyncIterator[SkillRunEvent]:
        async for frame in self._http.stream_events(f"/skill-runs/{run_id}/stream"):
            yield SkillRunEvent(type=frame.type, data=frame.data)

    async def wait(self, run_id: str, *, timeout: float = DEFAULT_WAIT) -> SkillRun:
        # We rely on the stream to keep flowing (the server emits SSE
        # lifecycle events + periodic ``: ping`` keep-alives every 15s),
        # so a simple deadline check inside the loop is sufficient and
        # works on all supported Python versions without depending on
        # ``asyncio.timeout`` which is 3.11+.
        deadline = time.monotonic() + max(0.0, timeout)
        try:
            async for event in self.stream(run_id):
                if event.type in _TERMINAL_EVENTS:
                    return await self.get(run_id)
                if time.monotonic() >= deadline:
                    raise CepageTimeoutError(
                        f"Skill run {run_id} exceeded {timeout}s wait budget."
                    )
        except asyncio.TimeoutError as exc:
            raise CepageTimeoutError(
                f"Skill run {run_id} exceeded {timeout}s wait budget."
            ) from exc
        return await self.get(run_id)


class AsyncSchedulesResource:
    def __init__(self, backend: _AsyncHttpBackend) -> None:
        self._http = backend

    async def list(self) -> builtins.list[ScheduledSkillRun]:
        data = await self._http.request("GET", "/scheduled-skill-runs")
        items = data if isinstance(data, list) else (data or {}).get("items") or []
        return [ScheduledSkillRun.from_dict(d) for d in items]

    async def get(self, schedule_id: str) -> ScheduledSkillRun:
        data = await self._http.request("GET", f"/scheduled-skill-runs/{schedule_id}")
        return ScheduledSkillRun.from_dict(data or {})

    async def create(self, body: CreateScheduleBody) -> ScheduledSkillRun:
        data = await self._http.request(
            "POST", "/scheduled-skill-runs", json_body=_snake_to_camel(dict(body))
        )
        return ScheduledSkillRun.from_dict(data or {})

    async def update(self, schedule_id: str, body: UpdateScheduleBody) -> ScheduledSkillRun:
        data = await self._http.request(
            "PATCH",
            f"/scheduled-skill-runs/{schedule_id}",
            json_body=_snake_to_camel(dict(body)),
        )
        return ScheduledSkillRun.from_dict(data or {})

    async def delete(self, schedule_id: str) -> None:
        await self._http.request("DELETE", f"/scheduled-skill-runs/{schedule_id}")

    async def run_now(self, schedule_id: str) -> ScheduledSkillRun:
        data = await self._http.request(
            "POST", f"/scheduled-skill-runs/{schedule_id}/run-now"
        )
        return ScheduledSkillRun.from_dict(data or {})


class AsyncSessionsResource:
    def __init__(self, backend: _AsyncHttpBackend) -> None:
        self._http = backend

    async def detect_inputs(self, session_id: str) -> DetectInputsResult:
        data = await self._http.request("POST", f"/sessions/{session_id}/detect-inputs")
        return DetectInputsResult.from_dict(data or {})

    async def save_as_skill(self, session_id: str, body: SaveAsSkillBody) -> UserSkill:
        data = await self._http.request(
            "POST",
            f"/sessions/{session_id}/save-as-skill",
            json_body=_snake_to_camel(dict(body)),
        )
        return UserSkill.from_dict(data or {})


class AsyncWebhooksResource:
    def __init__(self, backend: _AsyncHttpBackend) -> None:
        self._http = backend

    async def list(self) -> builtins.list[Webhook]:
        data = await self._http.request("GET", "/webhooks")
        items = data if isinstance(data, list) else (data or {}).get("items") or []
        return [Webhook.from_dict(d) for d in items]

    async def get(self, webhook_id: str) -> Webhook:
        data = await self._http.request("GET", f"/webhooks/{webhook_id}")
        return Webhook.from_dict(data or {})

    async def create(self, body: CreateWebhookBody) -> WebhookWithSecret:
        data = await self._http.request(
            "POST", "/webhooks", json_body=_snake_to_camel(dict(body))
        )
        return WebhookWithSecret.from_dict(data or {})

    async def update(self, webhook_id: str, body: UpdateWebhookBody) -> Webhook:
        data = await self._http.request(
            "PATCH",
            f"/webhooks/{webhook_id}",
            json_body=_snake_to_camel(dict(body)),
        )
        if isinstance(data, dict) and "secret" in data:
            return WebhookWithSecret.from_dict(data)
        return Webhook.from_dict(data or {})

    async def delete(self, webhook_id: str) -> None:
        await self._http.request("DELETE", f"/webhooks/{webhook_id}")

    async def ping(self, webhook_id: str) -> WebhookPingResult:
        data = await self._http.request("POST", f"/webhooks/{webhook_id}/ping")
        return WebhookPingResult.from_dict(data or {})

    async def rotate_secret(self, webhook_id: str) -> WebhookWithSecret:
        data = await self._http.request(
            "POST", f"/webhooks/{webhook_id}/rotate-secret"
        )
        return WebhookWithSecret.from_dict(data or {})


class AsyncCepageClient:
    """Asynchronous client for the Cepage HTTP API."""

    def __init__(
        self,
        *,
        api_url: str,
        token: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        httpx_client: httpx.AsyncClient | None = None,
        default_headers: dict[str, str] | None = None,
        user_agent: str = "cepage-python/0.1.0",
    ) -> None:
        if not api_url:
            raise ValueError("api_url is required")
        self.api_url = api_url.rstrip("/")
        headers: dict[str, str] = {
            "accept": "application/json",
            "user-agent": user_agent,
        }
        if token:
            headers["authorization"] = f"Bearer {token}"
        if default_headers:
            headers.update(default_headers)

        self._client = httpx_client or httpx.AsyncClient(
            base_url=self.api_url,
            headers=headers,
            timeout=timeout,
        )
        self._owns_client = httpx_client is None

        backend = _AsyncHttpBackend(self._client)
        self.runs = AsyncRunsResource(backend)
        self.skills = AsyncSkillsResource(backend, self.runs)
        self.schedules = AsyncSchedulesResource(backend)
        self.sessions = AsyncSessionsResource(backend)
        self.webhooks = AsyncWebhooksResource(backend)

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def __aenter__(self) -> AsyncCepageClient:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self.aclose()


