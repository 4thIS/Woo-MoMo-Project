import time

import pytest

from app.llm.pii import Masker, names_in

RESUME = """이름: 홍길동
생년월일: 1999.03.15
연락처: 010-1234-5678 / gildong@Example.com
주소: 서울특별시 강남구 테헤란로 123, 101동 1203호
GitHub: https://github.com/gildong-hong
블로그: gildong.tistory.com
학력: 한국대학교 컴퓨터공학과 (2018.03 ~ 2024.02)
프로젝트: 결제 서비스 데모 https://pay-demo.example.com (2023.05.20 수상)
"""


def test_resume_is_masked_in_order():
    m = Masker(["홍길동"])
    got = m.mask(RESUME)
    assert got.splitlines()[:6] == [
        "이름: [이름1]",
        "생년월일: [생년월일1]",
        "연락처: [전화1] / [이메일1]",
        "주소: [주소1]",
        "GitHub: [링크1]",
        "블로그: [링크2]",
    ]
    # 학교·라벨 없는 날짜·회사/데모 링크는 남는다
    assert "한국대학교 컴퓨터공학과 (2018.03 ~ 2024.02)" in got
    assert "https://pay-demo.example.com (2023.05.20 수상)" in got
    assert m.counts == {"이름": 1, "생년월일": 1, "전화": 1, "이메일": 1, "주소": 1, "링크": 2}


def test_same_value_same_placeholder_across_texts():
    m = Masker(["홍길동"])
    assert m.mask("010-1234-5678") == "[전화1]"
    assert m.mask("01012345678로 연락") == "[전화1]로 연락"
    assert m.mask("+82 10-1234-5678") == "[전화1]"
    assert m.mask("GILDONG@example.com") == "[이메일1]"
    assert m.mask("gildong@example.com, a@b.co") == "[이메일1], [이메일2]"


@pytest.mark.parametrize(
    "text",
    [
        "매출 2,000,000원, 사용자 1234-5678명",
        "2023.05.20에 배포",
        "서울 거주, 경기도 성남시 근무",
        "https://www.toss.im/career",
        "지원자로서 지원 동기",
        "주문번호 2023-1234-5678",
    ],
)
def test_things_that_must_stay(text):
    assert Masker(["지원"]).mask(text) == text


def test_two_letter_name_not_inside_words():
    m = Masker(["이산"])
    assert m.mask("이산이 말했다") == "[이름1]이 말했다"
    assert m.mask("분산이산화") == "분산이산화"


def test_given_name_only_with_honorific():
    m = Masker(["홍길동"])
    assert m.mask("길동님, 자기소개 부탁드립니다") == "[이름1]님, 자기소개 부탁드립니다"
    assert m.mask("길동씨") == "[이름1]씨"
    assert m.mask("길동 프로젝트") == "길동 프로젝트"


def test_english_name_word_boundary_case_insensitive():
    m = Masker(["Gildong Hong"])
    assert m.mask("I am GILDONG HONG.") == "I am [이름1]."
    assert m.mask("Gildong Hongkong") == "Gildong Hongkong"


def test_rrn_card_account():
    m = Masker()
    assert m.mask("주민번호 990315-1234567") == "주민번호 [주민번호1]"
    assert m.mask("카드 1234-5678-9012-3456") == "카드 [계좌1]"
    assert m.mask("입금 계좌: 국민은행 123456-01-234567") == "입금 계좌: 국민은행 [계좌2]"
    # 이미 계좌로 가린 값은 라벨 없이도 다시 가린다 — 라벨 규칙은 새 Masker로 본다
    assert Masker().mask("학번 123456-01-234567") == "학번 123456-01-234567"


def test_landline_needs_hyphens():
    m = Masker()
    assert m.mask("02-123-4567") == "[전화1]"
    assert m.mask("021234567") == "021234567"


