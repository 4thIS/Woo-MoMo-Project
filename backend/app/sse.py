"""SSE 한 이벤트: event 줄 + data 줄(JSON 한 줄) + 빈 줄."""

import json
from typing import Any

# X-Accel-Buffering: nginx가 모아 보내지 않고 바로 흘리게 한다
SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}

# 스트림 맨 앞의 주석 줄. Claude 첫 토큰 전에 바이트를 흘려 Cloudflare 100초 첫 바이트
# 제한을 피한다. SSE 파서(EventSource 등)는 ':'로 시작하는 줄을 무시한다.
PING = ": ping\n\n"


def sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
