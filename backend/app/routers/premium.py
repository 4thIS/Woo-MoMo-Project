"""프리미엄: 목업 결제(관리자 전용)와 벤 면접 (spec 4.4)."""

import logging
import sqlite3
import time
from collections.abc import Callable, Generator, Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from app import db
from app.deps import Db, LoggedInUser, PremiumUser
from app.errors import ApiError
from app.llm import briefing as briefing_llm
from app.llm import delivery, prompts
from app.llm.baze import VoiceAnalyzer
from app.llm.claude import (
    MODEL,
    REPORT_MAX_TOKENS,
    TURN_MAX_TOKENS,
    ClaudeClient,
    ClaudeError,
    Usage,
    UsageSink,
)
from app.presenters import to_session
from app.repos import briefings, premium, usage, users, voice
from app.repos.premium import MAX_MODEL_TURNS, PremiumInterview
from app.repos.users import User
from app.schemas import InterviewStart, InterviewStarted, ReportBody, Session, TurnBody
from app.security import RateLimiter
from app.sse import PING, SSE_HEADERS, sse
from app.timefmt import iso, kst_day_start

router = APIRouter()

ANSWER_MAX = 2000
# 사용자당 벤 턴·리포트 요청 수(분당). 재시도를 반복해 Claude 호출이 불지 않게 한다
BEN_PER_MINUTE = 6
# 회사 브리핑 조사: 15초마다 ping(Cloudflare 무응답 끊김 대비), 전체 90초 넘으면 실패로 친다
PING_EVERY = 15.0
RESEARCH_DEADLINE = 90.0


@router.post("/premium/purchase", response_model=Session)
def purchase(user: LoggedInUser, conn: Db) -> Session:
    # 공개 사이트라 일반 계정은 막는다. 마지막 방어선은 BEN_DAILY_LIMIT.
    if not user.is_admin:
        raise ApiError(403, "purchase_disabled")
    with db.transaction(conn):
        updated = users.grant_tickets(conn, user.id)
    return to_session(updated)


@router.post("/premium/interviews", status_code=201, response_model=InterviewStarted)
def start_interview(
    body: InterviewStart, user: PremiumUser, conn: Db, request: Request
) -> InterviewStarted:
    if request.app.state.claude is None:
        raise ApiError(503, "ben_unavailable")
    group = body.company if body.track == "company" else body.admission
    if group is None:
        raise ApiError(422, "missing_field", field=body.track)
    inputs = {"resumeText": body.resumeText, body.track: group.model_dump(exclude_none=True)}
    # 회사명 또는 모집공고 링크가 있으면 첫 턴에 조사한다(대입 트랙은 무시)
    research = bool(
        body.track == "company"
        and body.company is not None
        and (
            (body.company.name and prompts._one_line(body.company.name))
            or body.company.postingUrl is not None
        )
    )
    now = request.app.state.clock()
    try:
        interview_id = premium.start_interview(
            conn,
            user_id=user.id,
            track=body.track,
            inputs=inputs,
            created_at=iso(now),
            day_start=kst_day_start(now),
            daily_limit=request.app.state.settings.ben_daily_limit,
            briefing_status="pending" if research else "none",
            voice_consent=body.voiceAnalysisConsent,
        )
    except premium.DailyLimitReached:
        raise ApiError(503, "daily_limit") from None
    except premium.NoTickets:
        raise ApiError(409, "no_tickets") from None
    fresh = users.get_by_id(conn, user.id)
    if fresh is None:
        raise ApiError(401, "unauthorized")
    baze: VoiceAnalyzer | None = request.app.state.baze
    voice_state = "off"
    if body.voiceAnalysisConsent:
        voice_state = "on" if baze is not None and baze.available() else "unavailable"
    return InterviewStarted(
        interviewId=interview_id, session=to_session(fresh), voiceAnalysis=voice_state
    )


def _owned(conn: sqlite3.Connection, user: User, interview_id: str) -> PremiumInterview:
    interview = premium.get_interview(conn, user_id=user.id, interview_id=interview_id)
    if interview is None:
        raise ApiError(404, "not_found")
    return interview


