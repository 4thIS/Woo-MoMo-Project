# Woo-MoMo 모의면접 사이트 설계 문서

- 작성일: 2026-09-15
- 상태: 승인됨 (브레인스토밍 완료)
- 마감: 2026-09-21 (D-6)

## 1. 목적과 제약

**목적**: 포트폴리오 겸 공모전 데모. 브라우저 안에서 로컬 LLM(Gemma 4)이 면접관 역할을 하는 모의면접 사이트.

**핵심 가치**: 이력서, 대화, 리포트가 사용자 기기를 떠나지 않는다. 서버는 정적 자산과 설정만 내려준다.

**제약**
- 마감 6일. "데모 당일 끝까지 돌아가는 것"이 최우선.
- 배포는 개인 라즈베리파이 웹서버. 도메인·리버스 프록시는 이미 존재하며, 이 프로젝트는 docker-compose 구성까지만 담당.
- 실행 환경은 WebGPU를 지원하는 Chrome (데스크톱/노트북, 전용 GPU 권장).

**결정 사항 요약**

| 항목 | 결정 |
|---|---|
| 모델 | 공식 Gemma 4 E4B instruction-tuned, 웹용 `.litertlm`. 파인튜닝은 별도 트랙, 성공 시 매니페스트 교체로 반영 |
| LLM 흐름 | 단일 채팅 세션(접근 1). 시스템 프롬프트 하나로 면접 전체 진행. 프론트는 흐름을 통제하지 않음 |
| 면접 형식 | 화면에 면접관 3명, 발화는 가운데 1명. 이력서 기반 질문 5개, 답변별 꼬리질문 최대 2개, 종료 후 점수 없는 답변별 피드백 리포트 |
| 질문 출처 | 모델이 이력서·분야를 읽고 생성. 폴백 질문 세트는 서버 API에서 제공 |
| 이력서 | 브라우저에서 pdf.js로 텍스트 추출, 서버 전송 없음, 약 2,000자 절단 |
| 음성 입력 | Web Speech API. 인식 결과를 입력창에 채우고 사용자가 확인 후 전송 |
| 프론트 | Vite + Vue 3 + TypeScript + Pinia |
| 백엔드 | FastAPI(얇게: 매니페스트, 폴백 질문, 헬스체크) + nginx(정적·모델 서빙) |
| 배포 | docker-compose, linux/arm64, 모델 파일은 호스트 볼륨 |

**의도적으로 제외한 것**: 로그인/계정, 리포트 서버 저장, 서버 추론 폴백, 브라우저 내 Whisper, 점수 산출, 여러 면접관 동시 발화.

## 2. 전체 아키텍처

```
[사용자 브라우저 (Chrome, WebGPU)]
  Vue 3 SPA
  ├─ pdf.js        : 이력서 PDF → 텍스트 (기기 내)
  ├─ MediaPipe LLM : Gemma 4 E4B .litertlm 실행 (WebGPU)
  ├─ Cache API     : 모델 파일 캐시
  └─ Web Speech    : 음성 → 텍스트
          │ HTTPS (기존 리버스 프록시 → web:80)
[라즈베리파이 · docker-compose]
  ├─ web (nginx)  : Vue 빌드 정적 파일, /models/*.litertlm (Range 지원), /api → api 프록시
  └─ api (FastAPI): GET /api/manifest, GET /api/questions/{field}, GET /api/health
```

**저장소 구조**
```
frontend/   Vite + Vue 3 + TS
backend/    FastAPI + data/(manifest.json, questions/*.json)
deploy/     docker-compose.yml, nginx.conf, Dockerfile들
finetune/   Colab 노트북, 데이터셋 생성 스크립트 (사이트 코드와 독립)
docs/       설계 문서, 데모 체크리스트
```

## 3. 프론트엔드

### 3.1 화면 흐름
네 화면을 하나의 SPA 안에서 상태로 전환한다. 라우터는 쓰지 않는다.

**(1) 랜딩 + 동의 화면 `LandingView`**
- 사이트 소개: 어떤 모의면접 사이트인지, 면접관 AI가 브라우저 안에서 실행되며 이력서가 서버로 가지 않는다는 설명.
- 모델 다운로드 안내: 매니페스트에서 받은 모델 이름·용량(약 4GB)·저장 위치(브라우저 캐시)를 표시. "동의하고 다운로드" 버튼.
- WebGPU 미지원(`navigator.gpu` 없음)이면 여기서 안내하고 진행을 막는다.
- Cache API에 모델이 이미 있으면 동의 화면을 건너뛰고 준비 화면으로 간다.

