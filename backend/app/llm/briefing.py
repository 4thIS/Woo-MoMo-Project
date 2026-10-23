"""벤 회사 브리핑 (spec 2026-10-15). 회사명·직무만으로 웹을 조사한다 — 이력서·대화는 넣지 않는다."""

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from app.llm.claude import ClaudeClient, ClaudeError, UsageSink
from app.llm.prompts import _one_line

BRIEFING_MIN = 200
BRIEFING_MAX = 2800
MAX_SOURCES = 10
RESEARCH_MAX_TOKENS = 8000

RESEARCH_SYSTEM = "\n".join(
    [
        "당신은 채용 면접을 준비하는 리서처입니다. "
        "웹 검색으로 지원 기업의 최신 공개 정보를 찾아 한국어 브리핑을 씁니다.",
        "[작성 규칙]",
        "1. 소제목 네 개(사업, 최근 소식, 기술·제품, 인재상)를 이 순서로 쓰고, "
        "소제목마다 2~4문장으로 씁니다.",
        "2. 최근 소식은 가능하면 최근 1년 안의 것을 날짜와 함께 씁니다.",
        "3. 지원 직무와 관련 있는 내용을 우선합니다.",
        "4. 확인하지 못한 내용은 지어내지 말고 '확인되지 않음'이라고 씁니다.",
        "5. 전체 1,500자 안팎(모집공고가 있으면 2,200자 안팎)으로 씁니다. "
        "URL, 링크, 머리말, 맺음말은 쓰지 않습니다.",
        "6. 이름이 같은 회사가 여럿이면 지원 직무에 가장 맞는 회사를 고르고, "
        "첫 줄에 어떤 회사인지 한 문장으로 밝힙니다.",
        '7. 검색 전후에 진행 상황("검색해 보겠습니다" 등)을 말하지 말고, 브리핑 본문만 씁니다.',
        "8. 메시지에 모집공고가 있으면 먼저 그 페이지를 읽고, 다섯 번째 소제목 "
        '"모집공고 요구사항"에 담당 업무·필수 자격/기술 스택·우대 사항·인재상을 '
        "공고에 적힌 대로 정리합니다. 공고를 열지 못하거나 공고가 아니면 그 소제목에 "
        '"공고를 확인하지 못함"이라고만 씁니다. 지원 기업이 "(공고에서 확인)"이면 '
        "공고에서 회사명을 확인해 첫 줄에 밝힙니다.",
    ]
)


@dataclass(frozen=True)
class Briefing:
    text: str
    sources: list[dict[str, str]]


def research_messages(
    company: str, job: str, posting_url: str | None = None
) -> list[dict[str, Any]]:
    if posting_url:
        name = _one_line(company, 100) or "(공고에서 확인)"
        head = f"지원 기업: {name}\n지원 직무: {_one_line(job, 100)}\n모집공고: {posting_url}\n"
    else:
        head = f"지원 기업: {_one_line(company, 100)}\n지원 직무: {_one_line(job, 100)}\n"
    return [{"role": "user", "content": head + "이 기업의 면접 준비용 브리핑을 작성해 주세요."}]


def make_briefing(
    claude: ClaudeClient,
    company: str,
    job: str,
    on_usage: UsageSink | None = None,
    posting_url: str | None = None,
) -> Briefing | None:
    """조사 1회. 실패(오류·거절·본문이 너무 짧음)는 None — 면접은 브리핑 없이 이어 간다."""
    host = urlsplit(posting_url).hostname if posting_url else None
    try:
        result = claude.research(
            system=RESEARCH_SYSTEM,
            messages=research_messages(company, job, posting_url),
            max_tokens=RESEARCH_MAX_TOKENS,
            on_usage=on_usage,
            fetch_domains=[host] if host else None,
        )
    except ClaudeError:
        return None
    text = result.text.strip()
    if len(text) < BRIEFING_MIN or not result.sources:  # 검색 근거가 없으면 지어낸 글로 본다
        return None
    return Briefing(text=text[:BRIEFING_MAX], sources=result.sources[:MAX_SOURCES])