def _claude(request: Request) -> ClaudeClient:
    claude = request.app.state.claude
    if claude is None:
        raise ApiError(503, "ben_unavailable")
    return claude


def _ben_rate_limit(request: Request, user: User) -> None:
    limiter: RateLimiter = request.app.state.limiter
    if not limiter.allow(f"ben:{user.id}", BEN_PER_MINUTE):
        raise ApiError(429, "rate_limited")


def _count_attempt(conn: sqlite3.Connection, interview: PremiumInterview) -> None:
    """Claude를 부르기 직전에 시도 수를 센다. 상한(MAX_ATTEMPTS)을 넘으면 409."""
    try:
        premium.count_attempt(conn, interview_id=interview.id)
    except premium.TooManyAttempts:
        raise ApiError(409, "interview_over") from None


def _usage_sink(
    db_path: Path,
    clock: Callable[[], float],
    user_id: str,
    interview_id: str,
    kind: str,
) -> UsageSink:
    """Claude 호출 사용량을 claude_usage에 남기는 콜백. 워커 스레드에서도 불리므로
    쓸 때마다 자기 연결을 연다. 실패는 삼킨다 — 기록이 면접을 막지 않는다(본문은 남기지 않는다)."""

    def sink(used: Usage, outcome: str) -> None:
        try:
            with db.connection(db_path) as c:
                usage.record(
                    c,
                    at=iso(clock()),
                    user_id=user_id,
                    interview_id=interview_id,
                    kind=kind,
                    model=MODEL,
                    input_tokens=used.input_tokens,
                    output_tokens=used.output_tokens,
                    cache_read_tokens=used.cache_read_tokens,
                    cache_write_tokens=used.cache_write_tokens,
                    web_searches=used.web_searches,
                    outcome=outcome,
                )
        except Exception as exc:
            logging.getLogger(__name__).warning(
                "claude usage record failed: %s", type(exc).__name__
            )

    return sink


def _research_and_store(
    claude: ClaudeClient,
    db_path: Path,
    interview_id: str,
    key: str,
    name: str,
    job: str,
    created_at: str,
    on_usage: UsageSink | None = None,
    posting_url: str | None = None,
) -> briefing_llm.Briefing | None:
    """워커 스레드: 조사하고 성공하면 바로 저장한다(캐시 + 면접).

    스트림이 포기했거나 클라이언트가 끊겨도 결과는 버려지지 않는다.
    예상 못 한 예외는 실패(None)로 접는다 — 본문은 로그에 남기지 않는다."""
    try:
        made = briefing_llm.make_briefing(claude, name, job, on_usage, posting_url)
        if made is None:
            return None
        # 공고를 읽지 못한 브리핑은 이 면접에만 쓰고 7일 공유 캐시에는 넣지 않는다
        posting_failed = bool(posting_url) and prompts.POSTING_MISSING_STEM in made.text
        with db.connection(db_path) as c:
            if not posting_failed:
                briefings.put(
                    c,
                    key=key,
                    company=name,
                    job=job,
                    briefing=made.text,
                    sources=made.sources,
                    created_at=created_at,
                )
            premium.set_briefing(c, interview_id=interview_id, briefing=made.text)
        return made
    except Exception:
        return None


def _research_with_pings(
    claude: ClaudeClient,
    db_path: Path,
    interview_id: str,
    key: str,
    name: str,
    job: str,
    created_at: str,
    on_usage: UsageSink | None = None,
    posting_url: str | None = None,
) -> Generator[str, None, briefing_llm.Briefing | None]:
    """조사를 다른 스레드에서 돌리며 ping을 흘린다. 기한을 넘기면 None(스레드는 알아서 끝난다)."""
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="briefing")
    future = pool.submit(
        _research_and_store,
        claude,
        db_path,
        interview_id,
        key,
        name,
        job,
        created_at,
        on_usage,
        posting_url,
    )
    pool.shutdown(wait=False)
    deadline = time.monotonic() + RESEARCH_DEADLINE
    while True:
        try:
            return future.result(timeout=PING_EVERY)
        except TimeoutError:
            if time.monotonic() >= deadline:
                return None
            yield PING


