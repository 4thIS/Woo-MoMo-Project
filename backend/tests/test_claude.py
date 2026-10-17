from dataclasses import replace
from types import SimpleNamespace

import anthropic
import pytest

from app.llm.claude import (
    FALLBACK_BETA,
    MAX_CONTINUATIONS,
    MODEL,
    RESEARCH_TIMEOUT,
    WEB_SEARCH_TOOL,
    AnthropicClaude,
    ClaudeError,
    ResearchResult,
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


def _text(t):
    return SimpleNamespace(type="text", text=t)


def _results(*pairs):
    return SimpleNamespace(
        type="web_search_tool_result",
        content=[SimpleNamespace(type="web_search_result", title=t, url=u) for t, u in pairs],
    )


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


def _research_claude(create: _Create) -> AnthropicClaude:
    return AnthropicClaude(sdk=create)


R_MESSAGES = [{"role": "user", "content": "지원 기업: 토스\n지원 직무: 백엔드"}]


def test_research_uses_web_search_and_collects_text_and_sources():
    create = _Create(
        [
            _resp(
                [
                    SimpleNamespace(type="server_tool_use", name="web_search"),
                    _results(
                        ("토스 소개", "https://toss.im"), ("토스 블로그", "https://toss.tech/a")
                    ),
                    _text("사업: 간편송금"),
                    _text(" 최근 소식: 증권"),
                ]
            )
        ]
    )
    got = _research_claude(create).research(
        system="조사 규칙", messages=R_MESSAGES, max_tokens=8000
    )
    assert got == ResearchResult(
        text="사업: 간편송금 최근 소식: 증권",
        sources=[
            {"title": "토스 소개", "url": "https://toss.im"},
            {"title": "토스 블로그", "url": "https://toss.tech/a"},
        ],
    )
    assert create.options == [{"max_retries": 0}]
    kw = create.calls[0]
    assert kw["model"] == MODEL
    assert kw["tools"] == [WEB_SEARCH_TOOL]
    assert WEB_SEARCH_TOOL == {"type": "web_search_20260209", "name": "web_search", "max_uses": 5}
    assert kw["output_config"] == {"effort": "medium"}
    assert kw["timeout"] == RESEARCH_TIMEOUT
    assert kw["extra_body"] == {"fallbacks": "default"}
    assert kw["extra_headers"] == {"anthropic-beta": FALLBACK_BETA}
    assert kw["system"] == "조사 규칙"
    assert kw["messages"] == R_MESSAGES


def test_research_resumes_pause_turn_with_the_paused_content():
    first = _resp([_results(("a", "https://a.com")), _text("앞")], stop_reason="pause_turn")
    second = _resp([_results(("a", "https://a.com"), ("b", "https://b.com")), _text("뒤")])
    create = _Create([first, second])
    got = _research_claude(create).research(system="s", messages=R_MESSAGES, max_tokens=8000)
    assert got.text == "앞뒤"  # 검색 직전 서술이 없으면 pause 전후 본문 모두 유지
    assert [s["url"] for s in got.sources] == ["https://a.com", "https://b.com"]  # 중복 제거
    assert create.calls[1]["messages"] == [
        *R_MESSAGES,
        {"role": "assistant", "content": first.content},
    ]


def test_research_stops_after_max_continuations():
    paused = [_resp([_text("x")], stop_reason="pause_turn") for _ in range(MAX_CONTINUATIONS + 1)]
    create = _Create(paused)
    got = _research_claude(create).research(system="s", messages=R_MESSAGES, max_tokens=8000)
    assert len(create.calls) == MAX_CONTINUATIONS + 1
    assert got.text == "x" * (MAX_CONTINUATIONS + 1)


def test_search_error_block_is_not_a_source():
    err = SimpleNamespace(
        type="web_search_tool_result", content=SimpleNamespace(error_code="unavailable")
    )
    create = _Create([_resp([err, _text("본문")])])
    got = _research_claude(create).research(system="s", messages=R_MESSAGES, max_tokens=8000)
    assert got.sources == []


def test_research_refusal_and_api_error_become_claude_error():
    refused = _Create([_resp([_text("…")], stop_reason="refusal")])
    with pytest.raises(ClaudeError) as e1:
        _research_claude(refused).research(system="s", messages=R_MESSAGES, max_tokens=8000)
    assert e1.value.code == "refused"
    broken = _Create(error=_ApiFailure())
    with pytest.raises(ClaudeError) as e2:
        _research_claude(broken).research(system="s", messages=R_MESSAGES, max_tokens=8000)
    assert e2.value.code == "claude_error"


def test_research_drops_narration_before_a_search():
    create = _Create(
        [
            _resp(
                [
                    _text("토스에 대해 검색해 보겠습니다."),
                    SimpleNamespace(type="server_tool_use", name="web_search"),
                    _results(("토스", "https://toss.im")),
                    _text("본문"),
                ]
            )
        ]
    )
    got = _research_claude(create).research(system="s", messages=R_MESSAGES, max_tokens=8000)
    assert got.text == "본문"


def test_research_keeps_body_written_between_searches():
    create = _Create(
        [
            _resp(
                [
                    SimpleNamespace(type="server_tool_use", name="web_search"),
                    _results(("토스", "https://toss.im")),
                    _text("사업: 간편송금 "),
                    SimpleNamespace(type="server_tool_use", name="web_search"),
                    _results(("토스2", "https://toss.tech")),
                    _text("최근 소식: 증권"),
                ]
            )
        ]
    )
    got = _research_claude(create).research(system="s", messages=R_MESSAGES, max_tokens=8000)
    assert got.text == "사업: 간편송금 최근 소식: 증권"


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


def test_research_sums_usage_across_continuations_and_searches():
    got, sink = _collect()
    first = _resp([_text("a")], "pause_turn")
    first.usage = _usage(server_tool_use=SimpleNamespace(web_search_requests=2))
    second = _resp([_text("b")])
    second.usage = _usage(server_tool_use=SimpleNamespace(web_search_requests=1))
    _research_claude(_Create([first, second])).research(
        system="s", messages=R_MESSAGES, max_tokens=9, on_usage=sink
    )
    assert got == [(Usage(20, 10, 6, 4, 3), "ok")]


def test_research_reports_refused_and_error_once():
    got, sink = _collect()
    refused = _resp([], "refusal")
    refused.usage = _usage()
    with pytest.raises(ClaudeError):
        _research_claude(_Create([refused])).research(
            system="s", messages=R_MESSAGES, max_tokens=9, on_usage=sink
        )
    with pytest.raises(ClaudeError):
        _research_claude(_Create(error=_ApiFailure())).research(
            system="s", messages=R_MESSAGES, max_tokens=9, on_usage=sink
        )
    assert got == [(Usage(10, 5, 3, 2, 0), "refused"), (Usage(), "error")]


def test_report_logs_only_exception_type_on_sink_failure(caplog):
    from app.llm.claude import _report

    def boom(usage, outcome):
        raise RuntimeError("secret content 이력서")

    with caplog.at_level("WARNING"):
        _report(boom, Usage(), "ok")
    assert [r.getMessage() for r in caplog.records] == ["claude usage record failed: RuntimeError"]
