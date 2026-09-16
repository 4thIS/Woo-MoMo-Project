# frontend plan 3 — 리포트 PDF 저장 · 소요 시간 · 말하기 자동 전송 (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- 생성일시: 2026-09-16
- 담당: @leemonta9482. 브랜치: `feature/frontend-report-print-timing` (main에서 생성, spec 커밋 포함)

**Goal:** 리포트를 PDF로 저장하고, 면접 소요 시간(총·질문별)을 보여 주고, 말하기 중 3초 침묵이면 답변을 자동 전송한다.

**Architecture:** 세 기능 모두 프론트 전용·additive. ③ 인쇄는 `@media print`에서 디자인 토큰만 재정의하고 `window.print()`를 부른다. ① 시간은 스토어 메시지에 `at`를 찍고 `utils/timing.ts` 순수 함수가 계산해 면접 화면(시계)·리포트(총·표·복사 텍스트)에 표시한다. ② 자동 전송은 `AnswerInput` 안의 타이머 하나 — 음성 결과 이벤트가 올 때마다 리셋, 3초 만료 시 `submit()`.

**Tech Stack:** Vue 3 + TS + Pinia + Vitest (기존). 신규 의존성 없음.

**Spec:** `docs/specs/frontend/2026-09-16-report-print-timing-autosend-design.md`

## Global Constraints

- 자기 영역(`frontend/`)만. `backend/`·`deploy/` 수정 없음. 계약(`docs/API.md`) 변경 없음. 계층 규율 경로(`src/prompts/`, `src/services/llm.ts`) 수정 없음.
- 모든 명령은 `frontend/`에서 `pnpm`으로. 게이트: `pnpm test && pnpm lint && pnpm exec prettier --check . && pnpm exec vue-tsc --noEmit && pnpm build`.
- 이력서·대화·리포트를 서버로 보내지 않는다. 새 네트워크 요청 없음.
- 색 리터럴은 `src/styles/tokens.css` 안에서만. 다른 파일은 토큰(`var(--…)`)만 쓴다.
- 면접 화면 어디에도 질문 번호·잔여 수·꼬리질문 수를 표시하지 않는다. 경과 시계(`mm:ss`)만 허용.
- 모델 출력은 텍스트 바인딩만. `innerHTML` 금지.
- `utils/`는 브라우저 API·스토어를 import하지 않는 순수 함수. 의존 방향 views → stores → services/utils.
- 상수: `SILENCE_MS = 3000`. 시각은 `Date.now()`(epoch ms).
- 커밋: `feat(frontend):`, `test(frontend):`, `docs:`. 커밋 순서 ③ → ① → ②.
- 새 코드는 실패 테스트 → 구현 → 통과 순.

## 파일 구조

```
frontend/src/
├── styles/tokens.css                          # + @media print 토큰 재정의
├── styles/base.css                            # + @media print: .stars 배경·.snap 화살표·.blink 숨김
├── utils/timing.ts                            # 신규: formatClock / formatDuration / turnDurations / totalDuration
├── utils/timing.test.ts                       # 신규
├── utils/reportParser.ts                      # reportToText(…, timing?) — "소요 시간" 절
├── utils/reportParser.test.ts                 # + timing 케이스
├── stores/interview.ts                        # ChatMessage.at, startedAt, endedAt
├── stores/interview.test.ts                   # + 시각 기록 테스트
├── components/interview/InterviewStage.vue    # prop elapsedMs → 상단바 시계
├── components/interview/InterviewStage.test.ts
├── components/interview/AnswerInput.vue       # SILENCE_MS, 침묵 타이머, 카운트다운
├── components/interview/AnswerInput.test.ts
├── views/InterviewView.vue                    # 1초 tick → elapsedMs
├── views/InterviewView.test.ts
├── views/ReportView.vue                       # PDF 버튼·인쇄 스타일·총 시간·시간 표
└── views/ReportView.test.ts
docs/demo-checklist.md                         # 신규(공동 영역): 수동 시나리오 3항목
```

---

### Task 1: 인쇄 토큰 + PDF로 저장 버튼 (③)

**Files:**
- Modify: `frontend/src/styles/tokens.css`
- Modify: `frontend/src/styles/base.css`
- Modify: `frontend/src/views/ReportView.vue`
- Test: `frontend/src/views/ReportView.test.ts`

**Interfaces:**
- Produces: ReportView 버튼 `data-test="print"`; 함수 `printReport()`(컴포넌트 내부). 인쇄 시 토큰 `--bg --win --raise --line --text --text-2 --text-3 --accent --ok --danger`가 흰 배경용으로 바뀐다.

- [ ] **Step 1: 실패 테스트 — PDF 버튼이 제목을 바꾸고 print를 부른 뒤 복원한다**

`frontend/src/views/ReportView.test.ts`의 마지막 `describe` 안(또는 파일 끝)에 추가:

```ts
describe('ReportView — PDF 저장', () => {
  it('완료 전엔 비활성, 완료 후 클릭하면 제목을 바꿔 print하고 afterprint에 복원한다', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T10:00:00'))
    const print = vi.fn()
    vi.stubGlobal('print', print)
    document.title = '모두의 모의면접'
    useInterviewStore().$patch({
      phase: 'report',
      reportStatus: 'writing',
      profile: { field: 'it', job: '백엔드 개발자' },
    })
    const w = mount(ReportView)
    expect((w.find('[data-test="print"]').element as HTMLButtonElement).disabled).toBe(true)
    useInterviewStore().$patch({ reportStatus: 'done', report: items })
    await w.vm.$nextTick()
    await w.find('[data-test="print"]').trigger('click')
    expect(document.title).toBe('모의면접 리포트 - 백엔드 개발자 - 2026-09-16')
    expect(print).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('afterprint'))
    expect(document.title).toBe('모두의 모의면접')
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: 실행 → 실패 확인**

Run: `pnpm vitest run src/views/ReportView.test.ts`
Expected: FAIL — `[data-test="print"]` 없음.

- [ ] **Step 3: 인쇄 토큰 (`tokens.css` 끝에 추가)**

```css
/* 인쇄(PDF 저장): 흰 종이용으로 토큰만 바꾼다. 화면 색 리터럴과 마찬가지로 여기서만 정의 */
@media print {
  :root {
    --bg: #ffffff;
    --win: #ffffff;
    --raise: #e6e8f5;
    --line: #111111;
    --text: #111111;
    --text-2: #333333;
    --text-3: #666666;
    --accent: #8a5a00;
    --ok: #1f7a3a;
    --danger: #b3261e;
    --star-1: transparent;
    --star-2: transparent;
    --win-border: 2px solid var(--line);
    --win-inner: none;
  }
}
```

- [ ] **Step 4: 인쇄 시 공용 숨김 (`base.css` 끝에 추가)**

```css
@media print {
  .stars {
    background-image: none;
  }
  .blink,
  .snap:not(:last-of-type)::after {
    display: none;
  }
  .rise,
  .snap > .content {
    animation: none;
  }
}
```

- [ ] **Step 5: ReportView — 버튼·printReport·인쇄 스타일**

`<script setup>`에 추가:

```ts
/** Chrome "PDF로 저장" 대화상자. 탭 제목이 기본 파일명이 되므로 잠깐 바꿨다가 afterprint에 복원 */
function printReport() {
  const prev = document.title
  const d = new Date()
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  document.title = `모의면접 리포트 - ${s.profile.job} - ${ymd}`
  window.addEventListener('afterprint', () => (document.title = prev), { once: true })
  window.print()
}
```

헤더 `.btns` 안, `텍스트 복사` 버튼 뒤에:

```vue
<PixelButton
  variant="secondary"
  data-test="print"
  :disabled="s.reportStatus !== 'done'"
  @click="printReport"
  >PDF로 저장</PixelButton
>
```

하단 `.btns.bottom`에도 같은 버튼을 하나 추가한다(`data-test` 없이).

`<style scoped>` 끝에:

```css
@media print {
  .report {
    max-width: none;
    padding: 0;
    gap: var(--sp-4);
  }
  .btns,
  .note {
    display: none;
  }
  .head h1 {
    font-size: var(--fs-h2);
  }
  .strong {
    font-weight: 700;
    text-decoration: underline;
  }
  /* 카드가 페이지 중간에서 잘리지 않게 */
  .report > * {
    break-inside: avoid;
  }
}
```

- [ ] **Step 6: 실행 → 통과 확인**

Run: `pnpm vitest run src/views/ReportView.test.ts`
Expected: PASS.

- [ ] **Step 7: 수동 확인 (dev 서버)**

리포트 화면에서 `PDF로 저장` → 인쇄 미리보기가 흰 배경·검정 글자, 별·버튼·안내문 없음, 카드가 잘리지 않음. 대화상자를 닫으면 탭 제목 복원.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/styles/tokens.css frontend/src/styles/base.css frontend/src/views/ReportView.vue frontend/src/views/ReportView.test.ts
git commit -m "feat(frontend): 리포트 PDF로 저장 — 인쇄 토큰·숨김 규칙·print 버튼(탭 제목이 파일명)"
```

---

### Task 2: `utils/timing.ts` 순수 함수 (①)

**Files:**
- Create: `frontend/src/utils/timing.ts`
- Test: `frontend/src/utils/timing.test.ts`

**Interfaces:**
- Produces:
  - `formatClock(ms: number): string` — `mm:ss`, 3600초 이상이면 `h:mm:ss`
  - `formatDuration(ms: number): string` — `12분 34초` / `34초` / `1시간 2분 3초`
  - `type TurnDuration = { question: string; ms: number }`
  - `turnDurations(messages: { role: 'user' | 'model'; text: string; at?: number }[], endAt: number | null): TurnDuration[]`
  - `totalDuration(startedAt: number | null, endedAt: number | null): number`

- [ ] **Step 1: 실패 테스트**

