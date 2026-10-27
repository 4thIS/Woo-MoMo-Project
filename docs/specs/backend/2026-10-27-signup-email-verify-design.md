# 가입 이메일 인증(PIN) — 설계 (spec, 백엔드)

- 생성일시: 2026-10-27
- 수정일시: 2026-10-27

## 0. 배경 · 위치

지금 가입(`POST /api/auth/signup`)은 이메일·비밀번호·이름·동의를 받자마자 계정을 만든다. 이메일이 본인 것인지 확인하지 않아, 남의 이메일로 먼저 가입해 그 주소를 선점할 수 있다. `ADMIN_EMAILS`는 이 때문에 "본인이 먼저 가입한 뒤 목록에 넣는다"는 운영 절차에 기대고 있다(`deploy/README.md` 관리자 절).

가입 때 메일로 6자리 PIN을 보내고, **PIN을 확인한 뒤에만 계정을 만든다.** 메일 발송은 개인 메일 API(`send.ssenu.cloud`)를 쓴다.

## 1. 목표 · 비목표

### 목표
- 새 가입은 메일로 받은 PIN이 맞아야만 계정이 만들어진다. "미인증 계정" 상태는 만들지 않는다.
- PIN은 해시로만 저장하고, 10분 만료·5회 오답 폐기·재발송 제한으로 추측과 메일 남용을 막는다.
- 설정 `SIGNUP_EMAIL_VERIFY`(기본 꺼짐)로 단계적으로 켠다. 꺼져 있으면 가입은 지금과 바이트 단위로 같다.

### 비목표
- 비밀번호 찾기·재설정, 이메일 변경 인증
- 기존 계정 재인증 — 이미 가입한 계정은 인증된 것으로 둔다(바꾸지 않음)
- 메일 링크 방식, HTML 메일
- 가입 화면 구현(프론트 이슈)

## 2. 데이터 · 계약

- `/api` 변경: 있음(additive) — 엔드포인트 2개 추가, 가입 요청에 `code` 칸 추가. lockstep: 백엔드(꺼진 채) 먼저 배포 → 프론트 → 설정 켜기.
- 마이그레이션 `008_signup_codes.sql`: 새 테이블 `signup_codes`, 이메일당 한 줄.
  - 칸: `email`(기본 키, 소문자 정규화), `code_hash`, `expires_at`, `attempts`(오답 수), `last_sent_at`, `window_start`, `window_count`(최근 1시간 발송 수)
  - `users` 테이블은 바꾸지 않는다.
- PIN 원문은 메일 본문에만 있다. DB·로그·응답 어디에도 남기지 않는다.

## 3. 규칙 · 제약

### PIN
| 항목 | 값 |
|---|---|
| 형식 | 숫자 6자리, `secrets`로 생성(앞자리 0 허용) |
| 유효 시간 | 발송 후 10분 |
| 오답 | 같은 PIN 5회 틀리면 폐기 → 다시 받아야 함 |
| 다시 받기 | 같은 이메일 60초 뒤부터. 새로 보내면 이전 PIN은 즉시 무효(가장 최근 PIN 하나만 유효) |
| 이메일당 발송 상한 | 1시간에 5통 |
| 요청 출처(IP)당 | `POST /api/auth/signup/code` 1분에 5회(기존 `rate_limit` 사용) |
| 가입 성공 | 계정 생성과 PIN 줄 삭제를 한 트랜잭션에서 — 같은 PIN 재사용 불가 |

- 이미 가입한 이메일이면 PIN을 보내지 않고 `409 email_taken`. 가입 여부는 이미 `/api/auth/email-taken`으로 알 수 있어 새로 드러나는 정보는 없다.
- 만료된 줄은 다음 요청 때 덮어쓰거나 서버 기동 때 정리한다.
- PIN 비교는 해시끼리 상수 시간 비교(`hmac.compare_digest`).
- 해시는 평문 `sha256(email:code)`다. PIN이 10분·1회용이라 HMAC 키까지는 필요 없다고 판단했다.
- 오답 시도는 비교 전에 한 트랜잭션에서 원자적으로 예약한다(`attempts + 1`, 5 미만·미만료일 때만). 동시에 틀린 추측도 줄을 서서 5번을 넘기지 못한다.

### 메일 발송
- `POST {MAIL_API_URL}`(기본 `https://send.ssenu.cloud/v1/send`), 헤더 `Authorization: Bearer {MAIL_API_KEY}`·`Content-Type: application/json`·`Idempotency-Key: signup-<발송마다 새 무작위 값>`, 본문 `{"to","subject","text"}`. 시간 제한 10초.
- 제목 `[모두의 모의면접] 가입 인증번호`. 본문(text)에 PIN 6자리, "10분 안에 입력해 주세요", "가입을 요청하지 않았다면 이 메일은 무시하셔도 됩니다."
- **메일이 실제로 나간 뒤에만** 새 PIN을 저장한다. 발송 실패(오류 응답·시간 초과)는 `502 mail_failed`이며, 60초 대기·1시간 발송 수에 세지 않고 이전 PIN도 그대로 둔다.
- 로그에는 예외 이름만. PIN·메일 주소·키는 남기지 않는다(CLAUDE.md 8번).

### 설정 (`deploy/.env`, 커밋 금지)
| 변수 | 기본 | 뜻 |
|---|---|---|
| `SIGNUP_EMAIL_VERIFY` | `false` | 켜면 가입에 PIN 필요 |
| `MAIL_API_KEY` | (없음) | 메일 API 키 |
| `MAIL_API_URL` | `https://send.ssenu.cloud/v1/send` | 발송 주소 |

