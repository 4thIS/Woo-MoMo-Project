from dataclasses import replace
from types import SimpleNamespace

import anthropic
import pytest

from app.llm.claude import FALLBACK_BETA, MODEL, AnthropicClaude, ClaudeError
from app.main import create_app

SYSTEM = [
    {"type": "text", "text": "규칙"},
    {"type": "text", "text": "이력서", "cache_control": {"type": "ephemeral"}},
]
MESSAGES = [{"role": "user", "content": "면접을 시작해 주세요."}]


class _Stream:
    def __init__(self, chunks, stop_reason="end_turn"):
        self._chunks = chunks
        self._stop = stop_reason

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    @property
    def text_stream(self):
        return iter(self._chunks)

    def get_final_message(self):
        return SimpleNamespace(stop_reason=self._stop)


class _Messages:
    def __init__(self, stream=None, error=None):
        self.kwargs = None
        self._stream = stream
        self._error = error

    def stream(self, **kwargs):
        self.kwargs = kwargs
        if self._error is not None:
            raise self._error
        return self._stream


class _ApiFailure(anthropic.APIError):
    def __init__(self):
        Exception.__init__(self, "upstream failed")


def _claude(messages: _Messages) -> AnthropicClaude:
    return AnthropicClaude(sdk=SimpleNamespace(messages=messages))


def test_streams_text_with_model_effort_cache_and_fallback():
    messages = _Messages(stream=_Stream(["안녕", "하세요"]))
    out = list(
        _claude(messages).stream_text(
            system=SYSTEM, messages=MESSAGES, effort="low", max_tokens=4096
        )
    )
    assert out == ["안녕", "하세요"]
    kw = messages.kwargs
    assert kw["model"] == MODEL == "claude-sonnet-5-5"
    assert kw["max_tokens"] == 4096
    assert kw["system"] == SYSTEM
    assert kw["messages"] == MESSAGES
    assert kw["output_config"] == {"effort": "low"}
    assert kw["extra_body"] == {"fallbacks": "default"}
    assert kw["extra_headers"] == {"anthropic-beta": FALLBACK_BETA}
    assert FALLBACK_BETA == "server-side-fallback-2026-07-01"


def test_refusal_becomes_claude_error():
    messages = _Messages(stream=_Stream(["부분"], stop_reason="refusal"))
    gen = _claude(messages).stream_text(
        system=SYSTEM, messages=MESSAGES, effort="medium", max_tokens=16000
    )
    assert next(gen) == "부분"
    with pytest.raises(ClaudeError) as exc:
        next(gen)
    assert exc.value.code == "refused"


def test_api_error_becomes_claude_error():
    messages = _Messages(error=_ApiFailure())
    with pytest.raises(ClaudeError) as exc:
        list(
            _claude(messages).stream_text(
                system=SYSTEM, messages=MESSAGES, effort="low", max_tokens=4096
            )
        )
    assert exc.value.code == "claude_error"


def test_app_builds_real_client_only_with_key(settings):
    assert create_app(settings=settings).state.claude is None
    app = create_app(settings=replace(settings, anthropic_api_key="sk-test"))
    assert isinstance(app.state.claude, AnthropicClaude)


def test_injected_client_wins(settings, fake_claude):
    assert create_app(settings=settings, claude=fake_claude).state.claude is fake_claude
