# 면접관 고르기 · 페르소나 · 목소리 — 설계 (spec)

- 생성일시: 2026-09-26
- 수정일시: 2026-09-26
- 상태: 승인됨 (브레인스토밍 완료, @leemonta9482 리뷰 대기)
- 담당: 프론트 @leemonta9482 (이슈 5건으로 분할) / 계약·미리 듣기 에셋 @ssenu
- 상위 문서: `docs/superpowers/specs/2026-09-15-mock-interview-design.md`, `docs/specs/frontend/2026-09-15-screens-design.md`, `docs/specs/frontend/2026-09-16-prompts-design.md`, `docs/specs/frontend/2026-09-17-tts-design.md`
- 계약: `docs/specs/backend/2026-09-26-tts-voices-design.md` (`tts.voices` additive) — **계약 PR 배포 뒤 이 spec의 코드 작업을 시작한다(lockstep)**

## 0. 배경

지금은 면접관이 한 명(가운데, 목소리 M2, 중립 말투)뿐이다. 성격이 다른 면접관을 골라 연습할 수 있게 한다. 예를 들어 긴장을 풀어 주는 온화한 선배, 또는 근거를 캐묻는 압박 면접관이다. 모델을 받기 전에 면접관을 고르고, 목소리를 **미리 들어 볼 수** 있어야 한다.

Supertonic 3는 엔진(약 398MB)을 모든 목소리가 공유하고, 목소리마다 다른 것은 `voice_styles/{ID}.json`(약 290KB) 하나다. 그래서 "고른 면접관의 TTS를 받는다"는 곧 **엔진 + 그 면접관의 목소리 파일 하나**를 받는다는 뜻이다. 면접관을 바꾸면 290KB만 더 받는다.

## 1. 결정 사항

| 항목 | 결정 |
|---|---|
| 라인업 | **3명:** 온화한 선배(`gentle`), 기본 면접관(`standard`, 지금 캐릭터·M2 그대로), 날카로운 압박 면접관(`sharp`) |
| 겉모습 | 면접관마다 **완전히 다른 스프라이트 세트**. 새로 그릴 캐릭터는 2명(`gentle`, `sharp`) × 가운데 동작 6종 = 12개 |
| 무대 | 고른 면접관이 **가운데**(말하는 자리)에 앉는다. 좌우 배석자(서류 넘기기·받아 적기)는 그대로 |
| 페르소나 범위 | 면접 중 말투·질문 방식(성격 문장, 꼬리질문 규칙, 짧은 반응) + **리포트 피드백 말투 한 줄**. 리포트 JSON 형식과 분량은 불변 |
| 고르는 시점 | 랜딩, 모델 다운로드 동의 **전**. 첫 방문은 선택해야 동의 창이 열린다. 준비 화면에서도 "바꾸기" 가능 |
| 미리 듣기 | 면접관별로 **하드코딩한 한 문장을 개발 중에 미리 합성한 OGG**를 재생한다(모델을 받기 전이라 엔진이 없음) |
| 목소리 다운로드 | 엔진 파일 + **고른 목소리 파일 하나**. 한 번 받은 목소리는 캐시에 남긴다 |
| 데이터 위치 | 면접관 정의(이름·소개·목소리 ID·스프라이트·미리 듣기)는 프론트, 페르소나 문구는 `prompts/`(계층 규율), 목소리 파일 목록·크기는 매니페스트 `tts.voices` |

**제외(이번 범위 아님):** 면접관별 답변 제한 시간·무대 연출 차이, 좌우 배석자 교체, 4번째 이후 면접관, 사용자 정의 면접관, 서버에 둔 페르소나.

## 2. 계약

`docs/specs/backend/2026-09-26-tts-voices-design.md` 요약:
- `tts.voices: [{ id, path, size }]` 10개(F1~F5, M1~M5). 기존 `files`·`voice`는 그대로다.
- **엔진 파일** = `tts.files` 중 경로가 `voices[].path`에 없는 것. **목소리 파일** = `voices`에서 고른 하나.
- `voices`가 없거나, 면접관의 `voiceId`가 목록에 없으면 기본 `tts.voice`를 쓴다.

## 3. 화면 흐름