**(2) 준비 화면 `PrepareView`** — 다운로드와 입력을 동시에 진행
- 상단: 캐릭터 프로그레스바. 도트 캐릭터(면접 지원자)가 진행률만큼 면접실 문을 향해 걸어간다. 퍼센트와 수신 용량을 함께 표시. 다운로드 완료 후 "모델 초기화 중"(GPU 로드) 단계를 별도 표시.
- 하단: 기업 분야 선택(IT/금융/제조/유통/기타), 지원 직무 텍스트 입력, 이력서 PDF 드롭존. 업로드 즉시 pdf.js로 추출해 미리보기를 보여주고 약 2,000자로 절단됨을 안내.
- "면접 시작" 버튼은 **모델 준비 완료 AND 필수 입력(분야·직무·이력서) 완료**일 때만 활성화. 어느 조건이 남았는지 버튼 옆에 표시.
- 다운로드 실패 시 재시도 버튼.

**(3) 면접 화면 `InterviewView`**
- 상단: 면접실 배경 위에 도트 면접관 3명(`InterviewerSprite` × 3). 가운데 면접관만 말풍선(`SpeechBubble`)이 뜨고 스트리밍 텍스트가 타이핑되듯 채워진다. 말하는 동안 입 스프라이트를 2프레임으로 교체.
- 하단: 대화 로그(스크롤), 텍스트 입력창, 마이크 버튼(`MicButton`), 전송 버튼, 면접 종료 버튼.
- 마이크는 누르고 있는 동안 인식하고 결과를 입력창에 채운다. 전송은 사용자가 직접 한다.
- 모델이 생성 중이면 입력을 비활성화하고 중단 버튼을 표시한다.

**(4) 리포트 화면 `ReportView`**
- 문항별 카드: 질문 / 답변 요약 / 피드백. 점수 없음.
- 텍스트 복사 버튼, "다시 면접 보기" 버튼(시작 화면으로 복귀, 세션 초기화).
- 리포트는 브라우저 내에서만 존재한다.

### 3.2 모듈 구조
```
src/
  views/        LandingView, PrepareView, InterviewView, ReportView
  components/   InterviewerSprite, SpeechBubble, MicButton, CharacterProgress, ResumeDropzone, ReportCard
  services/
    llm.ts          MediaPipe 초기화, 채팅 템플릿 조립, 스트리밍 생성, 중단
    modelCache.ts   다운로드(tee + 진행률), Cache API 저장, 무결성 확인
    pdf.ts          pdf.js 텍스트 추출과 절단
    speech.ts       Web Speech API 래퍼
    api.ts          /api/manifest, /api/questions 호출
  stores/
    model.ts        다운로드 상태·진행률·초기화 상태·준비 완료 플래그
    interview.ts    단계, 프로필(분야·직무), 이력서 텍스트, 대화 이력, 리포트
  prompts/
    interviewer.ts  시스템 프롬프트 템플릿
    report.ts       리포트 지시문
  utils/
    template.ts     채팅 템플릿 조립 (순수 함수)
    thoughts.ts     thought 태그 스트리밍 제거 (순수 함수)
    tokens.ts       토큰 근사 계산
    reportParser.ts 리포트 JSON 파싱과 폴백
```
`stores/model.ts`와 `stores/interview.ts`의 준비 완료 플래그를 합쳐 "면접 시작" 활성화를 결정한다.

### 3.3 도트 그래픽
- 면접관 3인 각 2프레임(기본/말하기) 스프라이트 시트, 면접실 배경 1장, 프로그레스바용 지원자 캐릭터 걷기 프레임. PNG.
- CSS `image-rendering: pixelated`로 확대. 게임 엔진 없음.
- 그래픽 제작은 별도 작업이며, 준비 전에는 색 블록 플레이스홀더로 개발한다.

## 4. LLM 상호작용 (접근 1: 단일 채팅 세션)

### 4.1 세션 구성
- `LlmInference`를 앱에서 한 번 생성해 재사용. 옵션: `maxTokens: 8192`, `temperature: 0.7`, `topK: 40`.
- 채팅 템플릿은 직접 조립한다(MediaPipe는 템플릿을 자동 적용하지 않음). 템플릿 문자열은 하드코딩하지 않고 매니페스트의 `template` 필드에서 받는다.
- `thought` 태그 제거는 스트리밍 중에도 동작한다. 여는 태그를 만나면 닫는 태그가 올 때까지 화면 출력을 보류한다.

