"""Helpers to parse the Cepage API success/error envelope.

All Cepage HTTP responses are wrapped as ``{"success": bool, "data": ...}``
on success or ``{"success": false, "error": {code, message, ...}}`` on
failure (see ``packages/shared-core/src/api.ts``). We centralise that
shape here so both the sync and async clients stay in lock-step.
"""

from __future__ import annotations

from typing import Any

from .errors import (
    CepageHTTPError,
    CepageValidationError,
    ValidationErrorDetail,
)


def unwrap(parsed: Any) -> Any:
    """Return ``data`` from a success envelope, or the payload unchanged."""
    if isinstance(parsed, dict) and parsed.get("success") is True and "data" in parsed:
        return parsed["data"]
    return parsed


def raise_for_error(status: int, parsed: Any, raw: str) -> None:
    """Raise a typed SDK error from a non-2xx response body."""
    body: dict[str, Any] | str | None = parsed if isinstance(parsed, dict) else raw

    error_obj: dict[str, Any] = {}
    if isinstance(parsed, dict):
        if parsed.get("success") is False and isinstance(parsed.get("error"), dict):
            error_obj = dict(parsed["error"])
        else:
            allowed = {"code", "message", "errors", "details"}
            error_obj = {k: v for k, v in parsed.items() if k in allowed}

    code: str | None = error_obj.get("code")
    message: str = str(error_obj.get("message") or f"HTTP {status}")
    errors_raw: list[dict[str, Any]] | None = _extract_errors(error_obj)

    if status == 400 and code == "INVALID_INPUT":
        detail_list = [
            ValidationErrorDetail(
                path=str(e.get("path", "")),
                message=str(e.get("message", "")),
                keyword=e.get("keyword"),
                params=dict(e.get("params", {}) or {}),
            )
            for e in (errors_raw or [])
        ]
        raise CepageValidationError(
            status=status,
            message=message,
            body=parsed if isinstance(parsed, dict) else {"raw": raw},
            errors=detail_list,
        )

    raise CepageHTTPError(status=status, message=message, body=body, code=code)


def _extract_errors(error_obj: dict[str, Any]) -> list[dict[str, Any]] | None:
    """Both ``{errors: [...]}`` and ``{details: {errors: [...]}}`` are possible shapes."""
    if isinstance(error_obj.get("errors"), list):
        return list(error_obj["errors"])
    details = error_obj.get("details")
    if isinstance(details, dict) and isinstance(details.get("errors"), list):
        return list(details["errors"])
    return None
