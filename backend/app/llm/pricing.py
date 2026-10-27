"""Claude 요금표 (USD, 100만 토큰당). 비용은 기록하지 않고 조회 시 계산한다."""

MODEL_PRICING = {
    "model": "claude-sonnet-5-5",
    "inputPerMTok": 2.0,
    "outputPerMTok": 10.0,
    "cacheReadPerMTok": 0.2,
    "cacheWritePerMTok": 2.5,
    "webSearch": 0.01,
}


def cost_usd_raw(
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int,
    cache_write_tokens: int,
    web_searches: int,
) -> float:
    """반올림 전 비용. 합계는 이 값을 더한 뒤 한 번만 반올림한다."""
    p = MODEL_PRICING
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
) -> float:
    return round(
        cost_usd_raw(
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, web_searches
        ),
        4,
    )
