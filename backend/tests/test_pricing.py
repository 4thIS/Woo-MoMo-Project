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


def test_cost_usd_raw_is_unrounded():
    assert pricing.cost_usd_raw(12_345, 0, 0, 0, 0) == 0.02469


def test_haiku_is_cheaper_than_sonnet_for_the_same_tokens():
    args = (1_000_000, 1_000_000, 1_000_000, 1_000_000, 0)
    haiku = pricing.cost_usd(*args, model="claude-haiku-5-5")
    sonnet = pricing.cost_usd(*args, model="claude-sonnet-5-5")
    assert haiku == round(0.10 + 0.50 + 0.01 + 0.125, 4)
    assert haiku < sonnet == 14.7


def test_unknown_or_missing_model_uses_sonnet_rates():
    args = (12_345, 0, 0, 0, 0)
    assert pricing.cost_usd_raw(*args, model="claude-nope") == pricing.cost_usd_raw(*args)
    assert pricing.cost_usd_raw(*args, model=None) == 0.02469


def test_web_search_fee_is_the_same_for_every_model():
    assert pricing.cost_usd(0, 0, 0, 0, 3, model="claude-haiku-5-5") == 0.03
