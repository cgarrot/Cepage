"""Unit tests for the SSE frame parser."""

from __future__ import annotations

from cepage._sse import parse_frame


def test_parse_simple_event() -> None:
    raw = "event: started\ndata: {\"id\":\"run-1\"}\n"
    frame = parse_frame(raw)
    assert frame is not None
    assert frame.type == "started"
    assert frame.data == {"id": "run-1"}


def test_parse_multiline_data() -> None:
    raw = "event: log\ndata: line-one\ndata: line-two\n"
    frame = parse_frame(raw)
    assert frame is not None
    assert frame.type == "log"
    assert frame.data == "line-one\nline-two"


def test_parse_defaults_to_message_event() -> None:
    raw = "data: hello\n"
    frame = parse_frame(raw)
    assert frame is not None
    assert frame.type == "message"
    assert frame.data == "hello"


def test_parse_ignores_comments_and_returns_none_when_empty() -> None:
    raw = ": just a keep-alive\n"
    assert parse_frame(raw) is None