def test_birth_and_address_need_labels():
    m = Masker()
    assert m.mask("생일 99년 3월 15일") == "생일 [생년월일1]"
    assert m.mask("Birth: 1999-03-15") == "Birth: [생년월일2]"
    assert m.mask("거주지: 부산 해운대구 우동 1408") == "거주지: [주소1]"
    assert m.mask("부산광역시 해운대구 센텀중앙로 79 근처") == "[주소2] 근처"


def test_existing_placeholders_are_untouched():
    m = Masker(["홍길동"])
    assert m.mask("[이름1]님 010-1234-5678") == "[이름1]님 [전화1]"


def test_personal_link_kinds():
    m = Masker()
    for url in [
        "github.com/abc",
        "https://velog.io/@abc/post",
        "blog.naver.com/abc",
        "https://www.linkedin.com/in/abc-1",
        "abc.notion.site/Resume-1",
        "abc.github.io",
        "https://brunch.co.kr/@abc",
        "medium.com/@abc",
        "instagram.com/abc",
        "gitlab.com/abc",
    ]:
        assert m.mask(url).startswith("[링크"), url


def test_names_in_resume_labels():
    assert names_in("이름: 홍길동\n성명 : 김철수\nName: Gildong Hong\n이름 없음") == [
        "홍길동",
        "김철수",
        "Gildong Hong",
    ]


@pytest.mark.parametrize(
    "text",
    [
        "0-" * 10_000,
        "1" * 20_000,
        "a@" * 10_000,
        "서울시 " * 5_000,
        "생년월일 " + "1." * 9_995,
        "계좌 " + "1-" * 9_997,
        "주소: " + "가 " * 9_996,
        "github.com/" + "a" * 19_989,
        "가" * 20_000,
        "서울시강남구" * 3_000,
        "주소:" + "가" * 20_000,
        "주소: x" + " " * 20_000 + "y",
        "주소: " + "(010-1234-5678) " * 1_200,
        "주소: a@b.co 서울 1\n" * 1_200,
        "| 주소: x " * 2_500,
        "가은행" * 6_000,
    ],
    ids=[
        "dash",
        "digits",
        "at",
        "seoul",
        "birth",
        "account",
        "address",
        "github",
        "hangul",
        "city-run",
        "address-run",
        "address-spaces",
        "address-phones",
        "address-lines",
        "address-fields",
        "bank-run",
    ],
)
def test_adversarial_long_text_is_fast(text):
    start = time.perf_counter()
    Masker(["홍길동", "Gildong Hong"]).mask(text)
    assert time.perf_counter() - start < 0.5


# ── 보강 1차 ──


def test_labelled_address_stops_before_phone_or_email():
    m = Masker()
    assert m.mask("주소: 마포구 망원동 123-4 (010-1234-5678)") == "주소: [주소1] ([전화1])"
    assert m.mask("주소: 경기도 성남시 분당구 정자동 12 / gildong@ex.com") == (
        "주소: [주소2] / [이메일1]"
    )
    assert m._values["[주소1]"] == "마포구 망원동 123-4"
    assert m._values["[주소2]"] == "경기도 성남시 분당구 정자동 12"


@pytest.mark.parametrize(
    "text",
    [
        "웹 주소: https://pay-demo.example.com",
        "서비스 주소: https://www.toss.im",
        "IP 주소: 192.168.0.1",
        "Email address: none",
    ],
)
def test_address_label_only_at_line_start(text):
    assert Masker().mask(text) == text


def test_address_label_after_bullet():
    m = Masker()
    assert m.mask("- 주소: 서울 마포구 망원동 1") == "- 주소: [주소1]"
    assert m.mask("• 거주지: 부산 해운대구") == "• 거주지: [주소2]"
    assert m.mask("학력\n  주소: 대구 수성구 1\n끝") == "학력\n  주소: [주소3]\n끝"


def test_account_label_needs_account_word_or_bank_name():
    m = Masker()
    assert m.mask("은행 앱 개발: 거래 1234567890건") == "은행 앱 개발: 거래 1234567890건"
    assert m.mask("신한은행 110-123-456789") == "신한은행 [계좌1]"
    assert m.mask("입금 계좌: 국민은행 123456-01-234567") == "입금 계좌: 국민은행 [계좌2]"


