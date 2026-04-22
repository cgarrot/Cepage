"""Cepage Python SDK.

Thin, typed client for the Cepage HTTP API. Mirrors the TypeScript SDK
surface (`@cepage/sdk`) so code reviewers and docs can keep a single
mental model.

Basic usage::

    from cepage import CepageClient

    with CepageClient(api_url="http://localhost:31947/api/v1") as cepage:
        run = cepage.skills.run(
            "weekly-stripe-report",
            inputs={"startDate": "2026-04-14", "endDate": "2026-04-21"},
        )
        print(run.status, run.outputs)

Async usage::

    from cepage import AsyncCepageClient

    async with AsyncCepageClient(api_url="...") as cepage:
        run = await cepage.skills.run("foo", inputs={...})
"""

from .async_client import AsyncCepageClient
from .client import CepageClient
from .errors import (
    CepageError,
    CepageHTTPError,
    CepageTimeoutError,
    CepageValidationError,
    ValidationErrorDetail,
)
from .signature import (
    ParsedSignature,
    parse_webhook_signature_header,
    verify_webhook_signature,
)
from .types import (
    CreateScheduleBody,
    CreateWebhookBody,
    DetectInputsResult,
    RunSkillOptions,
    SaveAsSkillBody,
    ScheduledSkillRun,
    SkillRun,
    SkillRunError,
    SkillRunEvent,
    SkillRunStatus,
    SkillRunTrigger,
    UpdateScheduleBody,
    UpdateWebhookBody,
    UserSkill,
    Webhook,
    WebhookEventName,
    WebhookPingResult,
    WebhookWithSecret,
    WorkflowSkill,
)

__all__ = [
    "AsyncCepageClient",
    "CepageClient",
    "CepageError",
    "CepageHTTPError",
    "CepageTimeoutError",
    "CepageValidationError",
    "ValidationErrorDetail",
    "CreateScheduleBody",
    "CreateWebhookBody",
    "DetectInputsResult",
    "ParsedSignature",
    "RunSkillOptions",
    "SaveAsSkillBody",
    "ScheduledSkillRun",
    "SkillRun",
    "SkillRunError",
    "SkillRunEvent",
    "SkillRunStatus",
    "SkillRunTrigger",
    "UpdateScheduleBody",
    "UpdateWebhookBody",
    "UserSkill",
    "Webhook",
    "WebhookEventName",
    "WebhookPingResult",
    "WebhookWithSecret",
    "WorkflowSkill",
    "parse_webhook_signature_header",
    "verify_webhook_signature",
]

__version__ = "0.1.0"