`frontend/src/utils/timing.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatClock, formatDuration, totalDuration, turnDurations } from './timing'

describe('formatClock', () => {
  it('mm:ss', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(754_000)).toBe('12:34')
  })
  it('1시간 넘으면 h:mm:ss', () => expect(formatClock(3_723_000)).toBe('1:02:03'))
  it('음수·NaN은 00:00', () => {
    expect(formatClock(-5)).toBe('00:00')
    expect(formatClock(NaN)).toBe('00:00')
  })
})

describe('formatDuration', () => {
  it('분·초', () => expect(formatDuration(754_000)).toBe('12분 34초'))
  it('60초 미만은 초만', () => expect(formatDuration(34_000)).toBe('34초'))
  it('시간 포함', () => expect(formatDuration(3_723_000)).toBe('1시간 2분 3초'))
  it('0은 0초', () => expect(formatDuration(0)).toBe('0초'))
})

describe('turnDurations', () => {
  const t0 = 1_000_000
  it('면접관 질문이 끝난 시각부터 다음 지원자 전송 시각까지', () => {
    const msgs = [
      { role: 'model' as const, text: '자기소개 해주세요', at: t0 },
      { role: 'user' as const, text: '저는…', at: t0 + 90_000 },
      { role: 'model' as const, text: '어려웠던 문제는?', at: t0 + 100_000 },
      { role: 'user' as const, text: 'N+1…', at: t0 + 160_000 },
    ]
    expect(turnDurations(msgs, null)).toEqual([
      { question: '자기소개 해주세요', ms: 90_000 },
      { question: '어려웠던 문제는?', ms: 60_000 },
    ])
  })
  it('답변 없이 끝난 마지막 질문은 endAt까지', () => {
    const msgs = [{ role: 'model' as const, text: '마지막', at: t0 }]
    expect(turnDurations(msgs, t0 + 5_000)).toEqual([{ question: '마지막', ms: 5_000 }])
  })
  it('endAt도 없으면 마지막 질문은 제외', () => {
    const msgs = [{ role: 'model' as const, text: '마지막', at: t0 }]
    expect(turnDurations(msgs, null)).toEqual([])
  })
  it('at 없는 메시지는 건너뛰고 던지지 않는다', () => {
    const msgs = [
      { role: 'model' as const, text: '옛 메시지' },
      { role: 'user' as const, text: '답' },
      { role: 'model' as const, text: '새 질문', at: t0 },
      { role: 'user' as const, text: '답', at: t0 + 1_000 },
    ]
    expect(turnDurations(msgs, null)).toEqual([{ question: '새 질문', ms: 1_000 }])
  })
})

describe('totalDuration', () => {
  it('둘 다 있으면 차이, 하나라도 없으면 0', () => {
    expect(totalDuration(10, 25)).toBe(15)
    expect(totalDuration(null, 25)).toBe(0)
    expect(totalDuration(10, null)).toBe(0)
  })
})
```

- [ ] **Step 2: 실행 → 실패 확인**

Run: `pnpm vitest run src/utils/timing.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`frontend/src/utils/timing.ts`:

```ts
/** 면접 시간 계산·표기. 브라우저 API·스토어 없음 */

export type TurnDuration = { question: string; ms: number }
type Msg = { role: 'user' | 'model'; text: string; at?: number }

const pad = (n: number) => String(n).padStart(2, '0')

function parts(ms: number) {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
  return { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 }
}

/** 면접 중 시계: mm:ss, 1시간 넘으면 h:mm:ss */
export function formatClock(ms: number): string {
  const { h, m, s } = parts(ms)
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** 리포트 표기: 12분 34초 / 34초 / 1시간 2분 3초 */
export function formatDuration(ms: number): string {
  const { h, m, s } = parts(ms)
  if (h) return `${h}시간 ${m}분 ${s}초`
  if (m) return `${m}분 ${s}초`
  return `${s}초`
}

/**
 * 면접관 턴마다 답하는 데 쓴 시간: 질문이 끝난 시각(at)부터 그 다음 지원자 턴의 at까지.
 * 답변 없이 끝났으면 endAt까지, endAt도 없으면 그 턴은 제외. at 없는 메시지는 건너뛴다.
 */
export function turnDurations(messages: Msg[], endAt: number | null): TurnDuration[] {
  const out: TurnDuration[] = []
  for (let i = 0; i < messages.length; i++) {
    const q = messages[i]
    if (q.role !== 'model' || q.at === undefined) continue
    const a = messages.slice(i + 1).find((m) => m.role === 'user' && m.at !== undefined)
    const end = a?.at ?? endAt
    if (end === null || end === undefined) continue
    out.push({ question: q.text, ms: Math.max(0, end - q.at) })
  }
  return out
}

export function totalDuration(startedAt: number | null, endedAt: number | null): number {
  return startedAt !== null && endedAt !== null ? Math.max(0, endedAt - startedAt) : 0
}
```

- [ ] **Step 4: 실행 → 통과 확인**

Run: `pnpm vitest run src/utils/timing.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/timing.ts frontend/src/utils/timing.test.ts
git commit -m "feat(frontend): 면접 시간 계산 순수 함수 — 시계·기간 표기, 턴별 답변 시간, 총 시간"
```

---

### Task 3: 스토어 시각 기록 + 복사 텍스트 "소요 시간" 절 (①)

**Files:**
- Modify: `frontend/src/stores/interview.ts`
- Modify: `frontend/src/utils/reportParser.ts`
- Test: `frontend/src/stores/interview.test.ts`, `frontend/src/utils/reportParser.test.ts`

**Interfaces:**
- Consumes: `TurnDuration`, `formatDuration` (Task 2)
- Produces: `ChatMessage.at: number`(필수 — 스토어가 만드는 메시지는 항상 찍는다. 테스트 픽스처는 `at` 없이 `$patch`해도 됨: 타입은 `at?: number`), state `startedAt: number | null`, `endedAt: number | null`; `reportToText(items, fieldLabel, job, timing?: { total: number; turns: TurnDuration[] })`

- [ ] **Step 1: 실패 테스트 — 스토어**

`frontend/src/stores/interview.test.ts`의 세션 관련 `describe`(`start는 시스템 프롬프트로…`가 있는 블록) 안에 추가. 그 블록의 기존 헬퍼(세션 mock, `useInterviewStore()` 준비)를 그대로 쓴다:

```ts
  it('start·send·종료 시각을 기록한다', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const s = useInterviewStore()
    // (이 블록의 기존 테스트가 쓰는 방식으로 프로필·이력서·모델 ready를 준비한다)
    await s.start()
    expect(s.startedAt).toBe(1_000_000)
    expect(s.messages.at(-1)?.role).toBe('model')
    expect(s.messages.at(-1)?.at).toBe(1_000_000)
    vi.setSystemTime(1_090_000)
    await s.send('답변입니다')
    expect(s.messages.find((m) => m.role === 'user')?.at).toBe(1_090_000)
    expect(s.endedAt).toBeNull()
    vi.useRealTimers()
  })
  it('종료 문장이 오면 endedAt이 찍히고, finish가 먼저 불려도 endedAt은 한 번만', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000_000)
    const s = useInterviewStore()
    // (종료 문장 '면접을 마치겠습니다'를 돌려주는 세션 mock — 기존 '종료 문장이 나오면 ended' 테스트와 동일하게)
    await s.start()
    await s.send('마지막 답')
    expect(s.ended).toBe(true)
    expect(s.endedAt).toBe(2_000_000)
    vi.setSystemTime(2_005_000)
    await s.finish()
    expect(s.endedAt).toBe(2_000_000)
    vi.useRealTimers()
  })
