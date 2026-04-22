"""Public types exposed by the Cepage Python SDK.

These mirror the OpenAPI component schemas served at
``/api/v1/openapi.json`` and the TypeScript types in ``@cepage/sdk``.
They're hand-rolled dataclasses rather than generated pydantic models
so the SDK can stay pydantic-free (and therefore lightweight and
pydantic-v1/v2 compatible).
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import Any, Literal

if sys.version_info >= (3, 11):
    from typing import NotRequired, TypedDict
else:
    from typing_extensions import NotRequired, TypedDict

SkillRunStatus = Literal[
    "queued", "running", "succeeded", "failed", "cancelled"
]
SkillRunTrigger = Literal[
    "api", "ui", "cli", "mcp", "schedule", "webhook", "sdk"
]
SkillVisibility = Literal["private", "workspace", "public"]
ScheduleStatus = Literal["active", "paused"]


@dataclass
class WorkflowSkill:
    """A skill as served by ``GET /workflow-skills``.

    Fields that aren't guaranteed by the catalog are optional; this keeps
    the dataclass forward-compatible with future catalog additions.
    """

    id: str
    title: str
    summary: str
    version: str
    kind: str
    tags: list[str] = field(default_factory=list)
    category: str | None = None
    icon: str | None = None
    inputs_schema: dict[str, Any] | None = None
    outputs_schema: dict[str, Any] | None = None
    execution: dict[str, Any] | None = None
    source: dict[str, Any] | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> WorkflowSkill:
        return cls(
            id=str(data.get("id", "")),
            title=str(data.get("title", "")),
            summary=str(data.get("summary", "")),
            version=str(data.get("version", "")),
            kind=str(data.get("kind", "")),
            tags=list(data.get("tags", []) or []),
            category=data.get("category"),
            icon=data.get("icon"),
            inputs_schema=data.get("inputsSchema"),
            outputs_schema=data.get("outputsSchema"),
            execution=data.get("execution"),
            source=data.get("source"),
            raw=data,
        )


@dataclass
class UserSkill:
    id: str
    slug: str
    version: str
    title: str
    summary: str
    tags: list[str] = field(default_factory=list)
    kind: str = "workflow_template"
    category: str | None = None
    icon: str | None = None
    inputs_schema: dict[str, Any] = field(default_factory=dict)
    outputs_schema: dict[str, Any] = field(default_factory=dict)
    prompt_text: str | None = None
    source_session_id: str | None = None
    visibility: SkillVisibility = "private"
    created_at: str | None = None
    updated_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> UserSkill:
        return cls(
            id=str(data.get("id", "")),
            slug=str(data.get("slug", "")),
            version=str(data.get("version", "1.0.0")),
            title=str(data.get("title", "")),
            summary=str(data.get("summary", "")),
            tags=list(data.get("tags", []) or []),
            kind=str(data.get("kind", "workflow_template")),
            category=data.get("category"),
            icon=data.get("icon"),
            inputs_schema=dict(data.get("inputsSchema", {}) or {}),
            outputs_schema=dict(data.get("outputsSchema", {}) or {}),
            prompt_text=data.get("promptText"),
            source_session_id=data.get("sourceSessionId"),
            visibility=data.get("visibility", "private"),
            created_at=data.get("createdAt"),
            updated_at=data.get("updatedAt"),
            raw=data,
        )


@dataclass
class SkillRunError:
    code: str
    message: str
    details: Any | None = None


@dataclass
class SkillRun:
    id: str
    skill_id: str
    status: SkillRunStatus
    inputs: dict[str, Any]
    outputs: dict[str, Any] | None = None
    error: SkillRunError | None = None
    skill_version: str | None = None
    skill_kind: str | None = None
    user_skill_id: str | None = None
    session_id: str | None = None
    triggered_by: str | None = None
    idempotency_key: str | None = None
    correlation_id: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    duration_ms: int | None = None
    created_at: str | None = None
    updated_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def is_terminal(self) -> bool:
        return self.status in ("succeeded", "failed", "cancelled")

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SkillRun:
        error_data = data.get("error")
        err_obj: SkillRunError | None = None
        if isinstance(error_data, dict):
            err_obj = SkillRunError(
                code=str(error_data.get("code", "ERROR")),
                message=str(error_data.get("message", "")),
                details=error_data.get("details"),
            )
        return cls(
            id=str(data.get("id", "")),
            skill_id=str(data.get("skillId", "")),
            status=data.get("status", "queued"),
            inputs=dict(data.get("inputs", {}) or {}),
            outputs=data.get("outputs"),
            error=err_obj,
            skill_version=data.get("skillVersion"),
            skill_kind=data.get("skillKind"),
            user_skill_id=data.get("userSkillId"),
            session_id=data.get("sessionId"),
            triggered_by=data.get("triggeredBy"),
            idempotency_key=data.get("idempotencyKey"),
            correlation_id=data.get("correlationId"),
            started_at=data.get("startedAt"),
            finished_at=data.get("finishedAt"),
            duration_ms=data.get("durationMs"),
            created_at=data.get("createdAt"),
            updated_at=data.get("updatedAt"),
            raw=data,
        )


@dataclass
class ScheduledSkillRun:
    id: str
    skill_id: str
    cron: str
    request: dict[str, Any]
    status: ScheduleStatus
    next_run_at: str
    label: str | None = None
    last_run_at: str | None = None
    last_session_id: str | None = None
    last_error: str | None = None
    metadata: dict[str, Any] | None = None
    created_at: str | None = None
    updated_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ScheduledSkillRun:
        return cls(
            id=str(data.get("id", "")),
            skill_id=str(data.get("skillId", "")),
            cron=str(data.get("cron", "")),
            request=dict(data.get("request", {}) or {}),
            status=data.get("status", "active"),
            next_run_at=str(data.get("nextRunAt", "")),
            label=data.get("label"),
            last_run_at=data.get("lastRunAt"),
            last_session_id=data.get("lastSessionId"),
            last_error=data.get("lastError"),
            metadata=data.get("metadata"),
            created_at=data.get("createdAt"),
            updated_at=data.get("updatedAt"),
            raw=data,
        )


@dataclass
class DetectedInput:
    name: str
    occurrences: int
    inferred_type: str
    hint: str | None = None


@dataclass
class DetectInputsResult:
    session_id: str
    detected: list[DetectedInput]
    inputs_schema: dict[str, Any]
    outputs_schema: dict[str, Any]
    prompt_text: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DetectInputsResult:
        detected = [
            DetectedInput(
                name=str(d.get("name", "")),
                occurrences=int(d.get("occurrences", 0)),
                inferred_type=str(d.get("inferredType", "string")),
                hint=d.get("hint"),
            )
            for d in (data.get("detected") or [])
        ]
        return cls(
            session_id=str(data.get("sessionId", "")),
            detected=detected,
            inputs_schema=dict(data.get("inputsSchema", {}) or {}),
            outputs_schema=dict(data.get("outputsSchema", {}) or {}),
            prompt_text=data.get("promptText"),
        )


@dataclass
class SkillRunEvent:
    type: str
    data: Any


# TypedDicts for loosely-shaped request bodies. We keep these permissive
# so callers can pass arbitrary JSON Schemas without a second dataclass
# indirection.


class RunSkillOptions(TypedDict, total=False):
    inputs: dict[str, Any]
    triggered_by: SkillRunTrigger
    idempotency_key: str
    correlation_id: str
    wait: bool
    timeout: float  # seconds


class CreateScheduleBody(TypedDict, total=False):
    label: NotRequired[str]
    skill_id: str
    cron: str
    request: dict[str, Any]
    status: NotRequired[ScheduleStatus]
    metadata: NotRequired[dict[str, Any] | None]


class UpdateScheduleBody(TypedDict, total=False):
    label: NotRequired[str]
    cron: NotRequired[str]
    request: NotRequired[dict[str, Any]]
    status: NotRequired[ScheduleStatus]
    metadata: NotRequired[dict[str, Any] | None]


class SaveAsSkillBody(TypedDict, total=False):
    slug: NotRequired[str]
    title: str
    summary: str
    icon: NotRequired[str]
    category: NotRequired[str]
    tags: NotRequired[list[str]]
    inputs_schema: NotRequired[dict[str, Any]]
    outputs_schema: NotRequired[dict[str, Any]]
    visibility: NotRequired[SkillVisibility]


# ─── webhooks ────────────────────────────────────────────────────────────

WebhookEventName = Literal[
    "skill_run.created",
    "skill_run.started",
    "skill_run.progress",
    "skill_run.completed",
    "skill_run.failed",
    "skill_run.cancelled",
    "webhook.ping",
    "*",
]


@dataclass
class Webhook:
    """An outbound webhook subscription (without the plaintext secret)."""

    id: str
    url: str
    events: list[str] = field(default_factory=list)
    skill_id: str | None = None
    active: bool = True
    description: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Webhook:
        return cls(
            id=str(data.get("id", "")),
            url=str(data.get("url", "")),
            events=list(data.get("events", []) or []),
            skill_id=data.get("skillId"),
            active=bool(data.get("active", True)),
            description=data.get("description"),
            created_at=data.get("createdAt"),
            updated_at=data.get("updatedAt"),
            raw=data,
        )


@dataclass
class WebhookWithSecret(Webhook):
    """A webhook subscription as returned by ``create``/``rotateSecret``.

    The plaintext ``secret`` is only surfaced on those two calls; treat
    it as a one-time reveal and persist it immediately.
    """

    secret: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> WebhookWithSecret:
        base = Webhook.from_dict(data)
        return cls(
            id=base.id,
            url=base.url,
            events=base.events,
            skill_id=base.skill_id,
            active=base.active,
            description=base.description,
            created_at=base.created_at,
            updated_at=base.updated_at,
            raw=base.raw,
            secret=str(data.get("secret", "")),
        )


@dataclass
class WebhookPingResult:
    id: str
    status: Literal["delivered", "failed"]
    http_status: int | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> WebhookPingResult:
        return cls(
            id=str(data.get("id", "")),
            status=data.get("status", "failed"),
            http_status=data.get("httpStatus"),
        )


class CreateWebhookBody(TypedDict, total=False):
    url: str
    events: NotRequired[list[str]]
    skill_id: NotRequired[str | None]
    active: NotRequired[bool]
    description: NotRequired[str]
    secret: NotRequired[str]


class UpdateWebhookBody(TypedDict, total=False):
    url: NotRequired[str]
    events: NotRequired[list[str]]
    skill_id: NotRequired[str | None]
    active: NotRequired[bool]
    description: NotRequired[str | None]
    secret_action: NotRequired[Literal["rotate"]]