def _resolve_briefing(
    claude: ClaudeClient,
    db_path: Path,
    interview: PremiumInterview,
    now: float,
    on_usage: UsageSink | None = None,
) -> Generator[str, None, str | None]:
    """첫 턴: 캐시 → 없으면 조사. status 이벤트를 흘리고 브리핑 본문(없으면 None)을 돌려준다."""
    if interview.briefing_status != "pending":  # 첫 질문 실패 뒤 재시도 — 결과만 다시 알린다
        yield sse("status", {"phase": "briefing", "ok": interview.briefing_status == "ok"})
        return interview.briefing
    company = interview.inputs["company"]
    name, job = company.get("name") or "", company["job"]
    posting_url = company.get("postingUrl")
    key = briefings.cache_key(name, job, posting_url)
    with db.connection(db_path) as c:
        cached = briefings.get_fresh(c, key=key, since=iso(now - briefings.FRESH_SECONDS))
    text: str | None = cached.briefing if cached is not None else None
    if cached is None:
        yield sse("status", {"phase": "researching"})
        try:
            with db.connection(db_path) as c:
                premium.count_attempt(c, interview_id=interview.id)
        except premium.TooManyAttempts:
            pass
        else:
            yield from _research_with_pings(
                claude, db_path, interview.id, key, name, job, iso(now), on_usage, posting_url
            )
    with db.connection(db_path) as c:
        premium.set_briefing(c, interview_id=interview.id, briefing=text)
        # 먼저 끝난 쪽이 이긴다 — 워커가 방금 저장했다면 그 결과를 쓴다
        row = c.execute(
            "SELECT briefing FROM premium_interviews WHERE id = ?", (interview.id,)
        ).fetchone()
    text = row["briefing"] if row is not None else text
    yield sse("status", {"phase": "briefing", "ok": text is not None})
    return text


def _stream(events: Iterator[str]) -> StreamingResponse:
    """ping 주석을 먼저 보내고, 예상 못 한 예외는 server_error 이벤트로 끝낸다."""

    def guarded() -> Iterator[str]:
        yield PING
        try:
            yield from events
        except Exception:
            yield sse("error", {"code": "server_error"})

    return StreamingResponse(guarded(), media_type="text/event-stream", headers=SSE_HEADERS)


def is_over(interview: PremiumInterview) -> bool:
    """리포트까지 받았거나, 면접관 응답 상한(9번)이거나, 마지막 응답이 종료 문장이면 끝."""
    if interview.status == "done" or interview.model_turns >= MAX_MODEL_TURNS:
        return True
    last = interview.messages[-1] if interview.messages else None
    return last is not None and last["role"] == "model" and prompts.has_end_phrase(last["text"])


@router.post("/premium/interviews/{interview_id}/turns")
def take_turn(
    interview_id: str,
    user: PremiumUser,
    conn: Db,
    request: Request,
    body: TurnBody | None = None,
) -> StreamingResponse:
    _ben_rate_limit(request, user)
    interview = _owned(conn, user, interview_id)
    if is_over(interview):
        raise ApiError(409, "interview_over")
    answer: str | None = None
    if interview.messages:  # 첫 턴은 첫 질문만 받는다(answer 무시, 본문 없어도 된다)
        answer = ((body.answer if body else None) or "").strip()
        if not answer:
            raise ApiError(422, "missing_answer", field="answer")
        if len(answer) > ANSWER_MAX:
            raise ApiError(422, "answer_too_long", field="answer")
    claude = _claude(request)
    _count_attempt(conn, interview)
    messages = prompts.turn_messages(interview.messages, answer)
    db_path = request.app.state.settings.db_path
    now = request.app.state.clock()
    first_with_briefing = interview.model_turns == 0 and interview.briefing_status != "none"
    clock = request.app.state.clock
    turn_sink = _usage_sink(db_path, clock, user.id, interview.id, "turn")
    research_sink = _usage_sink(db_path, clock, user.id, interview.id, "research")

    def events() -> Iterator[str]:
        brief = interview.briefing
        if first_with_briefing:
            brief = yield from _resolve_briefing(claude, db_path, interview, now, research_sink)
        system = prompts.build_system(interview.track, interview.inputs, brief)
        chunks: list[str] = []
        try:
            for text in claude.stream_text(
                system=system,
                messages=messages,
                effort="low",
                max_tokens=TURN_MAX_TOKENS,
                on_usage=turn_sink,
            ):
                chunks.append(text)
                yield sse("delta", {"text": text})
        except ClaudeError as exc:
            # 실패한 턴은 기록하지 않는다 — 같은 요청으로 다시 시도한다
            yield sse("error", {"code": exc.code})
            return
        reply = "".join(chunks)
        if not reply.strip():
            yield sse("error", {"code": "claude_error"})
            return
        try:
            with db.connection(db_path) as c:
                saved = premium.append_turn(
                    c,
                    interview_id=interview.id,
                    answer=answer,
                    model_text=reply,
                    expected_model_turns=interview.model_turns,
                )
        except premium.TurnConflict:
            yield sse("error", {"code": "turn_conflict"})
            return
        yield sse("done", {"ended": is_over(saved)})

    return _stream(events())