- 켰는데 `MAIL_API_KEY`가 비어 있으면 PIN 요청이 `503 mail_unavailable` → 가입이 막힌다. 설정 실수로 인증이 조용히 빠지지 않게 한다.
- `Settings`의 `mail_api_key`는 repr에 나오지 않는다(`repr=False`).

## 4. 인터페이스 계약 (`docs/API.md`에 추가)

### ① `POST /api/auth/signup/code` — 인증번호 받기
- 요청 `{ "email": "me@example.com" }` → `202 { "expiresInSec": 600, "resendInSec": 60 }`

| 상태 | 오류 코드 | 뜻 |
|---|---|---|
| 404 | `verify_disabled` | 인증 기능이 꺼져 있음 |
| 422 | `invalid_email` (`field: "email"`) | 이메일 형식 오류 |
| 409 | `email_taken` | 이미 가입한 이메일(메일 안 보냄) |
| 429 | `rate_limited` | 같은 출처 1분 5회 초과 |
| 429 | `code_cooldown` + `retryAfterSec` | 60초 안에 다시 요청 |
| 429 | `code_limit` | 그 이메일 1시간 5통 초과 |
| 503 | `mail_unavailable` | 켜졌는데 키 없음 |
| 502 | `mail_failed` | 메일 서버 오류·시간 초과 |

### ② `POST /api/auth/signup` — 가입 (`code` 칸 추가)
- 본문에 `code: string`(기본 빈 문자열) 추가. 나머지 칸·응답은 그대로.
- 꺼져 있으면 `code`는 무시, 지금과 같다.
- 켜져 있으면 확인 순서:
  1. 지금의 칸 검사(이메일 형식·비밀번호·이름·동의)
  2. PIN(오류 모두 `field: "code"`): 비었으면 `422 code_required` / 줄 없음·만료·폐기면 `422 code_expired` / 틀리면 `422 code_invalid` + `attemptsLeft`, 5번째 오답이면 폐기하고 `code_expired`
  3. 이미 가입한 이메일이면 `409 email_taken`(지금과 같음)
  4. 계정 생성 + PIN 줄 삭제(한 트랜잭션) → `201`, 로그인 상태(지금과 같음)
- 기존 가입 요청 수 제한(분당 10회)은 그대로.

### ③ `GET /api/auth/signup/config` — 인증 사용 여부
- `200 { "emailVerify": true | false }`. 프론트가 PIN 칸 표시를 정한다 → 서버 설정만 바꿔도 화면이 따라온다.

### 내부 인터페이스
| 함수 | 설명 |
|---|---|
| `app/mail.py`: `Mailer.send(to, subject, text, idempotency_key)` | 실제 발송(`HttpMailer`, httpx), 실패는 `MailError`. 테스트는 가짜 발송기 |
| `app/repos/signup_codes.py` | PIN 줄 읽기·저장(발송 후)·오답 증가·삭제 |

## 5. 영역별 영향

- backend: `app/mail.py`(신규), `app/repos/signup_codes.py`(신규), `app/routers/auth.py`, `app/schemas.py`(`SignupBody.code`, 응답 모델), `app/config.py`, `app/main.py`(발송기 주입), 마이그레이션 008, `docs/API.md`
- deploy: `docker-compose.yml` api 환경변수 3개(`SIGNUP_EMAIL_VERIFY`·`MAIL_API_KEY`·`MAIL_API_URL`), `deploy/README.md` 절 — 공동 영역, @leemonta9482 리뷰
- frontend(이슈로 요청): `GET /api/auth/signup/config`가 켜짐이면 가입 화면에 "인증번호 받기" 버튼·6자리 입력, 60초 재발송 타이머·10분 남은 시간, 오류 코드별 안내, 가입 요청에 `code`

## 6. 무회귀 · 롤아웃

- `SIGNUP_EMAIL_VERIFY=false`면 가입 요청·응답이 지금과 같다(기존 가입 테스트 수정 없이 통과). 기존 계정 로그인 영향 없음.
- 순서:
  1. 백엔드 PR(꺼진 채) → dev, demomo `.env`에 `MAIL_API_KEY`
  2. demomo에서 잠깐 켜고 curl로 `cwhappy123@gmail.com`에 실제 발송 1회 확인 → 끄기
  3. 프론트 이슈 구현·dev 머지 → demomo에서 켜고 화면으로 가입 1회
  4. 메일 API 키 교체(채팅에 노출됨) → dev → main(merge commit) → 운영 `.env`에 키·켜기

## 7. 성공 기준

- 테스트: 발송 요청 형식(헤더·본문·Idempotency-Key)·실패 변환·로그 무노출 / 인증번호 받기 성공·`code_cooldown`·`code_limit`·`rate_limited`·`email_taken`(메일 안 나감)·`mail_failed`(횟수 미반영, 이전 PIN 유지)·`verify_disabled`·`mail_unavailable` / 가입 꺼짐 동일·맞는 PIN 201 + 줄 삭제·`code_required`·`code_invalid`(`attemptsLeft` 감소)·5회째 `code_expired`·10분 만료(가짜 시계)·재발송 후 이전 PIN 무효·같은 PIN 재사용 불가·DB에 원문 없음 / 설정 조회 / 마이그레이션 008이 기존 DB에 적용되고 기존 계정 로그인 유지.
- demomo: 실제 메일로 PIN을 받아 화면에서 가입 1회 완료.
