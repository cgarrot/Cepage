"""Synchronous Cepage client."""

from __future__ import annotations

import builtins
import time
from collections.abc import Iterator
from types import TracebackType
from typing import Any

import httpx

from ._envelope import raise_for_error, unwrap
from ._sse import ParsedFrame, frames_from_stream
from .errors import CepageTimeoutError
from .types import (
    CreateScheduleBody,
    CreateWebhookBody,
    DetectInputsResult,
    RunSkillOptions,
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

DEFAULT_TIMEOUT = 30.0
DEFAULT_WAIT = 120.0
_TERMINAL_EVENTS = {"succeeded", "failed", "cancelled"}


class _HttpBackend:
    """Wraps an httpx.Client with envelope handling."""

    def __init__(self, client: httpx.Client) -> None:
        self._client = client

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: Any = None,
    ) -> Any:
        response = self._client.request(
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
        # unreachable — raise_for_error always raises
        return None  # pragma: no cover

    def stream_events(self, path: str) -> Iterator[ParsedFrame]:
        with self._client.stream("GET", path, headers={"accept": "text/event-stream"}) as response:
            if not response.is_success:
                raw = response.read().decode("utf-8", errors="replace")
                parsed: Any = raw
                try:
                    import json

                    parsed = json.loads(raw) if raw else None
                except Exception:
                    parsed = raw
                raise_for_error(response.status_code, parsed, raw)
            yield from frames_from_stream(response.iter_bytes())


def _clean_query(params: dict[str, Any] | None) -> dict[str, Any] | None:
    if not params:
        return None
    return {k: v for k, v in params.items() if v is not None}


class SkillsResource:
    def __init__(self, backend: _HttpBackend, runs: RunsResource) -> None:
        self._http = backend
        self._runs = runs

    def list(self, *, kind: str | builtins.list[str] | None = None) -> builtins.list[WorkflowSkill]:
        kind_q: str | None
        kind_q = ",".join(kind) if isinstance(kind, list) else kind
        data = self._http.request("GET", "/workflow-skills", params={"kind": kind_q})
        items = data.get("skills") if isinstance(data, dict) else data
        items = items or []
        return [WorkflowSkill.from_dict(d) for d in items]

    def get(self, slug: str) -> WorkflowSkill:
        data = self._http.request("GET", f"/workflow-skills/{slug}")
        return WorkflowSkill.from_dict(data or {})

    def list_user_skills(self) -> builtins.list[UserSkill]:
        data = self._http.request("GET", "/skills")
        items = data if isinstance(data, list) else (data or {}).get("items") or []
        return [UserSkill.from_dict(d) for d in items]

    def get_user_skill(self, slug: str) -> UserSkill:
        data = self._http.request("GET", f"/skills/{slug}")
        return UserSkill.from_dict(data or {})

    def run(
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
        body: dict[str, Any] = {
            "inputs": inputs or {},
            "triggeredBy": triggered_by,
        }
        if idempotency_key:
            body["idempotencyKey"] = idempotency_key
        if correlation_id:
            body["correlationId"] = correlation_id

        data = self._http.request("POST", f"/skills/{slug}/runs", json_body=body)
        run = SkillRun.from_dict(data or {})
        if not wait or run.is_terminal:
            return run
        return self._runs.wait(run.id, timeout=timeout)

    # Type-hint-only accessor so callers can do ``client.skills.run_with_options(...)``
    # when they already have a RunSkillOptions dict from elsewhere.
    def run_with_options(self, slug: str, options: RunSkillOptions) -> SkillRun:
        return self.run(
            slug,
            inputs=options.get("inputs") or {},
            triggered_by=options.get("triggered_by", "sdk"),
            idempotency_key=options.get("idempotency_key"),
            correlation_id=options.get("correlation_id"),
            wait=options.get("wait", True),
            timeout=options.get("timeout", DEFAULT_WAIT),
        )


class RunsResource:
    def __init__(self, backend: _HttpBackend) -> None:
        self._http = backend

    def list(
        self,
        *,
        skill_id: str | None = None,
        limit: int | None = None,
    ) -> builtins.list[SkillRun]:
        data = self._http.request(
            "GET",
            "/skill-runs",
            params={"skillId": skill_id, "limit": limit},
        )
        items = data if isinstance(data, list) else (data or {}).get("items") or []
        return [SkillRun.from_dict(d) for d in items]

    def get(self, run_id: str) -> SkillRun:
        data = self._http.request("GET", f"/skill-runs/{run_id}")
        return SkillRun.from_dict(data or {})

    def cancel(self, run_id: str) -> SkillRun:
        data = self._http.request("POST", f"/skill-runs/{run_id}/cancel")
        return SkillRun.from_dict(data or {})

    def stream(self, run_id: str) -> Iterator[SkillRunEvent]:
        for frame in self._http.stream_events(f"/skill-runs/{run_id}/stream"):
            yield SkillRunEvent(type=frame.type, data=frame.data)

    def wait(self, run_id: str, *, timeout: float = DEFAULT_WAIT) -> SkillRun:
        deadline = time.monotonic() + max(0.0, timeout)
        for event in self.stream(run_id):
            if event.type in _TERMINAL_EVENTS:
                return self.get(run_id)
            if time.monotonic() >= deadline:
                raise CepageTimeoutError(
                    f"Skill run {run_id} exceeded {timeout}s wait budget."
                )
        return self.get(run_id)


class SchedulesResource:
    def __init__(self, backend: _HttpBackend) -> None:
        self._http = backend

    def list(self) -> builtins.list[ScheduledSkillRun]:
        data = self._http.request("GET", "/scheduled-skill-runs")
        items = data if isinstance(data, list) else (data or {}).get("items") or []
        return [ScheduledSkillRun.from_dict(d) for d in items]

    def get(self, schedule_id: str) -> ScheduledSkillRun:
        data = self._http.request("GET", f"/scheduled-skill-runs/{schedule_id}")
        return ScheduledSkillRun.from_dict(data or {})

    def create(self, body: CreateScheduleBody) -> ScheduledSkillRun:
        data = self._http.request(
            "POST", "/scheduled-skill-runs", json_body=_snake_to_camel(dict(body))
        )
        return ScheduledSkillRun.from_dict(data or {})

    def update(self, schedule_id: str, body: UpdateScheduleBody) -> ScheduledSkillRun:
        data = self._http.request(
            "PATCH",
            f"/scheduled-skill-runs/{schedule_id}",
            json_body=_snake_to_camel(dict(body)),
        )
        return ScheduledSkillRun.from_dict(data or {})

    def delete(self, schedule_id: str) -> None:
        self._http.request("DELETE", f"/scheduled-skill-runs/{schedule_id}")

    def run_now(self, schedule_id: str) -> ScheduledSkillRun:
        data = self._http.request(
            "POST", f"/scheduled-skill-runs/{schedule_id}/run-now"
        )
        return ScheduledSkillRun.from_dict(data or {})


class SessionsResource:
    def __init__(self, backend: _HttpBackend) -> None:
        self._http = backend

    def detect_inputs(self, session_id: str) -> DetectInputsResult:
        data = self._http.request("POST", f"/sessions/{session_id}/detect-inputs")
        return DetectInputsResult.from_dict(data or {})

    def save_as_skill(self, session_id: str, body: SaveAsSkillBody) -> UserSkill:
        data = self._http.request(
            "POST",
            f"/sessions/{session_id}/save-as-skill",
            json_body=_snake_to_camel(dict(body)),
        )
        return UserSkill.from_dict(data or {})


class WebhooksResource:
    """CRUD + management for outbound webhook subscriptions.

    ``create`` and ``rotate_secret`` return :class:`WebhookWithSecret`;
    the secret is only exposed on these two calls and cannot be
    recovered afterwards. All other methods return :class:`Webhook`.
    """

    def __init__(self, backend: _HttpBackend) -> None:
        self._http = backend

    def list(self) -> builtins.list[Webhook]:
        data = self._http.request("GET", "/webhooks")
        items = data if isinstance(data, list) else (data or {}).get("items") or []
        return [Webhook.from_dict(d) for d in items]

    def get(self, webhook_id: str) -> Webhook:
        data = self._http.request("GET", f"/webhooks/{webhook_id}")
        return Webhook.from_dict(data or {})

    def create(self, body: CreateWebhookBody) -> WebhookWithSecret:
        data = self._http.request(
            "POST", "/webhooks", json_body=_snake_to_camel(dict(body))
        )
        return WebhookWithSecret.from_dict(data or {})

    def update(self, webhook_id: str, body: UpdateWebhookBody) -> Webhook:
        data = self._http.request(
            "PATCH",
            f"/webhooks/{webhook_id}",
            json_body=_snake_to_camel(dict(body)),
        )
        if isinstance(data, dict) and "secret" in data:
            return WebhookWithSecret.from_dict(data)
        return Webhook.from_dict(data or {})

    def delete(self, webhook_id: str) -> None:
        self._http.request("DELETE", f"/webhooks/{webhook_id}")

    def ping(self, webhook_id: str) -> WebhookPingResult:
        data = self._http.request("POST", f"/webhooks/{webhook_id}/ping")
        return WebhookPingResult.from_dict(data or {})

    def rotate_secret(self, webhook_id: str) -> WebhookWithSecret:
        data = self._http.request(
            "POST", f"/webhooks/{webhook_id}/rotate-secret"
        )
        return WebhookWithSecret.from_dict(data or {})


class CepageClient:
    """Synchronous client for the Cepage HTTP API."""

    def __init__(
        self,
        *,
        api_url: str,
        token: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        httpx_client: httpx.Client | None = None,
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

        self._client = httpx_client or httpx.Client(
            base_url=self.api_url,
            headers=headers,
            timeout=timeout,
        )
        self._owns_client = httpx_client is None

        backend = _HttpBackend(self._client)
        self.runs = RunsResource(backend)
        self.skills = SkillsResource(backend, self.runs)
        self.schedules = SchedulesResource(backend)
        self.sessions = SessionsResource(backend)
        self.webhooks = WebhooksResource(backend)

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> CepageClient:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()


def _snake_to_camel(body: dict[str, Any]) -> dict[str, Any]:
    """Convert snake_case keys used by Pythonic TypedDicts into camelCase."""
    out: dict[str, Any] = {}
    for key, value in body.items():
        camel = _to_camel(key)
        out[camel] = value
    return out


def _to_camel(key: str) -> str:
    if "_" not in key:
        return key
    parts = key.split("_")
    return parts[0] + "".join(word.capitalize() for word in parts[1:] if word)