def _delivery_block(body: Any, interview: PremiumInterview) -> str | None:
    """리포트 본문의 전달력 측정을 검증해 프롬프트 블록으로. 없으면 None(지금과 같음)."""
    try:
        parsed = ReportBody.model_validate(body if body is not None else {})
    except ValidationError:
        raise ApiError(422, "invalid", field="delivery") from None
    answers = sum(1 for m in interview.messages if m["role"] == "user")
    if any(m.answer > answers for m in parsed.delivery):
        raise ApiError(422, "invalid", field="delivery")
    return delivery.render(
        [
            delivery.AnswerMetrics(
                answer=m.answer,
                speech_sec=m.speechSec,
                syllables=m.syllables,
                long_pauses=m.longPauses,
                longest_pause_sec=m.longestPauseSec,
                first_word_sec=m.firstWordSec,
                filler_level=m.fillerLevel,
            )
            for m in parsed.delivery
        ]
    )


@router.post("/premium/interviews/{interview_id}/report")
def make_report(
    interview_id: str,
    user: PremiumUser,
    conn: Db,
    request: Request,
    body: Any = Body(default=None),  # noqa: B008
) -> StreamingResponse:
    _ben_rate_limit(request, user)
    interview = _owned(conn, user, interview_id)
    if interview.status == "done":
        stored = interview.report_raw
        if stored is None:  # 원문 보관(003) 전에 끝난 면접
            raise ApiError(409, "interview_over")

        def replay() -> Iterator[str]:
            # 이미 받은 리포트를 다시 보낸다 — Claude를 부르지 않는다
            yield sse("delta", {"text": stored})
            yield sse("done", {})

        return _stream(replay())
    if interview.model_turns == 0:
        raise ApiError(409, "interview_not_started")
    block = _delivery_block(body, interview)
    claude = _claude(request)
    _count_attempt(conn, interview)
    system = prompts.build_system(interview.track, interview.inputs)
    messages = prompts.report_messages(interview.messages, block)
    db_path = request.app.state.settings.db_path
    report_sink = _usage_sink(db_path, request.app.state.clock, user.id, interview.id, "report")

    def events() -> Iterator[str]:
        chunks: list[str] = []
        try:
            for text in claude.stream_text(
                system=system,
                messages=messages,
                effort="medium",
                max_tokens=REPORT_MAX_TOKENS,
                on_usage=report_sink,
            ):
                chunks.append(text)
                yield sse("delta", {"text": text})
        except ClaudeError as exc:
            # 실패하면 done으로 바꾸지 않는다 — 같은 요청으로 다시 만들 수 있다
            yield sse("error", {"code": exc.code})
            return
        raw = "".join(chunks)
        if not raw.strip():
            yield sse("error", {"code": "claude_error"})
            return
        with db.connection(db_path) as c:
            premium.mark_done(c, interview_id=interview.id, report_raw=raw)
        yield sse("done", {})

    return _stream(events())


# ── 목소리 분석(BAZE) 업로드 ──

VOICE_MAX_BYTES = 5 * 1024 * 1024
VOICE_PER_MINUTE = 20