### 3.1 랜딩 — "면접관 고르기" (지금 두 번째 창 "면접관 소개" 자리)
- 면접관 3명을 나란히 세운다. 각자 `idle` 애니메이션, 이름표, 한 줄 소개가 있다.
  - 예: 온화한 선배 "편하게 이야기해요" / 기본 면접관 "차분하게 진행합니다" / 날카로운 압박 면접관 "근거를 보여 주세요"
- **클릭하면 선택 + 미리 듣기를 재생**한다.
  - 같은 면접관을 다시 누르거나 스피커 아이콘을 누르면 다시 듣는다.
  - 다른 면접관을 누르면 앞 소리를 멈춘다.
- 접근성: `role="radiogroup"`으로 방향키 이동과 Space·Enter 선택을 지원한다. 선택은 테두리 강조와 "선택됨" 태그로 보여 준다(색만으로 구분하지 않음).
- **첫 방문(저장된 선택 없음)에는 아무도 선택되지 않는다.** 그동안 동의 창은 "면접관을 먼저 골라 주세요" 안내만 보이고 동의 선택지는 비활성이다.
- 선택은 `localStorage` `momo.interviewer`에 기억한다.

### 3.2 동의 창
- 목소리 행: `supertonic-3 (목소리: 온화한 선배)`. 용량 = 엔진 + 고른 목소리. 합계와 장비 확인의 "필요" 용량도 이 기준이다.
- 목소리를 해제해도(텍스트 전용, #36) 페르소나는 그대로 적용되고, 미리 듣기도 가능하다.

### 3.3 재방문
- 판정은 **Gemma + TTS 엔진 파일**이 캐시에 있는지로 한다. 목소리 파일은 290KB라 판정에서 뺀다. 없으면 준비 단계에서 받는다.
- 접힌 통과 표시 한 줄에 `· 면접관: 온화한 선배`를 붙인다.
- 고르기 창은 재방문에도 보인다. 여기서 바꿔도 동의를 다시 받지 않는다.
- 재방문인데 저장된 선택이 없으면(이 기능 배포 전에 모델을 받아 둔 사용자) "바로 준비하기"도 면접관을 고를 때까지 비활성이고, 같은 안내("면접관을 먼저 골라 주세요")를 보인다.

### 3.4 준비 화면
- 시작 영역(체크리스트 옆)에 `면접관: 온화한 선배 · 바꾸기`를 둔다.
- "바꾸기"를 누르면 같은 고르기 패널(`InterviewerPicker`)이 열린다.
- 바꾸면:
  - TTS가 준비됐으면 새 목소리 파일(없으면 290KB 다운로드)을 워커에 `setVoice`로 넘긴다. Gemma와 ONNX 세션은 다시 불러오지 않는다.
  - TTS가 아직 준비 중이면 새 목소리로 이어서 로드한다.
- 체크리스트 "목소리 준비" 줄에 면접관 이름을 붙인다.

### 3.5 면접 · 리포트
- 무대 가운데에 고른 면접관의 스프라이트가 앉는다.
- 상단 태그: `IT · 백엔드 개발자 · 면접관: 온화한 선배`. 리포트 헤더에도 같은 태그를 둔다.
- 면접을 시작할 때 면접관을 **그 면접에 고정(스냅샷)** 한다. 이후 선택을 바꿔도 진행 중인 면접·리포트에는 영향이 없다.
- 리포트의 "다시 면접 보기"는 지금처럼 준비 화면으로 간다. 거기서 면접관을 바꿔 다시 볼 수 있다.

## 4. 구조 (모듈)

### 4.1 면접관 정의 — `frontend/src/interviewers/index.ts` (신규)
```ts
export type InterviewerId = 'gentle' | 'standard' | 'sharp'
export type CenterRole = 'idle' | 'question' | 'nod' | 'watch' | 'lookside' | 'armscross'
export interface Interviewer {
  id: InterviewerId
  name: string                 // '온화한 선배'
  tagline: string              // '편하게 이야기해요'
  voiceId: string              // manifest.tts.voices의 id (standard = 'M2')
  preview: { text: string; src: string } // src: '/voices/preview/{id}.ogg'
  sprites: Record<CenterRole, { file: string; frames: number }>
}
export const INTERVIEWERS: readonly Interviewer[]
export function interviewerById(id: string | null): Interviewer | null
```
- `standard.sprites`는 지금 파일(`/sprites/interviewers/center_*.png`)을 가리킨다. 새 캐릭터는 `/sprites/interviewers/{id}/center_*.png`에 둔다.
- 페르소나 문구는 여기 두지 않는다. `prompts/personas.ts`에 id로 연결한다(5절).

### 4.2 선택 상태
- 새 스토어 `stores/interviewer.ts`에 `interviewerId: InterviewerId | null`과 `select(id)`를 둔다. `stores/model.ts`(목소리 ID)와 `stores/interview.ts`(스냅샷)가 이 스토어를 읽는다.
  - `localStorage` `momo.interviewer`로 기억한다. 읽고 쓸 때 try/catch로 감싸며, 기존 `momo.voice`·`momo.muted`와 같은 방식이다.
  - 저장값이 정의에 없으면 `null`(선택 안 됨)로 본다.
- `stores/interview.ts`의 `start()`가 `sessionInterviewer`로 스냅샷한다. 프롬프트·무대·리포트 헤더는 스냅샷을 쓴다.

### 4.3 TTS 목소리 (`stores/model.ts`, `services/tts.ts`, 워커)
- **고른 목소리** `ttsVoice`: 면접관의 `voiceId`가 `tts.voices`에 있으면 그것, 아니면 `tts.voice`(기본)
- **받을 TTS 파일** = 엔진 파일(`files` − `voices` 경로) + 고른 목소리 파일 1개. `voices`가 없으면 지금처럼 `files` 전체를 받는다.
  - `ttsSize`·`downloadSize`·합산 진행률·필요 용량은 모두 이 목록 기준이다.
- `initTts(cfg, voice, onProgress)`: 워커 `load` 메시지의 `voice`에 고른 목소리 ID를, `files`에 위 목록을 넣는다. 워커는 지금처럼 `voice_styles/{voice}.json`을 찾는다.
- **워커 `setVoice`** (`ttsProtocol.ts`):
  - `{ type: 'setVoice'; voice: string; file: TtsLoadFile }` → 목소리 JSON만 읽어 스타일 텐서를 교체하고 `{ type: 'voiceSet' }`로 응답한다. ONNX 세션은 그대로 둔다.
  - 합성 큐에 이미 들어온 요청은 옛 목소리로 끝내고, 그 뒤 요청부터 새 목소리를 쓴다.
- `model.changeVoice(id)`:
  - 목소리 파일이 캐시에 없으면 `downloadModel`로 받는다.
  - TTS가 `ready`면 `setVoice`를 보내고, 로딩 중이면 다음 로드에 반영하고, 텍스트 전용이면 아무것도 하지 않는다.
- **캐시 정리**(`currentCacheKeys`): `tts.voices` 10개의 키를 모두 남긴다. 다시 그 면접관으로 돌아가도 새로 받지 않게 하려는 것이다.
- **재방문 판정**(`checkCached`): 모델 + 엔진 파일만 본다.

### 4.4 미리 듣기 — `services/preview.ts` (신규)
- `HTMLAudioElement` 한 개로 `play(src)`와 `stop()`을 제공한다. 새로 재생하면 이전 재생을 멈춘다. 클릭 핸들러 안에서 부르므로 자동 재생 제한에 걸리지 않는다.
- TTS 엔진·AudioContext·음소거 설정과 무관하다. 미리 듣기는 음소거와 상관없이 소리를 낸다. 무대의 음소거는 면접 중 음성에만 적용된다.
- 재생 실패(파일 없음·디코딩 실패)면 `false`를 반환한다. 화면에 "미리 듣기를 재생할 수 없습니다"만 보이고, 선택은 그대로 된다.

### 4.5 화면 컴포넌트
- `components/InterviewerPicker.vue` (신규): props `modelValue: InterviewerId | null`, emits `update:modelValue`. 3명 카드(애니메이션·이름·소개·스피커 버튼)를 그린다. 랜딩과 준비 화면 "바꾸기"에서 같이 쓴다.
- `LandingView`: 두 번째 창을 Picker로 바꾼다. 선택 전에는 동의 선택지를 비활성으로 두고 안내를 보인다. 목소리 행·재방문 한 줄에 면접관 이름을 넣는다.
- `PrepareView`: 시작 영역에 면접관 칩과 "바꾸기"를 두고, 목소리 준비 줄에 이름을 넣는다.
- `InterviewStage`·`ReportView`: 태그에 면접관 이름을 넣는다.

### 4.6 무대 애니메이션 (`components/interview/interviewerAnims.ts`)
- 가운데 동작을 역할(`CenterRole`)로 부르고, 실제 시트는 스냅샷 면접관의 `sprites[role]`로 푼다.
- `baseAnims`·`REACT`·`LIFE`·`watchAnim`의 로직(언제 무엇을 하는지)은 바꾸지 않는다.
- 좌우 배석자 시트는 그대로다.

## 5. 페르소나 프롬프트 (계층 규율 경로 `frontend/src/prompts/`)

### 5.1 구조
- `prompts/personas.ts`(신규)에 `Persona`를 id별로 둔다.
  ```ts
  interface Persona {
    character: string | null    // 첫 문단 뒤에 들어갈 성격 문장. null이면 넣지 않음
    followUpRule: string        // 진행 규칙 3번 전체 문장
    reaction: string            // 진행 규칙 4번의 허용 반응 예시
    reportTone: string | null   // 리포트 지시문에 덧붙일 한 줄. null이면 없음
  }
  ```
- `buildSystemPrompt(i)`는 `persona`를 받아 위 네 자리만 채운다. 진행 규칙의 나머지(질문 5개, 종료 문장, 면접 중 평가 금지, 번호 금지, 머리말·이모지 금지)는 공통이다.
- `buildReportInstruction(persona)`는 `REPORT_INSTRUCTION` 뒤에 `reportTone`을 한 줄 덧붙인다. JSON 예시·필드·"두세 문장" 분량은 그대로다.
- `systemPromptOverride`(매니페스트)가 있으면 지금처럼 그것이 우선이고 페르소나는 적용되지 않는다(파인튜닝 모델용).

### 5.2 페르소나 문구 (초안 — 리허설에서 다듬는다)

| 자리 | 온화한 선배 `gentle` | 기본 면접관 `standard` | 날카로운 압박 면접관 `sharp` |
|---|---|---|---|
| 성격 문장 | 지원자가 편하게 말할 수 있도록 부드럽고 따뜻한 존댓말을 씁니다. 경험을 떠올리기 쉽게 구체적인 상황으로 묻습니다. | (없음) | 논리와 근거를 엄격하게 확인합니다. 간결하고 건조한 존댓말을 쓰고, 수치·근거·본인의 기여·한계를 캐묻습니다. 모호한 표현은 구체적으로 되묻습니다. 무례하거나 인신공격적인 표현은 쓰지 않습니다. |
| 규칙 3 (꼬리질문) | 지원자의 답변이 너무 짧을 때만 꼬리질문을 할 수 있습니다. 한 질문당 꼬리질문은 최대 1개입니다. | 지원자의 답변이 짧거나 구체성이 부족하거나 흥미로우면 꼬리질문을 할 수 있습니다. 한 질문당 꼬리질문은 최대 2개입니다. (현재 문구) | 지원자의 답변에 근거·수치·본인의 기여가 부족하거나 모호하면 꼬리질문으로 구체적으로 되묻습니다. 한 질문당 꼬리질문은 최대 2개입니다. |
| 규칙 4 (허용 반응) | "네, 잘 들었습니다." | "네, 알겠습니다." (현재) | "네." |
| 리포트 말투 | 잘한 점을 먼저 짚고, 고칠 점은 격려하는 말투로 구체적으로 적습니다. | (없음) | 칭찬은 생략하고 근거 부족·모호한 표현·빠진 수치를 직설적으로 짚습니다. |

- **기본 면접관은 지금 프롬프트·리포트 지시문과 글자 하나까지 같다.** 테스트로 고정한다.
- 추가 문구는 약 100~150토큰이라 `TOKEN_LIMIT`(6,656)에 영향이 거의 없다.
- 리포트가 길어지면 잘릴 위험이 있으므로(2026-09-19 캡처 때 긴 면접에서 JSON 잘림을 관찰함), 말투 줄은 한 줄로 두고 분량 지시는 바꾸지 않는다.

## 6. 에셋

### 6.1 목소리 고르기 → 미리 듣기 파일 (@ssenu 제작, @leemonta9482 리뷰)
1. 같은 문장을 목소리 10개로 합성한 **후보 샘플**을 로컬에서 만든다(커밋하지 않음). 두 사람이 들어 보고 `gentle`·`sharp`의 `voiceId`를 정한다. `standard`는 M2다.
2. **미리 듣기 문장** (초안):
   - `gentle`: "안녕하세요, 오늘 면접을 맡은 선배예요. 긴장 푸시고 편하게 이야기해 주세요."
   - `standard`: "안녕하세요, 오늘 면접을 진행하겠습니다. 준비되시면 시작하겠습니다."
   - `sharp`: "시작하겠습니다. 답변은 근거와 수치로 구체적으로 말씀해 주세요."
3. **합성 설정은 앱과 같게** 한다: 스텝 `TOTAL_STEP`(4), 속도 `SPEED`(1.05), 무음 `SILENCE_SEC`(0.3). 미리 듣기와 실제 면접 목소리가 같아야 한다.
4. 산출물:
   - `frontend/public/voices/preview/{gentle,standard,sharp}.ogg` — OGG Vorbis 모노, 파일당 100KB 이하(500KB 훅 통과)
   - 생성 스크립트 `frontend/scripts/voice-previews/` — Python(uv) + onnxruntime + soundfile, Supertonic `py/helper.py`(MIT) 방식, 사용법 README 포함. 문장·목소리를 바꾸면 다시 생성할 수 있게 한다.
5. OpenRAIL-M 준수: 미리 듣기 옆에도 "AI로 합성한 목소리" 표기를 둔다(#34와 같은 문구).

### 6.2 스프라이트 (@leemonta9482, PixelLab MCP)
- `gentle`·`sharp` 각각 가운데 동작 6종. 32×32이고, 프레임 수는 **지금 가운데 면접관과 같게** 맞춘다(타이밍 코드 재사용).

| 동작 | idle | question | nod | watch | lookside | armscross |
|---|---|---|---|---|---|---|
| 프레임 | 15 | 10 | 11 | 10 | 10 | 28 |

- 인상: `gentle` — 밝은 톤 옷, 부드러운 표정 / `sharp` — 짙은 정장, 안경, 무표정. 겉모습 성별은 고른 목소리에 맞춘다.
- 위치: `public/sprites/interviewers/{id}/center_*.png`와 그 폴더의 `manifest.json`(기존 형식)

## 7. 에러 처리

| 상황 | 처리 |
|---|---|
| 미리 듣기 재생 실패 | "미리 듣기를 재생할 수 없습니다" 표시, 선택은 정상 |
| `tts.voices` 없음 / `voiceId`가 목록에 없음 | 기본 `tts.voice`로 합성(`console.warn` 한 번), 페르소나는 그대로 |
| 목소리 파일 다운로드 실패 | 기존 TTS 실패 경로(다시 시도 / 목소리 없이 시작) |
| `setVoice` 실패(바꾸기) | 이전 목소리를 유지하고 "목소리를 바꾸지 못했습니다" 경고. 면접관 선택은 되돌린다 |
| 저장된 `momo.interviewer`가 정의에 없음 | 선택 안 됨(첫 방문처럼) |
| 새 면접관 스프라이트 로드 실패 | 그 역할은 `standard` 스프라이트로 대체 |
| `systemPromptOverride` 있음 | 페르소나 미적용(기존 동작), 태그의 면접관 이름은 그대로 |

## 8. 테스트 · 검증

**단위 (Vitest)**
- `interviewers`
  - id 유일
  - `standard.voiceId === 'M2'`, 스프라이트가 기존 경로
  - 모든 면접관의 역할별 프레임 수가 기본과 같음
  - 미리 듣기 경로 형식
- 선택 스토어(`stores/interviewer`): 저장·복원, 잘못된 저장값은 `null`, 시작 시 스냅샷(이후 변경이 진행 중 면접에 영향 없음)
- `stores/model`
  - `voices`가 있으면 엔진 + 고른 목소리만 받고, `ttsSize`도 그 합이다.
  - `voices`가 없거나 `voiceId`가 목록에 없으면 기본 목소리를 쓴다.
  - `currentCacheKeys`가 목소리 10개를 포함한다.
  - `checkCached`는 목소리 파일을 보지 않는다.
  - `changeVoice`가 상태별로 동작한다(ready → setVoice, 로딩 중 → 다음 로드, 텍스트 전용 → 무동작).
- `services/tts`·워커 프로토콜
  - `setVoice` → `voiceSet`
  - 실패 시 이전 목소리 유지
  - 큐에 남은 요청은 옛 목소리
- `services/preview`: 새 재생이 이전 재생을 멈춘다. 실패하면 `false`를 반환한다.
- `InterviewerPicker`
  - 클릭 → `update:modelValue` + 미리 듣기 호출
  - 방향키·Space 선택
  - 스피커 버튼으로 다시 듣기
- `LandingView`: 선택 전에는 동의 선택지가 비활성이고 안내가 보인다. 목소리 행·재방문 한 줄에 이름이 들어간다.
- `PrepareView`: 면접관 칩과 "바꾸기" 패널이 있다.
- `InterviewStage`·`ReportView`: 태그에 면접관 이름이 있다.
- 프롬프트
  - `standard`로 만든 시스템 프롬프트·리포트 지시문 = 현재 문구(스냅샷 비교)
  - 각 페르소나의 네 자리가 제자리에 들어간다.
  - 셋 모두 공통 규칙(종료 문장·질문 5개)과 JSON 예시를 포함한다.

**수동 (계층 규율 + 데모 체크리스트에 추가)**
- 면접관마다 면접 1회를 완주하고 리포트 JSON 파싱을 확인한다. PR 본문에 프롬프트 전후 비교와 대표 질문·반응·피드백 예시를 첨부한다.
- 첫 방문: 선택 전 동의 비활성 → 선택 시 미리 듣기 재생 → 엔진 + 고른 목소리만 다운로드(Network에서 목소리 JSON 1개인지 확인)
- 준비 화면에서 바꾸기: 290KB만 받고, Gemma 재초기화 없이 새 목소리로 첫 질문
- 재방문: 접힌 한 줄에 면접관 이름. 다른 면접관으로 바꿔도 동의를 다시 묻지 않음

## 9. 작업 분할 · 순서

| 순서 | 작업 | 담당 | 선행 |
|---|---|---|---|
| 1 | 계약 PR `tts.voices` → 머지 → 파이 api 재빌드 | @ssenu | — |
| 2 | 목소리 후보 샘플 → 목소리 결정 → 미리 듣기 OGG·생성 스크립트 PR | @ssenu (리뷰 @leemonta9482) | — |
| 3 | 이슈 ① 스프라이트 2세트 (6.2) | @leemonta9482 | 2의 목소리 결정(겉모습 성별) |
| 4 | 이슈 ② 면접관 정의·선택 스토어·`InterviewerPicker`·미리 듣기·랜딩/준비 화면 (3.1~3.4, 4.1·4.2·4.4·4.5) | @leemonta9482 | 2 |
| 5 | 이슈 ③ TTS 목소리 선택 다운로드·`setVoice`·캐시 (4.3) | @leemonta9482 | 1 |
| 6 | 이슈 ④ 페르소나 프롬프트·리포트 말투 + 리허설 (5) | @leemonta9482 | 4 |
| 7 | 이슈 ⑤ 무대 가운데 스프라이트 교체·태그·리포트 헤더 (3.5, 4.6) | @leemonta9482 | 3, 4 |

- 이슈 ①(스프라이트)은 목소리만 정해지면 바로 시작할 수 있다. ③은 계약 배포 뒤에 시작한다.
- 프론트 plan은 이슈를 받아 @leemonta9482가 `docs/plans/frontend/`에 쓴다.

## 10. 열린 결정

- `gentle`·`sharp`의 목소리 ID: 6.1의 후보 샘플을 듣고 결정한다(후보: 온화 F 계열 또는 부드러운 M, 압박 저음 M 계열).
- 면접관 표시 이름: 지금은 역할 이름(온화한 선배 등). 사람 이름(예: "김선배")을 붙일지는 스프라이트 완성 뒤 정한다.
- 미리 듣기 문장·페르소나 문구: 초안이다. 리허설 결과로 확정한다.
