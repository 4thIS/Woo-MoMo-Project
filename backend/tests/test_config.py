import pytest

from app.config import DEFAULT_STORAGE_DIR, Settings


def test_defaults_when_env_is_empty():
    s = Settings.from_env({})
    assert s.storage_dir == DEFAULT_STORAGE_DIR
    assert s.cors_origins == (
        "https://momo.ssenu.cloud",
        "https://demomo.ssenu.cloud",
        "http://localhost:5173",
    )
    assert s.cookie_secure is True
    assert s.anthropic_api_key is None
    assert s.admin_login is None
    assert s.admin_password is None
    assert s.ben_daily_limit == 30


def test_reads_every_env_key(tmp_path):
    s = Settings.from_env(
        {
            "DATA_DIR": str(tmp_path),
            "CORS_ORIGINS": "https://a.example, http://localhost:5173/",
            "COOKIE_SECURE": "0",
            "ANTHROPIC_API_KEY": "sk-test",
            "ADMIN_LOGIN": "admin",
            "ADMIN_PASSWORD": " pass with spaces ",
            "BEN_DAILY_LIMIT": "5",
        }
    )
    assert s.storage_dir == tmp_path
    assert s.cors_origins == ("https://a.example", "http://localhost:5173")
    assert s.cookie_secure is False
    assert s.anthropic_api_key == "sk-test"
    assert s.admin_login == "admin"
    assert s.admin_password == " pass with spaces "
    assert s.ben_daily_limit == 5
    assert s.db_path == tmp_path / "momo.sqlite3"
    assert s.recordings_dir == tmp_path / "recordings"


def test_blank_values_fall_back_to_defaults():
    s = Settings.from_env(
        {"ANTHROPIC_API_KEY": "", "ADMIN_LOGIN": "  ", "ADMIN_PASSWORD": "", "CORS_ORIGINS": ""}
    )
    assert s.anthropic_api_key is None
    assert s.admin_login is None
    assert s.admin_password is None
    assert len(s.cors_origins) == 3


def test_wildcard_origin_is_rejected():
    with pytest.raises(ValueError, match="CORS_ORIGINS"):
        Settings.from_env({"CORS_ORIGINS": "*"})


def test_admin_emails_are_normalized_and_deduplicated():
    s = Settings.from_env({"ADMIN_EMAILS": " A@b.com, c@d.com ,,a@b.com"})
    assert s.admin_emails == ("a@b.com", "c@d.com")
    assert Settings.from_env({}).admin_emails == ()
