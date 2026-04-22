"""Shared pytest fixtures for the Cepage Python SDK tests."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import httpx
import pytest


def envelope(data: Any) -> dict[str, Any]:
    return {"success": True, "data": data}


def error_envelope(code: str, message: str, **extra: Any) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    error.update(extra)
    return {"success": False, "error": error}


@pytest.fixture
def envelope_factory():
    return envelope


@pytest.fixture
def error_envelope_factory():
    return error_envelope


def make_stream(frames: Iterable[str]) -> httpx.ByteStream:
    body = "".join(frames).encode("utf-8")

    class _Stream(httpx.ByteStream):
        def __init__(self) -> None:
            super().__init__(body)

    return _Stream()


@pytest.fixture
def make_sse():
    def _maker(frames: Iterable[dict[str, Any]]) -> httpx.ByteStream:
        import json

        text = "".join(
            f"event: {f['type']}\ndata: {json.dumps(f.get('data'))}\n\n" for f in frames
        )
        return make_stream([text])

    return _maker


class MockTransport(httpx.MockTransport):
    """Wraps httpx.MockTransport so tests can inspect recorded requests."""

    def __init__(self, handler):  # type: ignore[no-untyped-def]
        self.recorded: list[httpx.Request] = []

        def _handler(request: httpx.Request) -> httpx.Response:
            self.recorded.append(request)
            return handler(request)

        super().__init__(_handler)


@pytest.fixture
def recording_transport():
    def _build(handler):  # type: ignore[no-untyped-def]
        return MockTransport(handler)

    return _build


@pytest.fixture
def sync_client_factory(recording_transport):  # type: ignore[no-untyped-def]
    """Factory that spins up a CepageClient backed by a MockTransport."""

    from cepage import CepageClient

    def _build(handler) -> tuple[CepageClient, MockTransport]:  # type: ignore[no-untyped-def]
        transport = recording_transport(handler)
        httpx_client = httpx.Client(
            transport=transport,
            base_url="https://cepage.test/api/v1",
            headers={
                "accept": "application/json",
                "user-agent": "cepage-python/test",
            },
        )
        client = CepageClient(api_url="https://cepage.test/api/v1", httpx_client=httpx_client)
        return client, transport

    return _build


@pytest.fixture
def async_client_factory(recording_transport):  # type: ignore[no-untyped-def]
    from cepage import AsyncCepageClient

    def _build(handler):  # type: ignore[no-untyped-def]
        transport = recording_transport(handler)
        httpx_client = httpx.AsyncClient(
            transport=transport,
            base_url="https://cepage.test/api/v1",
            headers={
                "accept": "application/json",
                "user-agent": "cepage-python/test",
            },
        )
        return (
            AsyncCepageClient(
                api_url="https://cepage.test/api/v1",
                httpx_client=httpx_client,
            ),
            transport,
        )

    return _build
