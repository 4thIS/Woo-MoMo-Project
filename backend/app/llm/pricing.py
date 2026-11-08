"""Claude 요금표 (USD, 100만 토큰당). 비용은 기록하지 않고 조회 시 계산한다.

행마다 기록된 모델의 요금으로 센다. 모르는 모델은 Sonnet 요금으로 친다(비용을 낮춰 잡지 않게)."""

# 관리자 사용량 응답의 pricing 필드 — 면접(턴·리포트) 모델 요금. 응답 형태를 바꾸지 않는다
MODEL_PRICING = {
    "model": "claude-sonnet-5-5",
    "inputPerMTok": 2.0,
    "outputPerMTok": 10.0,
    "cacheReadPerMTok": 0.2,
    "cacheWritePerMTok": 2.5,
    "webSearch": 0.01,
}

# 브리핑 요약 모델(spec 2026-11-08). 입력 0.10·출력 0.50(프롬프트 10만 토큰까지),
# 캐시 읽기 0.1배·쓰기(5분) 1.25배 — Anthropic 요금 기준
HAIKU_PRICING = {
    "model": "claude-haiku-5-5",
    "inputPerMTok": 0.10,
    "outputPerMTok": 0.50,
    "cacheReadPerMTok": 0.01,
    "cacheWritePerMTok": 0.125,
    "webSearch": 0.01,
}

PRICING_BY_MODEL = {p["model"]: p for p in (MODEL_PRICING, HAIKU_PRICING)}


def rates_for(model: str | None) -> dict:
    return PRICING_BY_MODEL.get(model or "", MODEL_PRICING)


def cost_usd_raw(
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int,
    cache_write_tokens: int,
    web_searches: int,
    *,
    model: str | None = None,
) -> float:
    """반올림 전 비용. 합계는 이 값을 더한 뒤 한 번만 반올림한다."""
    p = rates_for(model)
    total = (
        input_tokens * p["inputPerMTok"]
        + output_tokens * p["outputPerMTok"]
        + cache_read_tokens * p["cacheReadPerMTok"]
        + cache_write_tokens * p["cacheWritePerMTok"]
    ) / 1_000_000 + web_searches * p["webSearch"]
    return total


def cost_usd(
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int,
    cache_write_tokens: int,
    web_searches: int,
    *,
    model: str | None = None,
) -> float:
    return round(
        cost_usd_raw(
            input_tokens,
            output_tokens,
            cache_read_tokens,
            cache_write_tokens,
            web_searches,
            model=model,
        ),
        4,
    )