```

주의: 이 파일의 세션 mock이 응답을 `setTimeout`/마이크로태스크로 흘리는지 확인하고, fake timers와 충돌하면 `vi.useFakeTimers({ toFake: ['Date'] })`로 `Date`만 가짜로 한다.

- [ ] **Step 2: 실패 테스트 — reportToText**

`frontend/src/utils/reportParser.test.ts`의 `describe('reportToText')`에 추가:

```ts
  it('timing이 있으면 끝에 소요 시간 절을 붙인다', () => {
    const text = reportToText([item], 'IT', '백엔드', {
      total: 754_000,
      turns: [
        { question: '자기소개 해주세요', ms: 90_000 },
        { question: '어려웠던 문제는 무엇이었나요? 아주 긴 질문 문장이 여기에 계속 이어집니다 정말로', ms: 65_000 },
      ],
    })
    expect(text).toContain('\n\n소요 시간: 총 12분 34초\n')
    expect(text).toContain('- 1분 30초 · 자기소개 해주세요')
    expect(text).toContain('- 1분 5초 · 어려웠던 문제는 무엇이었나요? 아주 긴 질문 문장이 여기에 계속 이어집니다…')
  })
  it('timing이 없으면 기존 형식 그대로', () => {
    expect(reportToText([item], 'IT', '백엔드')).not.toContain('소요 시간')
  })
```

- [ ] **Step 3: 실행 → 실패 확인**

Run: `pnpm vitest run src/stores/interview.test.ts src/utils/reportParser.test.ts`
Expected: FAIL — `startedAt` undefined / 소요 시간 절 없음.

- [ ] **Step 4: 스토어 구현**

`frontend/src/stores/interview.ts`:

```ts
export interface ChatMessage {
  role: 'user' | 'model'
  text: string
  /** epoch ms. 면접관 턴은 말이 끝난 시각, 지원자 턴은 전송 시각. 스토어가 만드는 메시지는 항상 찍는다 */
  at?: number
}
```

state에 추가:

```ts
    startedAt: null as number | null,
    endedAt: null as number | null,
```

`start()`에서 `this.phase = 'interview'` 바로 앞에 `this.startedAt = Date.now()`, `this.endedAt = null`.

`send()`의 push: `this.messages.push({ role: 'user', text: t, at: Date.now() })`.

`generate()`의 push와 종료 판정:

```ts
          const text = this.streaming.trim()
          if (text) this.messages.push({ role: 'model', text: this.streaming, at: Date.now() })
          if (hasEndPhrase(text)) {
            this.ended = true
            this.endedAt ??= Date.now()
          }
```

`finish()`에서 `this.reportStatus = 'writing'` 다음 줄에 `this.endedAt ??= Date.now()`.

`reset()`에 `this.startedAt = null`, `this.endedAt = null`.

- [ ] **Step 5: reportToText 구현**

`frontend/src/utils/reportParser.ts`:

```ts
import { formatDuration, type TurnDuration } from './timing'

const QUESTION_MAX = 40