def test_plus82_rewrite_only_for_phones():
    m = Masker()
    # 82로 시작하는 계좌번호는 0으로 바꾸지 않는다(다른 계좌와 섞이지 않게)
    assert m.mask("계좌 8212345678901") == "계좌 [계좌1]"
    assert m.mask("계좌 012345678901") == "계좌 [계좌2]"
    assert m._values["[계좌1]"] == "8212345678901"


@pytest.mark.parametrize(
    "text",
    [
        "010 - 1234 - 5678",
        "(010)1234-5678",
        "(010) 1234-5678",
        "+82 010-1234-5678",
        "+82 10-1234-5678",
        "+82-10-1234-5678",
        "010.1234.5678",
        "010 1234 5678",
    ],
)
def test_phone_formats_share_one_placeholder(text):
    m = Masker()
    m.mask("010-1234-5678")
    assert m.mask(f"연락처 {text} 입니다") == "연락처 [전화1] 입니다"


def test_labelled_address_masks_every_segment_between_taken_spans():
    m = Masker()
    assert m.mask("주소: 010-1234-5678 서울 마포구 망원동 1") == "주소: [전화1] [주소1]"
    assert m._values["[주소1]"] == "서울 마포구 망원동 1"
    assert m.mask("주소: 서울 마포구 (010-1234-5678) 망원동 1 / a@b.co") == (
        "주소: [주소2] ([전화1]) [주소3] / [이메일1]"
    )
    assert m.mask("주소: 010-1234-5678 / a@b.co") == "주소: [전화1] / [이메일1]"


# ── 보강 3차 ──


def test_address_label_after_field_separator_or_numbered_bullet():
    m = Masker()
    assert m.mask("생년월일: 1999.03.15 | 주소: 서울 강남구 역삼동 123-4") == (
        "생년월일: [생년월일1] | 주소: [주소1]"
    )
    assert m.mask("1. 주소: 서울 마포구 망원동 1") == "1. 주소: [주소2]"
    assert m.mask("2) 주소: 부산 해운대구 우동 1") == "2) 주소: [주소3]"
    assert m.mask("주소지: 대구 수성구 범어동 1") == "주소지: [주소4]"
    assert m.mask("현 주소: 광주 북구 1") == "현 주소: [주소5]"
    assert m.mask("현주소: 광주 남구 2") == "현주소: [주소6]"


@pytest.mark.parametrize(
    "text",
    [
        "웹 주소: https://pay-demo.example.com",
        "IP 주소: 192.168.0.1",
        "프로젝트 주소: https://pay-demo.example.com",
        "주소록 앱 개발",
        "- 주소 검색 API 연동",
        "Email address: none",
    ],
)
def test_address_label_still_not_mid_sentence(text):
    assert Masker().mask(text) == text


def test_address_label_value_ends_at_next_field():
    m = Masker()
    assert m.mask("주소: 서울 마포구 망원동 1 | 연락처: 010-1234-5678 | 이메일: a@b.co") == (
        "주소: [주소1] | 연락처: [전화1] | 이메일: [이메일1]"
    )
    assert m._values["[주소1]"] == "서울 마포구 망원동 1"
    assert m.mask("Address: 서울 마포구 / Tel: 010 1234 5678") == "Address: [주소2] / Tel: [전화1]"
    assert m.mask("이름: x | 주소: 부산 해운대구 | 거주지: 대구 수성구") == (
        "이름: x | 주소: [주소3] | 거주지: [주소4]"
    )


@pytest.mark.parametrize(
    "text",
    [
        "Accountability 리포트 1234567890 건",
        "AWS account 123456789012",
        "은행 앱 개발: 거래 1234567890건",
    ],
)
def test_account_context_must_be_korean_label_or_bank(text):
    assert Masker().mask(text) == text


def test_any_bank_name_right_before_number():
    m = Masker()
    assert m.mask("부산은행 123-45-678901") == "부산은행 [계좌1]"
    assert m.mask("환불은 대구은행: 1234567890 으로") == "환불은 대구은행: [계좌2] 으로"


