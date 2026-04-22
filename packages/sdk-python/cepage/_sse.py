"""Tiny, dependency-free SSE frame parser.

The Cepage SSE stream only uses ``event:`` and ``data:`` fields — we
intentionally don't depend on httpx-sse or sseclient because either
would add yet another runtime dependency while providing ~20 lines of
code we can inline here.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any


@dataclass
class ParsedFrame:
    type: str
    data: Any


def frames_from_stream(chunks: Iterator[bytes]) -> Iterator[ParsedFrame]:
    """Yield one ParsedFrame per ``\\n\\n`` delimited SSE block."""
    buffer = ""
    for chunk in chunks:
        if isinstance(chunk, (bytes, bytearray)):
            text = chunk.decode("utf-8", errors="replace")
        else:
            text = str(chunk)
        buffer += text
        while True:
            idx = buffer.find("\n\n")
            if idx == -1:
                break
            frame = buffer[:idx]
            buffer = buffer[idx + 2 :]
            parsed = parse_frame(frame)
            if parsed is not None:
                yield parsed


def parse_frame(frame: str) -> ParsedFrame | None:
    event_type = "message"
    data_lines: list[str] = []
    for raw_line in frame.splitlines():
        line = raw_line.rstrip("\r")
        if not line or line.startswith(":"):
            continue
        if line.startswith("event:"):
            event_type = line[len("event:") :].strip() or "message"
        elif line.startswith("data:"):
            data_lines.append(line[len("data:") :].lstrip())
    if not data_lines:
        return None
    raw_data = "\n".join(data_lines)
    try:
        parsed: Any = json.loads(raw_data)
    except json.JSONDecodeError:
        parsed = raw_data
    return ParsedFrame(type=event_type, data=parsed)