export function reportToText(
  items: ReportItem[],
  fieldLabel: string,
  job: string,
  timing?: { total: number; turns: TurnDuration[] },
): string {
  const strip = (s: string) => s.replace(/\*\*/g, '')
  const body = items
    .map(
      (it, i) =>
        `Q${i + 1}. ${strip(it.question)}\n답변 요약: ${strip(it.answerSummary)}\n피드백: ${strip(it.feedback)}`,
    )
    .join('\n\n')
  const time = timing
    ? `\n\n소요 시간: 총 ${formatDuration(timing.total)}\n` +
      timing.turns.map((t) => `- ${formatDuration(t.ms)} · ${clip(t.question)}`).join('\n')
    : ''
  return `${reportHeader(fieldLabel, job)}\n\n${body}${time}`
}

/** 질문 앞 40자 + … (리포트 시간 표와 복사 텍스트 공용) */
export function clip(s: string, max = QUESTION_MAX): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}
```

- [ ] **Step 6: 실행 → 통과 확인**

Run: `pnpm vitest run src/stores src/utils`
Expected: PASS. 기존 픽스처(`at` 없음)도 통과.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/stores/interview.ts frontend/src/stores/interview.test.ts frontend/src/utils/reportParser.ts frontend/src/utils/reportParser.test.ts
git commit -m "feat(frontend): 면접 시작·턴·종료 시각 기록, 리포트 복사 텍스트에 소요 시간 절"
```

---

### Task 4: 면접 화면 경과 시계 (①)

**Files:**
- Modify: `frontend/src/components/interview/InterviewStage.vue`
- Modify: `frontend/src/views/InterviewView.vue`
- Test: `frontend/src/components/interview/InterviewStage.test.ts`, `frontend/src/views/InterviewView.test.ts`

**Interfaces:**
- Consumes: `formatClock` (Task 2), `startedAt` (Task 3)
- Produces: `InterviewStage` prop `elapsedMs: number` (기본 0), 표시 `data-test="clock"`

- [ ] **Step 1: 실패 테스트 — Stage**

`InterviewStage.test.ts`에 추가:

```ts
  it('경과 시계를 mm:ss로 보여 준다 (질문 번호는 여전히 없다)', () => {
    const w = mount(InterviewStage, { props: { ...base, elapsedMs: 754_000 } })
    expect(w.find('[data-test="clock"]').text()).toBe('12:34')
    expect(w.text()).not.toMatch(/질문\s*\d|\d\s*\/\s*\d|남은/)
  })
```

`InterviewView.test.ts`에 추가(파일 상단 mock 그대로):

```ts
  it('시작 시각부터 1초마다 시계가 오른다', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const { w } = mountWith({ startedAt: 1_000_000 - 61_000, messages: [{ role: 'model', text: 'q' }] })
    expect(w.find('[data-test="clock"]').text()).toBe('01:01')
    vi.setSystemTime(1_000_000 + 2_000)
    vi.advanceTimersByTime(2_000)
    await w.vm.$nextTick()
    expect(w.find('[data-test="clock"]').text()).toBe('01:03')
    w.unmount()
    vi.useRealTimers()
  })
```

- [ ] **Step 2: 실행 → 실패 확인**

Run: `pnpm vitest run src/components/interview/InterviewStage.test.ts src/views/InterviewView.test.ts`
Expected: FAIL — `[data-test="clock"]` 없음.

- [ ] **Step 3: Stage 구현**

props에 `elapsedMs?: number` 추가(`withDefaults` 쓰지 않는 현재 스타일이면 `defineProps<{ …; elapsedMs?: number }>()`로 두고 템플릿에서 `elapsedMs ?? 0`). import `formatClock`.

상단바:

```vue
    <div class="topbar">
      <div class="left">
        <PixelTag tone="muted">{{ fieldLabel }} · {{ job }}</PixelTag>
        <span class="mono clock" data-test="clock" aria-label="경과 시간">{{
          formatClock(elapsedMs ?? 0)
        }}</span>
      </div>
      <PixelButton variant="secondary" data-test="end" @click="emit('end')">면접 종료</PixelButton>
    </div>
```

스타일:

