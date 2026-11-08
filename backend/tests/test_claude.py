from dataclasses import replace
from types import SimpleNamespace

import anthropic
import httpx
import pytest

from app.llm.claude import (
    BRIEFING_MODEL,
    FALLBACK_BETA,
    MODEL,
    AnthropicClaude,
    ClaudeError,
    Usage,
)
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


def test_collector_uses_naver_only_with_both_keys(settings):
    from app.llm.briefing import WebCollector

    app = create_app(settings=settings)
    assert isinstance(app.state.collector, WebCollector) and app.state.collector._naver is None
    app = create_app(settings=replace(settings, naver_client_id="a"))
    assert app.state.collector._naver is None  # 키 하나만 있으면 검색하지 않는다
    app = create_app(settings=replace(settings, naver_client_id="a", naver_client_secret="b"))
    assert app.state.collector._naver is not None


def test_injected_collector_wins(settings, fake_collector):
    assert create_app(settings=settings, collector=fake_collector).state.collector is fake_collector


def _text(t):
    return SimpleNamespace(type="text", text=t)


def _resp(blocks, stop_reason="end_turn"):
    return SimpleNamespace(content=blocks, stop_reason=stop_reason)


class _Create:
    def __init__(self, responses=None, error=None):
        self.calls = []
        self.options = []
        self.messages = self  # sdk.messages.create / sdk.with_options(...).messages.create
        self._responses = list(responses or [])
        self._error = error

    def with_options(self, **kwargs):
        self.options.append(kwargs)
        return self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self._error is not None:
            raise self._error
        return self._responses.pop(0)


R_MESSAGES = [{"role": "user", "content": "지원 기업: 토스\n지원 직무: 백엔드"}]


def _usage(**over):
    base = dict(
        input_tokens=10,
        output_tokens=5,
        cache_read_input_tokens=3,
        cache_creation_input_tokens=2,
        server_tool_use=None,
    )
    return SimpleNamespace(**{**base, **over})


class _UsageStream(_Stream):
    def __init__(self, chunks, stop_reason="end_turn", usage=None):
        super().__init__(chunks, stop_reason)
        self._usage = usage

    def get_final_message(self):
        return SimpleNamespace(stop_reason=self._stop, usage=self._usage)


def _collect():
    got = []
    return got, lambda usage, outcome: got.append((usage, outcome))


def test_stream_reports_usage_ok():
    got, sink = _collect()
    claude = _claude(
        _Messages(stream=_UsageStream(["a"], usage=_usage(cache_read_input_tokens=None)))
    )
    assert list(
        claude.stream_text(
            system=SYSTEM, messages=MESSAGES, effort="low", max_tokens=9, on_usage=sink
        )
    ) == ["a"]
    assert got == [(Usage(10, 5, 0, 2, 0), "ok")]


def test_stream_reports_refused_then_raises():
    got, sink = _collect()
    claude = _claude(_Messages(stream=_UsageStream(["a"], "refusal", _usage())))
    with pytest.raises(ClaudeError) as err:
        list(
            claude.stream_text(
                system=SYSTEM, messages=MESSAGES, effort="low", max_tokens=9, on_usage=sink
            )
        )
    assert err.value.code == "refused"
    assert got == [(Usage(10, 5, 3, 2, 0), "refused")]


def test_stream_reports_error_with_zero_usage():
    got, sink = _collect()
    claude = _claude(_Messages(error=_ApiFailure()))
    with pytest.raises(ClaudeError):
        list(
            claude.stream_text(
                system=SYSTEM, messages=MESSAGES, effort="low", max_tokens=9, on_usage=sink
            )
        )
    assert got == [(Usage(), "error")]


def test_stream_swallows_callback_errors():
    def boom(usage, outcome):
        raise RuntimeError("db down")

    claude = _claude(_Messages(stream=_UsageStream(["a"], usage=_usage())))
    out = list(
        claude.stream_text(
            system=SYSTEM, messages=MESSAGES, effort="low", max_tokens=9, on_usage=boom
        )
    )
    assert out == ["a"]


def test_report_logs_only_exception_type_on_sink_failure(caplog):
    from app.llm.claude import _report

    def boom(usage, outcome):
        raise RuntimeError("secret content 이력서")

    with caplog.at_level("WARNING"):
        _report(boom, Usage(), "ok")
    assert [r.getMessage() for r in caplog.records] == ["claude usage record failed: RuntimeError"]