# ── 최종 검토 ──

LEAK_RESUME = (
    "이름: 홍길동\n생년월일: 1999.01.02\n주소: 서울 강남구 역삼동 123-4\n신한은행 110-123-456789\n"
)


def test_known_values_are_masked_again_without_labels():
    # 되돌린 값이 라벨 없이 다음 요청에 다시 나와도 같은 표시로 가린다
    m = Masker(["홍길동"])
    assert m.mask(LEAK_RESUME).splitlines() == [
        "이름: [이름1]",
        "생년월일: [생년월일1]",
        "주소: [주소1]",
        "신한은행 [계좌1]",
    ]
    got = m.mask("서울 강남구 역삼동 123-4에서 다니셨군요. 1999.01.02생이고 110-123-456789로")
    assert got == "[주소1]에서 다니셨군요. [생년월일1]생이고 [계좌1]로"


def test_known_values_inside_same_text_are_masked():
    m = Masker()
    got = m.mask("주소: 서울 강남구 역삼동 123-4\n집은 서울 강남구 역삼동 123-4입니다")
    assert got == "주소: [주소1]\n집은 [주소1]입니다"


def test_known_value_needs_digit_boundary():
    m = Masker()
    m.mask("생년월일: 1999.01.02")
    assert m.mask("21999.01.023") == "21999.01.023"


def test_known_values_long_text_is_fast():
    m = Masker(["홍길동"])
    m.mask(LEAK_RESUME)
    text = "서울 강남구 역삼동 123-4 1999.01.02 " * 2_000
    start = time.perf_counter()
    m.mask(text)
    assert time.perf_counter() - start < 0.5


@pytest.mark.parametrize(
    ("name", "text", "want"),
    [
        ("남궁민수아", "지원자는 남궁민수아", "지원자는 [이름1]"),
        ("남궁민수아", "남궁민수아님", "[이름1]님"),
        ("남궁민수아", "김남궁민수아", "김남궁민수아"),
        ("Alex", "지원자는 Alex", "지원자는 [이름1]"),
        ("Alex", "ALEX입니다", "[이름1]입니다"),
        ("Alex", "Alexander", "Alexander"),
        ("홍 길동", "지원자는 홍 길동", "지원자는 [이름1]"),
        ("Kim 민수", "Kim 민수입니다", "[이름1]입니다"),
    ],
)
def test_other_known_names_match_literally(name, text, want):
    assert Masker([name]).mask(text) == want


def test_one_letter_names_are_ignored():
    assert Masker(["A", "김"]).mask("A 김") == "A 김"


# ── 저장소 링크는 소유자만 가린다 (이슈 #182 ①, 2026-11-10) ──


def test_repo_link_masks_only_the_owner():
    m = Masker()
    got = m.mask("회사 저장소 https://github.com/4thIS/Woo-MoMo-Project 에서 작업")
    assert got == "회사 저장소 https://github.com/[링크1]/Woo-MoMo-Project 에서 작업"
    assert m.unmask(got) == "회사 저장소 https://github.com/4thIS/Woo-MoMo-Project 에서 작업"


def test_repo_link_deeper_paths_and_gitlab():
    m = Masker()
    assert m.mask("github.com/gildong/my-blog/tree/main") == "github.com/[링크1]/my-blog/tree/main"
    assert m.mask("https://gitlab.com/gildong/infra") == "https://gitlab.com/[링크1]/infra"


def test_profile_link_is_still_masked_whole():
    m = Masker()
    assert m.mask("GitHub: https://github.com/gildong-hong") == "GitHub: [링크1]"
    assert m.mask("github.com/gildong-hong/") == "[링크1]"


def test_same_owner_same_placeholder_and_owner_not_masked_elsewhere():
    m = Masker()
    got = m.mask("github.com/toss/slash, github.com/toss/es-toolkit, 그리고 https://toss.im/career")
    assert (
        got
        == "github.com/[링크1]/slash, github.com/[링크1]/es-toolkit, 그리고 https://toss.im/career"
    )
