"""Error classes for the Cepage SDK."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ValidationErrorDetail:
    """A single AJV-style validation error entry."""

    path: str
    message: str
    keyword: str | None = None
    params: dict[str, Any] = field(default_factory=dict)


class CepageError(Exception):
    """Base class for every SDK error."""


class CepageHTTPError(CepageError):
    """Raised when the Cepage API returns a non-2xx response.

    The original payload (typically `{"success": false, "error": {...}}`)
    is available as ``body`` for fine-grained inspection.
    """

    def __init__(
        self,
        status: int,
        message: str,
        body: dict[str, Any] | str | None = None,
        code: str | None = None,
    ) -> None:
        super().__init__(f"[{status}] {message}")
        self.status = status
        self.message = message
        self.body = body
        self.code = code


class CepageValidationError(CepageHTTPError):
    """Raised when the API rejects inputs with ``code: INVALID_INPUT``."""

    def __init__(
        self,
        status: int,
        message: str,
        body: dict[str, Any],
        errors: list[ValidationErrorDetail] | None = None,
    ) -> None:
        super().__init__(status, message, body=body, code="INVALID_INPUT")
        self.errors: list[ValidationErrorDetail] = errors or []


class CepageTimeoutError(CepageError):
    """Raised when a run exceeds the SDK wait budget."""