def test_output_format_goes_into_output_config_format():
    messages = _Messages(stream=_Stream(["{}"]))
    schema = {"type": "object", "properties": {}, "additionalProperties": False}
    list(
        _claude(messages).stream_text(
            system=SYSTEM,
            messages=MESSAGES,
            effort="medium",
            max_tokens=16000,
            output_format=schema,
        )
    )
    assert messages.kwargs["output_config"] == {
        "effort": "medium",
        "format": {"type": "json_schema", "schema": schema},
    }


def test_without_output_format_output_config_has_only_effort():
    messages = _Messages(stream=_Stream(["x"]))
    list(
        _claude(messages).stream_text(
            system=SYSTEM, messages=MESSAGES, effort="low", max_tokens=10, output_format=None
        )
    )
    assert messages.kwargs["output_config"] == {"effort": "low"}


def test_max_tokens_with_output_format_is_too_long_after_usage():
    got, sink = _collect()
    claude = _claude(_Messages(stream=_UsageStream(["{"], "max_tokens", _usage())))
    with pytest.raises(ClaudeError) as err:
        list(
            claude.stream_text(
                system=SYSTEM,
                messages=MESSAGES,
                effort="low",
                max_tokens=9,
                on_usage=sink,
                output_format={"type": "object"},
            )
        )
    assert err.value.code == "too_long"
    assert got == [(Usage(10, 5, 3, 2, 0), "ok")]


def test_max_tokens_without_output_format_is_unchanged():
    got, sink = _collect()
    claude = _claude(_Messages(stream=_UsageStream(["a"], "max_tokens", _usage())))
    assert list(
        claude.stream_text(
            system=SYSTEM, messages=MESSAGES, effort="low", max_tokens=9, on_usage=sink
        )
    ) == ["a"]
    assert got == [(Usage(10, 5, 3, 2, 0), "ok")]


def test_complete_is_one_call_without_tools():
    usage = SimpleNamespace(
        input_tokens=900,
        output_tokens=400,
        cache_read_input_tokens=None,
        cache_creation_input_tokens=None,
        server_tool_use=None,
    )
    create = _Create(
        [
            SimpleNamespace(
                content=[_text("사업: "), _text("결제")], stop_reason="end_turn", usage=usage
            )
        ]
    )
    seen = []
    got = AnthropicClaude(sdk=create).complete(
        system="규칙",
        messages=R_MESSAGES,
        model=BRIEFING_MODEL,
        max_tokens=2000,
        timeout=7.0,
        on_usage=lambda u, o: seen.append((u, o)),
    )
    assert got == "사업: 결제"
    call = create.calls[0]
    assert call["model"] == "claude-haiku-5-5"
    assert call["timeout"] == 7.0 and call["max_tokens"] == 2000
    assert "tools" not in call
    # Haiku 5.5는 생각이 기본으로 켜져 max_tokens·7초를 잡아먹는다 — 끄고 effort low
    assert call["thinking"] == {"type": "disabled"}
    assert call["output_config"] == {"effort": "low"}
    assert "extra_body" not in call and "extra_headers" not in call  # Haiku는 fallbacks 없음
    assert create.options == [{"max_retries": 0}]
    assert seen == [(Usage(input_tokens=900, output_tokens=400), "ok")]


def test_complete_refusal_and_error():
    create = _Create([_resp([], stop_reason="refusal")])
    with pytest.raises(ClaudeError) as e:
        AnthropicClaude(sdk=create).complete(
            system="s", messages=R_MESSAGES, model=BRIEFING_MODEL, max_tokens=10, timeout=1.0
        )
    assert e.value.code == "refused"
    err = anthropic.APIConnectionError(request=httpx.Request("POST", "https://x"))
    with pytest.raises(ClaudeError) as e:
        AnthropicClaude(sdk=_Create(error=err)).complete(
            system="s", messages=R_MESSAGES, model=BRIEFING_MODEL, max_tokens=10, timeout=1.0
        )
    assert e.value.code == "claude_error"


def test_complete_cut_off_by_max_tokens_is_too_long_after_usage():
    got, sink = _collect()
    create = _Create(
        [SimpleNamespace(content=[_text("사업: 결")], stop_reason="max_tokens", usage=_usage())]
    )
    with pytest.raises(ClaudeError) as e:
        AnthropicClaude(sdk=create).complete(
            system="s",
            messages=R_MESSAGES,
            model=BRIEFING_MODEL,
            max_tokens=10,
            timeout=1.0,
            on_usage=sink,
        )
    assert e.value.code == "too_long"
    assert got == [(Usage(10, 5, 3, 2, 0), "ok")]