### 4.2 시스템 프롬프트 (`prompts/interviewer.ts`)
한 번만 넣고 면접 전체를 같은 대화로 진행한다. 골자:
- 역할: 지원 분야의 면접관. 한국어, 존댓말, 한 번에 질문 하나만, 질문은 짧게.
- 입력: 기업 분야, 지원 직무, 이력서 텍스트(약 2,000자), 폴백 질문 5개(참고용).
- 절차: 이력서 기반 질문 5개를 순서대로 진행. 답변이 부족하거나 흥미로우면 꼬리질문 최대 2개. 5개가 끝나면 정확히 "면접을 마치겠습니다"라는 문장으로 종료를 알린다.
- 금지: 리포트 전까지 답변 평가·점수 언급 금지, 여러 질문 동시 제시 금지.
- 매니페스트 `systemPromptOverride`가 있으면 그것으로 대체한다(파인튜닝 모델용).

### 4.3 턴 처리
- 사용자 답변을 user 턴으로 추가하고 스트리밍 생성. 프론트는 흐름을 통제하지 않고 출력을 그대로 말풍선에 표시한다.
- 안전장치는 두 가지만 둔다.
  1. 모델 응답에 종료 문장("면접을 마치겠습니다")이 포함되거나 사용자가 "면접 종료"를 누르면 리포트 단계로 이동.
  2. 대화 이력 토큰 근사치가 6,500을 넘으면 입력을 막고 종료를 유도한다. 근사는 한글 1자 = 1토큰, 그 외 4자 = 1토큰으로 계산한다(정확한 토크나이저 불필요, 보수적 추정).

### 4.4 리포트 생성
- 같은 세션에 리포트 지시문(`prompts/report.ts`)을 user 턴으로 추가한다: 지금까지의 질문과 답변을 문항별로 정리하고 각 답변에 대한 피드백을 아래 JSON 형식으로만 출력.
- 형식: `[{ "question": "...", "answerSummary": "...", "feedback": "..." }]`
- 파싱 실패 시 원문을 카드 하나에 그대로 표시한다.

### 4.5 매니페스트 형식
```json
{
  "id": "gemma4-e4b-it",
  "url": "/models/gemma4-e4b-it-web.litertlm",
  "size": 4400000000,
  "template": { "turnStart": "<|turn>", "turnEnd": "<turn|>", "roles": { "system": "system", "user": "user", "model": "model" } },
  "systemPromptOverride": null,
  "fallback": { "id": "gemma4-e2b-it", "url": "/models/gemma4-e2b-it-web.litertlm", "size": 2000000000 }
}
```
- `template` 값은 참고 코드(C:\MyCode\localLLM)의 토큰을 초기값으로 쓰되, D-6에 실제 모델 토크나이저와 대조해 확정한다.
- `fallback`은 E4B 초기화 실패(GPU 메모리 부족 등) 시 재시도용.
- 파인튜닝 모델 반영은 이 파일과 모델 파일 교체만으로 끝난다. 프론트 재배포 없음.

## 5. 백엔드와 배포

### 5.1 FastAPI (`backend/`)
- `GET /api/manifest`: `backend/data/manifest.json` 반환.
- `GET /api/questions/{field}`: `backend/data/questions/{field}.json` 반환. 미등록 분야는 `general.json`. 각 파일은 질문 5개 배열.
- `GET /api/health`: `{ "status": "ok" }`.
- 데이터베이스·인증 없음. `python:3.12-slim` 기반, uvicorn 워커 1개.

### 5.2 nginx (`deploy/nginx.conf`)
- `/` → Vue 빌드 정적 파일, SPA 폴백(`try_files $uri /index.html`).
- `/models/` → 모델 디렉터리. Range 요청 허용, `Cache-Control: public, max-age=31536000, immutable`, gzip 비활성.
- `/api/` → `http://api:8000/` 프록시.
- 모델 파일은 이미지에 넣지 않고 호스트 볼륨(`/srv/momo/models`)으로 마운트한다.

### 5.3 docker-compose (`deploy/docker-compose.yml`)
- 서비스: `web`(멀티스테이지 빌드: node로 프론트 빌드 → nginx 이미지), `api`(FastAPI).
- 외부 노출은 `web`의 80 포트 하나. 기존 리버스 프록시가 여기로 연결한다.
- `linux/arm64` 빌드. 개발 PC에서 `docker buildx`로 빌드해 파이로 전송하는 것을 권장(파이에서 프론트 빌드는 느림).