```css
.left {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.clock {
  font-size: var(--fs-label);
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 4: View 구현 — 1초 tick**

`InterviewView.vue` script:

```ts
/* 경과 시계: 1초마다 now를 갱신. 언마운트 시 정리 */
const now = ref(Date.now())
const clock = setInterval(() => (now.value = Date.now()), 1000)
onBeforeUnmount(() => clearInterval(clock))
const elapsedMs = computed(() => (s.startedAt ? now.value - s.startedAt : 0))
```

(기존 `onBeforeUnmount(() => idleTimer && clearTimeout(idleTimer))`와 합쳐도 된다.) 템플릿 `<InterviewStage … :elapsed-ms="elapsedMs" />`.

- [ ] **Step 5: 실행 → 통과 확인**

Run: `pnpm vitest run src/components/interview src/views/InterviewView.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/interview/InterviewStage.vue frontend/src/components/interview/InterviewStage.test.ts frontend/src/views/InterviewView.vue frontend/src/views/InterviewView.test.ts
git commit -m "feat(frontend): 면접 화면 상단 경과 시계 (mm:ss)"
```

---

### Task 5: 리포트 총 시간 · 질문별 시간 표 · 복사/인쇄 반영 (①)

**Files:**
- Modify: `frontend/src/views/ReportView.vue`
- Test: `frontend/src/views/ReportView.test.ts`

**Interfaces:**
- Consumes: `turnDurations`, `totalDuration`, `formatDuration`, `clip`, `reportToText(…, timing)`, `startedAt/endedAt`

- [ ] **Step 1: 실패 테스트**

`ReportView.test.ts`에 추가:

```ts
  it('총 소요 시간 태그와 질문별 시간 표, 복사 텍스트에도 포함', async () => {
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    const t0 = 1_000_000
    useInterviewStore().$patch({
      phase: 'report',
      reportStatus: 'done',
      report: items,
      profile: { field: 'it', job: '백엔드' },
      startedAt: t0,
      endedAt: t0 + 754_000,
      messages: [
        { role: 'model', text: '자기소개 해주세요', at: t0 + 10_000 },
        { role: 'user', text: 'a', at: t0 + 100_000 },
        { role: 'model', text: '어려웠던 문제는?', at: t0 + 110_000 },
        { role: 'user', text: 'b', at: t0 + 175_000 },
      ],
    })
    const w = mount(ReportView)
    expect(w.text()).toContain('총 12분 34초')
    const rows = w.findAll('[data-test="turn-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('1분 30초')
    expect(rows[0].text()).toContain('자기소개 해주세요')
    expect(w.text()).not.toMatch(/질문\s*\d\s*\/|남은/)
    await w.find('[data-test="copy"]').trigger('click')
    expect(writeText.mock.calls[0][0]).toContain('소요 시간: 총 12분 34초')
  })
  it('시각이 없으면(옛 세션) 시간 표를 그리지 않는다', () => {
    useInterviewStore().$patch({
      phase: 'report',
      reportStatus: 'done',
      report: items,
      profile: { field: 'it', job: '백엔드' },
      messages: [{ role: 'model', text: 'q' }],
    })
    const w = mount(ReportView)
    expect(w.find('[data-test="timing"]').exists()).toBe(false)
  })
```

- [ ] **Step 2: 실행 → 실패 확인**

Run: `pnpm vitest run src/views/ReportView.test.ts`
Expected: FAIL.

- [ ] **Step 3: 구현**

script:

```ts
import { clip, reportHeader, reportToText, splitEmphasis } from '@/utils/reportParser'
import { formatDuration, totalDuration, turnDurations } from '@/utils/timing'

const total = computed(() => totalDuration(s.startedAt, s.endedAt))
const turns = computed(() => turnDurations(s.messages, s.endedAt))
const timing = computed(() =>
  total.value > 0 || turns.value.length ? { total: total.value, turns: turns.value } : undefined,
)
```

`copy()`의 `reportToText(s.report, fieldLabel.value, s.profile.job)` → `reportToText(s.report, fieldLabel.value, s.profile.job, timing.value)`.

템플릿 헤더 `.meta`에 태그 추가:

```vue
<PixelTag v-if="total > 0" tone="muted" data-test="total">총 {{ formatDuration(total) }}</PixelTag>
```

헤더 바로 아래(총평/카드 앞)에 시간 표 창:

```vue
    <PixelWindow v-if="timing && turns.length" title="시간" data-test="timing" padding="sm">
      <ol class="turns mono">
        <li v-for="(t, i) in turns" :key="i" data-test="turn-row">
          <span class="dur">{{ formatDuration(t.ms) }}</span>
          <span class="q">{{ clip(t.question) }}</span>
        </li>
      </ol>
      <p class="mono note">면접관이 질문을 마친 뒤 답변을 보내기까지 걸린 시간입니다 (꼬리질문 포함).</p>
    </PixelWindow>
```

스타일:

```css
.turns {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  font-size: var(--fs-label);
}
.turns li {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: var(--sp-4);
}
.dur {
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
.q {
  color: var(--text-2);
}
```

인쇄 스타일 블록(Task 1)의 `.note { display: none }`이 이 창의 설명문도 숨긴다 — 의도됨(표만 인쇄).

- [ ] **Step 4: 실행 → 통과 확인**

Run: `pnpm vitest run src/views/ReportView.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/ReportView.vue frontend/src/views/ReportView.test.ts
git commit -m "feat(frontend): 리포트에 총 소요 시간과 질문별 답변 시간 표, 복사·PDF에 포함"
```

---

### Task 6: 말하기 침묵 자동 전송 (②)

**Files:**
- Modify: `frontend/src/components/interview/AnswerInput.vue`
- Test: `frontend/src/components/interview/AnswerInput.test.ts`

**Interfaces:**
- Produces: `export const SILENCE_MS = 3000`(컴포넌트 파일에서 `<script lang="ts">` 일반 블록으로 export — `<script setup>`은 export 불가), 표시 `data-test="silence"`

- [ ] **Step 1: 실패 테스트**

`AnswerInput.test.ts` 끝에 추가. `startSpeech` mock에서 콜백을 밖으로 빼내는 헬퍼:

```ts
import AnswerInput, { SILENCE_MS } from './AnswerInput.vue'

type Cbs = { interim: (t: string) => void; final: (t: string) => void; end?: () => void }
function armSpeech(): Cbs {
  const cbs = {} as Cbs
  vi.mocked(speechSupported).mockReturnValue(true)
  vi.mocked(startSpeech).mockImplementation((onInterim, onFinal, _onErr, onEnd) => {
    cbs.interim = onInterim
    cbs.final = onFinal
    cbs.end = onEnd
  })
  return cbs
}

describe('AnswerInput 침묵 자동 전송', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('첫 마디 이후 결과가 SILENCE_MS 동안 없으면 자동 전송한다', async () => {
    const cbs = armSpeech()
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    await w.find('[data-test="mic"]').trigger('click')
    vi.advanceTimersByTime(SILENCE_MS * 3)
    expect(w.emitted('send')).toBeUndefined() // 첫 마디 전엔 절대 안 보냄
    cbs.interim('안녕')
    await w.vm.$nextTick()
    expect(w.find('[data-test="silence"]').exists()).toBe(true)
    vi.advanceTimersByTime(SILENCE_MS - 500)
    cbs.final('안녕하세요') // 결과가 오면 타이머 리셋
    vi.advanceTimersByTime(SILENCE_MS - 500)
    expect(w.emitted('send')).toBeUndefined()
    vi.advanceTimersByTime(500)
    expect(w.emitted('send')?.[0]).toEqual(['안녕하세요'])
  })

  it('받아쓴 텍스트가 비어 있으면 보내지 않고 계속 듣는다', async () => {
    const cbs = armSpeech()
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    await w.find('[data-test="mic"]').trigger('click')
    cbs.interim(' ')
    vi.advanceTimersByTime(SILENCE_MS)
    expect(w.emitted('send')).toBeUndefined()
    expect(w.find('[data-test="mic"]').text()).toContain('듣는 중')
  })

  it('토글을 끄면 취소되고 텍스트는 남는다', async () => {
    const cbs = armSpeech()
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    await w.find('[data-test="mic"]').trigger('click')
    cbs.final('중간까지')
    await w.find('[data-test="mic"]').trigger('click') // off
    vi.advanceTimersByTime(SILENCE_MS * 2)
    expect(w.emitted('send')).toBeUndefined()
    expect((w.find('textarea').element as HTMLTextAreaElement).value).toBe('중간까지')
    expect(w.find('[data-test="silence"]').exists()).toBe(false)
  })

  it('브라우저가 스스로 인식을 끝내도 타이머는 살아 있어 전송한다', async () => {
    const cbs = armSpeech()
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    await w.find('[data-test="mic"]').trigger('click')
    cbs.final('끝')
    cbs.end?.()
    vi.advanceTimersByTime(SILENCE_MS)
    expect(w.emitted('send')?.[0]).toEqual(['끝'])
  })

  it('입력이 잠기면(generating) 타이머가 취소된다', async () => {
    const cbs = armSpeech()
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    await w.find('[data-test="mic"]').trigger('click')
    cbs.final('답')
    await w.setProps({ generating: true })
    vi.advanceTimersByTime(SILENCE_MS)
    expect(w.emitted('send')).toBeUndefined()
  })
})
```

파일 상단 import에 `afterEach`를 추가한다.

- [ ] **Step 2: 실행 → 실패 확인**

Run: `pnpm vitest run src/components/interview/AnswerInput.test.ts`
Expected: FAIL — `SILENCE_MS` export 없음.

- [ ] **Step 3: 구현**

`AnswerInput.vue`의 `<script setup>` **위에** 일반 스크립트 블록:

```vue
<script lang="ts">
/** 말하기 중 마지막 음성 결과 뒤 이만큼 조용하면 자동 전송. Chrome이 무음으로 인식을 스스로 끊는 시간(약 5~8초)보다 짧게 */
export const SILENCE_MS = 3000
</script>
```

`<script setup>` 안:

```ts
/* 침묵 자동 전송: 음성 결과(interim/final)가 올 때마다 타이머 리셋. 첫 결과 전엔 무장하지 않는다 */
let silenceTimer: ReturnType<typeof setTimeout> | null = null
const silenceArmed = ref(0) // 0 = 꺼짐, n>0 = n번째 무장(카운트다운 애니메이션 재시작용 key)
function disarmSilence() {
  if (silenceTimer) clearTimeout(silenceTimer)
  silenceTimer = null
  silenceArmed.value = 0
}
function armSilence() {
  if (silenceTimer) clearTimeout(silenceTimer)
  silenceArmed.value++
  silenceTimer = setTimeout(() => {
    silenceTimer = null
    silenceArmed.value = 0
    // 받아쓴 게 없으면(공백뿐) 보내지 않고 계속 듣는다
    if ((text.value + interim.value).trim()) {
      text.value = (text.value + interim.value).trim()
      interim.value = ''
      submit()
    }
  }, SILENCE_MS)
}
```

`startSpeech` 콜백 수정:

```ts
    (t) => {
      if (!listening.value) return
      interim.value = t
      armSilence()
    },
    (t) => {
      if (!listening.value) return
      text.value += t
      interim.value = ''
      armSilence()
    },
```

에러 콜백(`onError`)에는 `disarmSilence()` 추가. `onEnd` 콜백은 그대로(타이머 유지). `toggleMic()`의 off 분기 첫 줄에 `disarmSilence()`. `submit()` 성공 경로(`emit('send', t)` 직후)에 `disarmSilence()`. 잠금 watch(`locked`) 안에 `disarmSilence()`. `onBeforeUnmount`에 `disarmSilence()`.

템플릿 `.actions` 위(또는 mic 버튼 옆)에 카운트다운:

```vue
    <div v-if="silenceArmed" :key="silenceArmed" class="silence mono" data-test="silence" aria-live="polite">
      <span class="bar" :style="{ animationDuration: `${SILENCE_MS}ms` }" />
      <span>말을 멈추면 {{ SILENCE_MS / 1000 }}초 뒤 전송</span>
    </div>
```

스타일:

```css
.silence {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  font-size: var(--fs-meta);
  color: var(--text-2);
}
.silence .bar {
  width: 96px;
  height: 8px;
  background: var(--accent);
  transform-origin: left;
  animation: silence-drain linear forwards;
}
@keyframes silence-drain {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .silence .bar {
    animation: none;
  }
}
```

(`steps()` 대신 linear로 둔 이유: 3초 바가 계단식이면 "멈췄나?"로 읽힌다. reduced-motion에선 바를 고정.)

- [ ] **Step 4: 실행 → 통과 확인**

Run: `pnpm vitest run src/components/interview/AnswerInput.test.ts`
Expected: PASS. 기존 '말하기 ON이면 확정 결과를 덧붙이고 자동 전송하지 않는다' 테스트는 fake timers 없이 즉시 단언하므로 그대로 통과한다.

- [ ] **Step 5: 수동 확인**

dev 서버 + 마이크: 말하기 켜고 한 문장 → 카운트다운 바 → 3초 뒤 전송. 아무 말 안 하면 안 보내짐. 말하는 동안 바가 계속 리셋됨.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/interview/AnswerInput.vue frontend/src/components/interview/AnswerInput.test.ts
git commit -m "feat(frontend): 말하기 중 3초 침묵이면 답변 자동 전송, 카운트다운 표시"
```

---

### Task 7: 데모 체크리스트 + 최종 게이트

**Files:**
- Create: `docs/demo-checklist.md` (공동 영역 — PR에서 @ssenu 승인)

- [ ] **Step 1: 체크리스트 작성**

```markdown
# 데모 리허설 체크리스트 (수동)

> 자동 테스트로 못 잡는 항목만. 각 항목은 데스크톱 Chrome 최신, 실제 모델(E4B)로 확인한다.

## 면접 흐름
- [ ] 랜딩 → 동의 → 장비 확인 → 내려받기 → 준비 → 면접 시작 → 5문항 완주 → "면접이 끝났습니다" 창 → 리포트 받기
- [ ] 면접 중 상단 시계가 1초마다 오른다. 질문 번호·남은 수는 어디에도 없다

## 말하기
- [ ] 말하기 켜고 한 문장 말한 뒤 입을 다물면 카운트다운 바가 보이고 3초 뒤 자동 전송·생성 시작
- [ ] 말하기 켜고 아무 말 안 하면 보내지지 않는다 (인식기가 스스로 꺼져도)
- [ ] 말하는 도중에는 바가 계속 리셋되어 보내지지 않는다. 토글을 끄면 취소되고 텍스트는 남는다

## 리포트
- [ ] 헤더에 `총 N분 M초`, "시간" 창에 면접관 턴별 행(질문 앞 40자 + 시간)
- [ ] `텍스트 복사` 결과 끝에 "소요 시간" 절
- [ ] `PDF로 저장` → 인쇄 미리보기: 흰 배경·검정 글자, 별·버튼·안내문 없음, 카드가 페이지 중간에서 잘리지 않음, 기본 파일명 `모의면접 리포트 - {직무} - {날짜}`. 닫으면 탭 제목 복원
```

- [ ] **Step 2: 전체 게이트**

Run (in `frontend/`): `pnpm test && pnpm lint && pnpm exec prettier --check . && pnpm exec vue-tsc --noEmit && pnpm build`
Expected: 전부 통과.

- [ ] **Step 3: Commit**

```bash
git add docs/demo-checklist.md
git commit -m "docs: 데모 체크리스트 — 면접 흐름·말하기 자동 전송·리포트 시간·PDF 저장"
```

---

## 자체 점검

- spec 커버리지: ③ PDF(Task 1), ① 시각 기록(Task 3)·계산(Task 2)·시계(Task 4)·리포트 표/복사/인쇄(Task 5), ② 자동 전송(Task 6), 체크리스트(Task 7). 열린 결정 3개는 Task 1(`--accent: #8a5a00`, 굵게+밑줄), Task 5(헤더 아래), Task 4(태그 옆)로 확정.
- 타입 일관성: `TurnDuration {question, ms}`는 Task 2 정의 → Task 3(`reportToText` timing) → Task 5 동일. `ChatMessage.at?: number`는 Task 3 정의, Task 2의 `Msg` 타입과 구조적으로 호환. `elapsedMs` prop 이름은 Task 4 양쪽 동일. `SILENCE_MS`는 Task 6 export/import 동일.
- 제약: 색 리터럴은 Task 1 `tokens.css`에만. 질문 번호 미표시는 Task 4·5 테스트가 단언. `utils/`는 브라우저 API 없음(Task 2). 계층 규율 경로 미수정.
