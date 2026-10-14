import pytest

from app.ids import CROCKFORD, new_id, ulid


def test_ulid_is_26_crockford_chars():
    value = ulid()
    assert len(value) == 26
    assert set(value) <= set(CROCKFORD)


def test_ulid_sorts_by_time():
    assert ulid(1_000)[:10] < ulid(2_000)[:10]
    assert ulid(2_000) < ulid(3_000)


def test_new_id_uses_known_prefixes():
    for prefix in ("u", "r", "a", "rec", "pi"):
        value = new_id(prefix)
        assert value.startswith(prefix + "_")
        assert len(value) == len(prefix) + 1 + 26


def test_new_id_rejects_unknown_prefix():
    with pytest.raises(ValueError):
        new_id("x")


def test_ids_are_unique():
    assert len({new_id("u") for _ in range(1000)}) == 1000