### 5.4 모델 파일 준비
- 초기: Hugging Face에서 Gemma 4 E4B 웹용 `.litertlm`(및 E2B 폴백)을 받아 파이 볼륨에 복사.
- 파인튜닝 성공 시: 변환된 파일을 같은 볼륨에 추가하고 `manifest.json`의 `id`·`url`·`template`·`systemPromptOverride`만 수정.
- 데모 노트북은 리허설 때 다운로드해 캐시를 채워 둔다. 당일 파이 회선 부하를 피한다.

## 6. 에러 처리

| 상황 | 처리 |
|---|---|
| WebGPU 없음 | 랜딩에서 차단. 최신 Chrome·GPU 필요 안내 |
| 다운로드 실패/중단 | 수신 바이트가 Content-Length와 다르면 캐시 저장 금지. 재시도 버튼 |
| 스토리지 부족 | 다운로드 전 `navigator.storage.estimate()`로 확인, 부족하면 용량 안내. `navigator.storage.persist()` 요청 |
| 모델 초기화 실패 | 오류 메시지 + 캐시 삭제 버튼. 매니페스트 `fallback`으로 재시도 제안 |
| PDF 추출 실패(스캔본 등) | 안내 + 텍스트 직접 붙여넣기 입력란 제공 |
| 음성 인식 실패/권한 거부 | 마이크 버튼 비활성화. 텍스트 입력은 항상 가능 |
| 생성 중 오류 | 대화 이력 유지, 마지막 턴만 재시도 |
| 리포트 JSON 파싱 실패 | 원문을 카드 하나에 표시 |

## 7. 테스트
- **단위(Vitest)**: 채팅 템플릿 조립, thought 스트리밍 제거, 종료 문장 감지, 토큰 근사, 리포트 JSON 파싱/폴백, PDF 절단. 순수 함수라 GPU 없이 CI에서 실행.
- **컴포넌트**: 준비 화면 "면접 시작" 버튼 활성 조건(모델 준비 × 입력 완료 조합).
- **FastAPI(pytest)**: 세 엔드포인트 + 미등록 분야 폴백.
- **수동 시나리오(`docs/demo-checklist.md`)**: 첫 방문 다운로드, 재방문 캐시, 면접 전체 1회, 음성 입력, 리포트, 모델 교체. D-1 리허설용.

## 8. 파인튜닝 트랙 (`finetune/`, 사이트와 독립)
- 데이터: 시스템 프롬프트·이력서·면접 대화·리포트 JSON 형식을 사이트와 동일하게 맞춘 대화 예시 수십~수백 개. 큰 모델로 초안을 만들고 손으로 다듬는다.
- 학습: Colab에서 Gemma 4 E4B에 LoRA 파인튜닝 후 병합.
- 변환: 병합 모델 → LiteRT-LM 웹용 `.litertlm`. **D-4까지 변환 성공 여부를 먼저 확인**한다. 실패하면 트랙을 중단하고 발표 자료용 지표만 남긴다.
- 성공 시 매니페스트 교체로 반영. 사이트 코드는 수정하지 않는다.

## 9. 일정

| 일차 | 날짜 | 작업 |
|---|---|---|
| D-6 | 09-15 | 저장소 뼈대, Vue 프로젝트, FastAPI, docker-compose, E4B 모델 브라우저 로드 확인 |
| D-5 | 09-16 | 준비 화면(다운로드·캐시·입력·PDF), 매니페스트 연동 |
| D-4 | 09-17 | 면접 화면(세션·스트리밍·말풍선·음성), 파인튜닝 변환 가능 여부 판정 |
| D-3 | 09-18 | 리포트 화면, 에러 처리, 도트 그래픽 적용 |
| D-2 | 09-19 | 파이 배포, 전체 시나리오 리허설, 프롬프트 튜닝 |
| D-1 | 09-20 | 버그 수정, 데모 노트북 캐시 채우기, 발표 준비 |

## 10. 알려진 리스크
- **단일 세션 흐름**: 모델이 질문 수·꼬리질문 제한·종료 문장을 스스로 지켜야 한다. 프론트는 이를 강제하지 않는다. 리허설에서 프롬프트로 보정하고, 사용자의 "면접 종료" 버튼이 최종 안전장치다.
- **E4B 자원**: 웹용 파일 약 4GB, GPU 메모리 6~8GB급 필요. D-6에 데모 노트북에서 로드 확인이 첫 작업이다. 안 되면 `fallback`(E2B)으로 간다.
- **Gemma 4 웹용 모델과 템플릿 실체**: 참고 코드의 모델 URL과 템플릿 토큰이 실제 공개본과 일치하는지 D-6에 검증한다. 틀리면 빈 응답이 난다.
- **파인튜닝 변환 도구 체인**: 성공이 보장되지 않는다. 사이트는 변환 없이도 완성된다.
