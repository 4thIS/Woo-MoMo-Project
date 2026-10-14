"""벤 프롬프트가 프론트와 글자까지 같은지 (spec 4.4). 프론트 파일을 리포에서 직접 읽는다."""

import re
from pathlib import Path

from app.llm import prompts

FRONTEND_SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _read(rel: str) -> str:
    return (FRONTEND_SRC / rel).read_text(encoding="utf-8").replace("\r\n", "\n")


def test_report_instruction_matches_frontend():
    m = re.search(r"export const REPORT_INSTRUCTION = `(.*?)`", _read("prompts/report.ts"), re.S)
    assert m is not None
    assert prompts.REPORT_INSTRUCTION == m.group(1)


def test_end_phrase_matches_frontend():
    m = re.search(r"export const END_PHRASE = '([^']*)'", _read("utils/endDetector.ts"))
    assert m is not None
    assert prompts.END_PHRASE == m.group(1)


def test_kickoff_matches_frontend():
    m = re.search(r"export const KICKOFF = '([^']*)'", _read("prompts/interviewer.ts"))
    assert m is not None
    assert prompts.KICKOFF == m.group(1)


def test_ben_is_the_sharp_persona():
    assert re.search(r"make\('m2', '벤',[^\n]*'sharp'", _read("interviewers/index.ts"))


def test_sharp_persona_text_matches_frontend():
    src = _read("prompts/personas.ts")
    sharp = src[src.index("  sharp: {") :]
    for value in (prompts.SHARP_CHARACTER, prompts.SHARP_FOLLOW_UP, prompts.SHARP_REPORT_TONE):
        assert f"'{value}'" in sharp
    assert f"reaction: '{prompts.SHARP_REACTION}'" in sharp