def _is_wav(head: bytes) -> bool:
    return head[:4] == b"RIFF" and head[8:12] == b"WAVE"


def _analyze_and_store(
    baze: VoiceAnalyzer,
    db_path: Path,
    clock: Callable[[], float],
    model: str,
    user_id: str,
    interview_id: str,
    answer: int,
    tmp: Path,
) -> None:
    """워커 스레드: 임시 녹음을 분석해 결과를 저장하고, 어떤 경로로 끝나도 파일을 지운다.

    예외는 failed로 접는다 - 로그에는 예외 이름만(녹음·받아쓰기·키는 남기지 않는다)."""
    status, result_json, error_code = "failed", None, "error"
    try:
        outcome = baze.analyze(tmp.read_bytes())
        if outcome.outcome == "ok" and outcome.result is not None:
            status, result_json, error_code = "done", outcome.result.model_dump_json(), None
        elif outcome.outcome == "unavailable":
            status, error_code = "unavailable", "unavailable"
        else:
            error_code = outcome.outcome
        if outcome.key_index is not None or outcome.outcome != "unavailable":
            try:
                with db.connection(db_path) as c:
                    voice.record_usage(
                        c,
                        at=iso(clock()),
                        user_id=user_id,
                        interview_id=interview_id,
                        key_index=outcome.key_index,
                        model=model,
                        input_tokens=outcome.input_tokens,
                        output_tokens=outcome.output_tokens,
                        outcome=(
                            outcome.outcome if outcome.outcome in ("ok", "exhausted") else "error"
                        ),
                    )
            except Exception as exc:
                logging.getLogger(__name__).warning(
                    "baze usage record failed: %s", type(exc).__name__
                )
    except Exception as exc:
        logging.getLogger(__name__).warning("voice analysis failed: %s", type(exc).__name__)
        status, result_json, error_code = "failed", None, "error"
    finally:
        tmp.unlink(missing_ok=True)
        try:
            with db.connection(db_path) as c:
                voice.finish(
                    c,
                    interview_id=interview_id,
                    answer=answer,
                    status=status,
                    result_json=result_json,
                    error_code=error_code,
                    now=iso(clock()),
                )
        except Exception as exc:
            logging.getLogger(__name__).warning("voice finish failed: %s", type(exc).__name__)


@router.post("/premium/interviews/{interview_id}/voice/{answer}", status_code=202)
def upload_voice(
    interview_id: str,
    answer: int,
    file: UploadFile,
    user: PremiumUser,
    conn: Db,
    request: Request,
) -> dict[str, str]:
    limiter: RateLimiter = request.app.state.limiter
    if not limiter.allow(f"voice:{user.id}", VOICE_PER_MINUTE):
        raise ApiError(429, "rate_limited")
    interview = _owned(conn, user, interview_id)
    if not interview.voice_consent:
        raise ApiError(403, "voice_consent_required")
    if interview.status == "done":
        raise ApiError(409, "interview_over")
    baze: VoiceAnalyzer | None = request.app.state.baze
    if baze is None or not baze.available():
        raise ApiError(503, "voice_unavailable")
    answers = sum(1 for m in interview.messages if m["role"] == "user")
    if answer < 1 or answer > answers:
        raise ApiError(422, "invalid", field="answer")
    data = file.file.read(VOICE_MAX_BYTES + 1)
    if len(data) > VOICE_MAX_BYTES:
        raise ApiError(413, "too_large")
    if not _is_wav(data):
        raise ApiError(415, "unsupported_media")
    settings = request.app.state.settings
    clock = request.app.state.clock
    tmp = settings.voice_tmp_dir / f"{interview.id}-{answer}.wav"
    try:
        tmp.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_bytes(data)
        with db.transaction(conn):
            voice.queue(conn, interview_id=interview.id, answer=answer, now=iso(clock()))
        request.app.state.voice_pool.submit(
            _analyze_and_store,
            baze,
            settings.db_path,
            clock,
            settings.baze_voice_model,
            user.id,
            interview.id,
            answer,
            tmp,
        )
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return {"status": "queued"}
