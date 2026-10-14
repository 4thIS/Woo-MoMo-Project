"""벤 회사 브리핑 (spec 2026-10-15). 회사명·직무만으로 웹을 조사한다 — 이력서·대화는 넣지 않는다."""

from dataclasses import dataclass
from typing import Any

from app.llm.claude import ClaudeClient, ClaudeError
from app.llm.prompts import _one_line

BRIEFING_MIN = 200
BRIEFING_MAX = 2000
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
        "5. 전체 1,500자 안팎으로 씁니다. URL, 링크, 머리말, 맺음말은 쓰지 않습니다.",
        "6. 이름이 같은 회사가 여럿이면 지원 직무에 가장 맞는 회사를 고르고, "
        "첫 줄에 어떤 회사인지 한 문장으로 밝힙니다.",
    ]
)


@dataclass(frozen=True)
class Briefing:
    text: str
    sources: list[dict[str, str]]


def research_messages(company: str, job: str) -> list[dict[str, Any]]:
    return [
        {
            "role": "user",
            "content": (
                f"지원 기업: {_one_line(company, 100)}\n지원 직무: {_one_line(job, 100)}\n"
                "이 기업의 면접 준비용 브리핑을 작성해 주세요."
            ),
        }
    ]


def make_briefing(claude: ClaudeClient, company: str, job: str) -> Briefing | None:
    """조사 1회. 실패(오류·거절·본문이 너무 짧음)는 None — 면접은 브리핑 없이 이어 간다."""
    try:
        result = claude.research(
            system=RESEARCH_SYSTEM,
            messages=research_messages(company, job),
            max_tokens=RESEARCH_MAX_TOKENS,
        )
    except ClaudeError:
        return None
    text = result.text.strip()
    if len(text) < BRIEFING_MIN or not result.sources:  # 검색 근거가 없으면 지어낸 글로 본다
        return None
    return Briefing(text=text[:BRIEFING_MAX], sources=result.sources[:MAX_SOURCES])
