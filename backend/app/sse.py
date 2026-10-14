"""SSE 한 이벤트: event 줄 + data 줄(JSON 한 줄) + 빈 줄."""

import json
from typing import Any

# X-Accel-Buffering: nginx가 모아 보내지 않고 바로 흘리게 한다
SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
