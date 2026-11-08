import json

from app.llm.pii import Masker


def _m():
    m = Masker(["홍길동"])
    # 주소 라벨은 줄 머리에 있어야 가려진다
    m.mask('홍길동 010-1234-5678\n주소: 서울 "우리"동 3')
    return m


def test_unmask_plain_and_unknown():
    m = _m()
    assert m.unmask("[이름1]님, [전화1]로 연락드릴게요. [이름3]") == (
        "홍길동님, 010-1234-5678로 연락드릴게요. [이름3]"
    )


def test_unmask_json_escapes_values():
    m = _m()
    raw = '[{"feedback": "[주소1]에서 오셨군요"}]'
    got = m.unmask(raw, json_escape=True)
    assert json.loads(got) == [{"feedback": '서울 "우리"동 3에서 오셨군요'}]


def test_stream_joins_split_placeholders():
    m = _m()
    s = m.stream()
    out = [
        s.feed("안녕하세요 [이"),
        s.feed("름"),
        s.feed("1]님. 다음 [전"),
        s.feed("화1] 확인"),
        s.flush(),
    ]
    assert "".join(out) == "안녕하세요 홍길동님. 다음 010-1234-5678 확인"
    assert out[0] == "안녕하세요 "


def test_stream_releases_non_placeholder_bracket():
    s = _m().stream()
    assert s.feed("배열 [") == "배열 "
    assert s.feed("0] 값") == "[0] 값"
    assert s.flush() == ""


def test_stream_flushes_tail():
    s = _m().stream()
    assert s.feed("끝 [이름") == "끝 "
    assert s.flush() == "[이름"


def test_mask_system_and_messages_keep_shape_and_order():
    m = Masker(["홍길동"])
    system = [
        {"type": "text", "text": "규칙"},
        {
            "type": "text",
            "text": "이력서\n홍길동 010-1234-5678",
            "cache_control": {"type": "ephemeral"},
        },
    ]
    msgs = [
        {"role": "user", "content": "시작"},
        {"role": "assistant", "content": "홍길동님 소개해 주세요"},
        {"role": "user", "content": "제 메일은 a@b.co 입니다"},
    ]
    got_s = m.mask_system(system)
    got_m = m.mask_messages(msgs)
    assert got_s[1] == {
        "type": "text",
        "text": "이력서\n[이름1] [전화1]",
        "cache_control": {"type": "ephemeral"},
    }
    assert [x["content"] for x in got_m] == [
        "시작",
        "[이름1]님 소개해 주세요",
        "제 메일은 [이메일1] 입니다",
    ]
    assert system[1]["text"].endswith("010-1234-5678")  # 원본은 그대로


def test_numbering_is_stable_when_history_grows():
    system = [{"type": "text", "text": "홍길동 010-1234-5678"}]
    turn1 = [{"role": "user", "content": "a@b.co"}]
    turn2 = [*turn1, {"role": "user", "content": "c@d.co 그리고 a@b.co"}]
    m1, m2 = Masker(["홍길동"]), Masker(["홍길동"])
    s1, s2 = m1.mask_system(system), m2.mask_system(system)
    assert s1 == s2
    assert m2.mask_messages(turn2)[0] == m1.mask_messages(turn1)[0]
    assert m2.mask_messages(turn2)[1]["content"] == "[이메일2] 그리고 [이메일1]"
