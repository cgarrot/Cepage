"""Unit tests for the envelope helpers."""

from __future__ import annotations

import pytest

from cepage import (
    CepageHTTPError,
    CepageValidationError,
)
from cepage._envelope import raise_for_error, unwrap


def test_unwrap_success_data() -> None:
    assert unwrap({"success": True, "data": [1, 2, 3]}) == [1, 2, 3]


def test_unwrap_passthrough_for_non_envelope_payloads() -> None:
    assert unwrap({"foo": "bar"}) == {"foo": "bar"}
    assert unwrap([1, 2]) == [1, 2]
    assert unwrap(None) is None


def test_raise_for_error_returns_http_error() -> None:
    parsed = {"success": False, "error": {"code": "FORBIDDEN", "message": "nope"}}
    with pytest.raises(CepageHTTPError) as exc:
        raise_for_error(403, parsed, "")
    assert exc.value.status == 403
    assert exc.value.code == "FORBIDDEN"


def test_raise_for_error_invalid_input_specialises_to_validation_error() -> None:
    parsed = {
        "success": False,
        "error": {
            "code": "INVALID_INPUT",
            "message": "bad",
            "errors": [{"path": "/startDate", "message": "required", "keyword": "required"}],
        },
    }
    with pytest.raises(CepageValidationError) as exc:
        raise_for_error(400, parsed, "")
    assert exc.value.errors[0].path == "/startDate"


def test_raise_for_error_validation_error_also_reads_details_errors() -> None:
    # Older API revisions nested validation details under `error.details.errors`.
    parsed = {
        "success": False,
        "error": {
            "code": "INVALID_INPUT",
            "message": "bad",
            "details": {"errors": [{"path": "/x", "message": "required"}]},
        },
    }
    with pytest.raises(CepageValidationError) as exc:
        raise_for_error(400, parsed, "")
    assert exc.value.errors[0].path == "/x"


def test_raise_for_error_falls_back_to_raw_body() -> None:
    with pytest.raises(CepageHTTPError) as exc:
        raise_for_error(500, None, "oops")
    assert "500" in str(exc.value)
