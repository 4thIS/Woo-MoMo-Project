# frontend 프롬프트 · LLM 런타임 — 설계 (spec)

- 생성일시: 2026-09-16
- 담당: @ssenu (plan 2를 백엔드 담당이 진행. @leemonta9482 합의)
- 상위 문서: `docs/superpowers/specs/2026-09-15-mock-interview-design.md` 4절, `docs/specs/frontend/2026-09-15-screens-design.md` 9절(열린 결정), `docs/model-verification-2026-09-15.md`
- 계층 규율 경로: `frontend/src/prompts/`, `frontend/src/services/llm.ts`

## 0. 배경

화면 spec은 프롬프트 문안과 런타임 선택을 이 문서로 미뤘다. 2026-09-16 결정:

| 열린 결정 | 확정 |
|---|---|
| LLM 런타임 | **LiteRT-LM JS (`@litert-lm/core` 0.17.x) 우선.** plan 2 Task 1이 스파이크(캐시 Blob → 엔진 → 한 문장 생성). 실패 시 같은 `services/llm.ts` 인터페이스 뒤에 MediaPipe 0.10.29(동작 확인됨)를 붙이고 plan을 수정한다 |
| "좋은 답변" 판정 | **길이 규칙**: 150자 이상 + 문장 2개 이상. 순수 함수 `utils/goodAnswer.ts` |
| 리포트 강조 | **요청함**. 피드백 안 `**…**`를 파서가 `--accent` span으로 |
| 답변 지연 임계값 | 20초 첫 watch, 이후 30초마다 (리허설에서 조정) |

## 1. 목표 · 비목표

### 목표
- 면접관 시스템 프롬프트와 리포트 지시문의 문안을 고정한다.
- 런타임 서비스의 인터페이스를 고정한다. 화면·스토어는 런타임을 모른다.

### 비목표
- 파인튜닝 모델용 짧은 프롬프트(매니페스트 `systemPromptOverride`로 대체 가능하므로 코드 변경 없음).
- 프롬프트 A/B, 다국어.

## 2. 데이터 · 계약
- 계약 변경 없음. 매니페스트 `template`은 LiteRT-LM에서는 쓰지 않는다(런타임이 템플릿을 적용). MediaPipe 폴백 시에만 `utils/template.ts`가 사용.
- LiteRT-LM WASM(약 22~34MB)은 **같은 오리진에서 서빙**한다(`/litert-wasm/`). CDN 요청 금지. 네트워크 요청은 매니페스트·질문·모델·WASM 네 가지.

## 3. 시스템 프롬프트 (`prompts/interviewer.ts`)

`buildSystemPrompt({ fieldLabel, job, resumeText, fallbackQuestions })`가 아래 문안을 채운다. 매니페스트 `systemPromptOverride`가 있으면 그것을 그대로 쓴다(치환 없음).

```
당신은 {fieldLabel} 분야 기업의 채용 면접관입니다. 지원 직무는 "{job}"입니다.
지금부터 지원자와 1:1 모의 면접을 진행합니다.

[지원자 이력서]
{resumeText}

[진행 규칙]
1. 한국어 존댓말을 씁니다. 한 번에 질문을 하나만 합니다. 질문은 두 문장 이내로 짧게 합니다.
2. 이력서 내용을 근거로 질문 5개를 준비해 순서대로 진행합니다. 첫 질문은 자기소개입니다.
3. 지원자의 답변이 짧거나 구체성이 부족하거나 흥미로우면 꼬리질문을 할 수 있습니다. 한 질문당 꼬리질문은 최대 2개입니다.
4. 답변에 대한 평가, 점수, 조언은 면접 중에는 절대 말하지 않습니다. 짧은 반응("네, 알겠습니다." 정도)만 허용됩니다.
5. 질문 번호나 남은 질문 수를 말하지 않습니다.
6. 다섯 번째 질문의 답변(꼬리질문 포함)이 끝나면 정확히 이 문장으로 끝냅니다: "면접을 마치겠습니다."
7. 질문 외의 설명, 머리말, 이모지, 마크다운은 쓰지 않습니다.

[참고용 질문 예시 — 이력서와 무관하면 쓰지 않아도 됩니다]
{fallbackQuestions를 "- " 목록으로, 없으면 이 절 전체 생략}
```

- 첫 턴: 스토어가 user 턴 `"면접을 시작해 주세요."`를 보내 모델이 첫 질문을 하게 한다. 이 킥오프 메시지는 대화 기록에 표시하지 않는다.
- 사고 모드는 켜지 않는다(`<|think|>` 없음). 런타임이 사고 채널을 분리해 주더라도 `utils/thoughts.ts`로 텍스트 안의 태그를 한 번 더 걸러 표시한다.

## 4. 리포트 지시문 (`prompts/report.ts`)

면접 종료 후 같은 대화에 user 턴으로 보낸다.

```
면접이 끝났습니다. 지금까지 당신이 한 질문과 지원자의 답변을 문항별로 정리해 피드백을 작성하세요.
꼬리질문은 원래 질문에 합쳐 하나의 문항으로 다룹니다.
아래 JSON 배열 형식으로만 출력하고, 다른 말은 하지 마세요. 코드 펜스는 써도 됩니다.
feedback 안에서 가장 중요한 구절 하나는 **별표 두 개**로 감싸 강조하세요.

[
  {"question": "질문 원문", "answerSummary": "지원자 답변 요약 (한두 문장)", "feedback": "구체적인 피드백 (두세 문장, 점수 없이)"}
]
```

- 파싱: 코드 펜스 제거 → 첫 `[`부터 마지막 `]`까지 → `JSON.parse` → 배열이고 각 항목의 세 필드가 문자열이면 성공. 실패 시 원문을 카드 하나에 그대로.

## 5. 런타임 서비스 인터페이스 (`services/llm.ts`)

```ts
initEngine(model: Blob, opts: { maxNumTokens: number }): Promise<void>   // WASM 로드 + Engine.create. 두 번 부르면 이전 엔진 삭제
startSession(systemPrompt: string): Promise<LlmSession>                   // 새 대화(이력 비어 있음). 이전 세션 삭제
disposeEngine(): Promise<void>
interface LlmSession {
  send(text: string, onToken: (delta: string) => void, signal?: AbortSignal): Promise<string>  // 스트리밍, 완료 시 전체 텍스트. abort 시 지금까지 텍스트로 resolve
  tokenCount(): Promise<number>           // 런타임 값. 실패 시 -1 (스토어가 근사치로 대체)
  dispose(): Promise<void>
}
```

- 샘플링: `temperature 0.7, k 40`, `maxOutputTokens 1024`, 엔진 `maxNumTokens 8192`.
- 화면 spec 6절의 `create/generate/dispose`는 MediaPipe 기준 초안이었다. 위 인터페이스로 대체한다.

## 6. 성공 기준
- 브라우저에서 캐시된 E2B/E4B로 첫 질문이 3초 안에 스트리밍 시작.
- 5문항(꼬리질문 포함) 완주 후 "면접을 마치겠습니다."가 나오고 리포트 JSON이 파싱된다. 실패해도 원문 카드로 표시된다.
- `pnpm test`에 프롬프트 조립·종료 감지·좋은 답변·thought 제거·토큰 근사·리포트 파서 테스트가 있다.
