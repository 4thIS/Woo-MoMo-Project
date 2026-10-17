from app.llm import pricing


def test_cost_usd_sums_every_component():
    assert pricing.cost_usd(1_000_000, 1_000_000, 1_000_000, 1_000_000, 10) == 14.8


def test_cost_usd_zero_and_rounding():
    assert pricing.cost_usd(0, 0, 0, 0, 0) == 0.0
    assert pricing.cost_usd(1, 0, 0, 0, 0) == 0.0
    assert pricing.cost_usd(12_345, 0, 0, 0, 0) == 0.0247


def test_model_pricing_shape():
    assert pricing.MODEL_PRICING["model"] == "claude-sonnet-5-5"
    assert pricing.MODEL_PRICING["webSearch"] == 0.01
