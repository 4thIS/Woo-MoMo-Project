# frontend plan 2 — 면접 완주 + 최소 리포트 (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- 생성일시: 2026-09-16
- 기준 spec: `docs/specs/frontend/2026-09-15-screens-design.md` 4.3·4.4·5·6절, `docs/specs/frontend/2026-09-16-prompts-design.md`
- 디자인: `docs/specs/frontend/2026-09-15-design-system-design.md` 5절(면접 애니 매핑)
- 담당: @ssenu (plan 1은 @leemonta9482). 브랜치: `feature/frontend-interview` (main에서 생성)

**Goal:** 준비 화면의 "면접 시작"부터 면접 5문항 완주, 종료, 리포트 카드 표시까지 브라우저 안에서 한 번에 동작하게 한다.

**Architecture:** LiteRT-LM JS(`@litert-lm/core`)가 Cache API의 모델 Blob으로 엔진을 만들고, 한 `Conversation`이 면접 전체 이력을 들고 간다(전체 설계서 접근 1). `services/llm.ts`가 런타임을 숨기고, `stores/interview.ts`가 단계(stage)·대화·스트리밍·종료·리포트 상태를 만들며, 화면은 스토어만 본다. 순수 함수(`utils/`)는 전부 Vitest, GPU 코드는 브라우저 수동 검증.

**Tech Stack:** Vue 3 + TS + Pinia + Vitest (기존), `@litert-lm/core` ^0.17.1 (신규), Web Speech API

## Global Constraints

- 자기 영역(`frontend/`)만. `backend/`·`deploy/` 수정 없음. 계약(`docs/API.md`) 변경 없음.
- 모든 명령은 `frontend/`에서 `pnpm`으로. 게이트: `pnpm test && pnpm lint && pnpm exec prettier --check . && pnpm exec vue-tsc --noEmit && pnpm build`.
- 이력서·대화·리포트를 서버로 보내지 않는다. 네트워크 요청은 매니페스트·질문·모델·`/litert-wasm/` 네 가지뿐.
- 모델 출력은 텍스트 바인딩만. `innerHTML` 금지. 리포트 강조 `**…**`만 파서가 span 배열로 바꾼다.
- 면접 화면 어디에도 질문 번호·잔여 수·꼬리질문 수를 표시하지 않는다.
- 색 리터럴 금지, 디자인 토큰만(`--accent --bg --danger --line --ok --raise --text --text-2 --text-3 --win --win-border --win-inner --sp-* --fs-*`). 스프라이트는 `image-rendering: pixelated` + 정수 배율(면접관 ×6 = 192px, 지원자 정수리 ×6 = 288×192).
- `utils/`는 브라우저 API·스토어를 import하지 않는 순수 함수. `services/`는 스토어를 import하지 않는다. 의존 방향 views → stores → services/utils.
- 종료 문장은 정확히 `면접을 마치겠습니다`. 토큰 한도 6,500(런타임 값 우선, 없으면 한글 1자=1·그 외 4자=1 근사). 좋은 답변 = 150자 이상 + 문장 2개 이상. 답변 지연 watch = 20초, 이후 30초.
- 샘플링 `temperature 0.7, k 40`, `maxOutputTokens 1024`, 엔진 `maxNumTokens 8192`.
- 커밋: `feat(frontend):`, `fix(frontend):`, `test(frontend):`.
- 계층 규율 경로(`src/prompts/`, `src/services/llm.ts`) 변경은 PR 본문에 리허설 결과(면접 1회 완주 + 리포트 파싱) 첨부.

## 파일 구조

```
frontend/
├── package.json                      # + @litert-lm/core, scripts.postinstall(wasm 복사)
├── scripts/copy-litert-wasm.mjs      # node_modules/@litert-lm/core/wasm → public/litert-wasm
├── public/litert-wasm/               # gitignore (postinstall 생성)
└── src/
    ├── env.d.ts                      # + SpeechRecognition 타입
    ├── services/
    │   ├── llm.ts                    # initEngine / startSession / disposeEngine (LiteRT-LM)
    │   └── speech.ts                 # Web Speech 래퍼
    ├── prompts/
    │   ├── interviewer.ts            # buildSystemPrompt, KICKOFF
    │   └── report.ts                 # REPORT_INSTRUCTION
    ├── utils/
    │   ├── thoughts.ts               # ThoughtFilter (스트리밍 thought 제거)
    │   ├── tokens.ts                 # approxTokens
    │   ├── endDetector.ts            # END_PHRASE, hasEndPhrase
    │   ├── goodAnswer.ts             # isGoodAnswer
    │   └── reportParser.ts           # parseReport, splitEmphasis, reportToText
    ├── stores/
    │   ├── model.ts                  # + init(): downloaded → initializing → ready
    │   └── interview.ts              # + messages/stage/streaming/report, start/send/abort/retryLast/finish/reset
    ├── components/interview/
    │   ├── interviewerAnims.ts       # 스프라이트 시트 이름·프레임 수 (manifest.json과 동일)
    │   ├── InterviewStage.vue        # 면접실 + 면접관 3인 + 지원자 정수리 + 말풍선
    │   ├── ChatLog.vue               # 대화 기록
    │   └── AnswerInput.vue           # textarea + 말하기 토글 + 전송/중단
    └── views/
        ├── PrepareView.vue           # start() → interview.start()
        ├── InterviewView.vue         # 조립 + 종료 확인 + 토큰 한도
        └── ReportView.vue            # 카드 + 복사 + 다시 면접 보기
```

---

### Task 1: LiteRT-LM 스파이크 — 의존성 · WASM 자체 서빙 · `services/llm.ts`

이 Task가 실패하면(엔진 생성 불가, 빈 출력 등) 여기서 멈추고 컨트롤러에 BLOCKED로 보고한다. 그 경우 plan을 MediaPipe 폴백으로 수정한다.

**Files:**
- Modify: `frontend/package.json`, `frontend/.gitignore`(없으면 루트 `.gitignore`), `frontend/.prettierignore`, `frontend/eslint.config.js`
- Create: `frontend/scripts/copy-litert-wasm.mjs`, `frontend/src/services/llm.ts`
- Test: 브라우저 수동(스파이크). 단위 테스트 없음 — GPU 필요(frontend/CLAUDE.md 테스트 절)

**Interfaces:**
- Produces:
  - `initEngine(model: Blob, opts: { maxNumTokens: number }): Promise<void>`
  - `startSession(systemPrompt: string): Promise<LlmSession>`
  - `disposeEngine(): Promise<void>`
  - `interface LlmSession { send(text: string, onToken: (delta: string) => void, signal?: AbortSignal): Promise<string>; tokenCount(): Promise<number>; dispose(): Promise<void> }`
  - `WASM_PATH = '/litert-wasm/'`

- [ ] **Step 1: 의존성 추가**

```
pnpm add @litert-lm/core@^0.17.1
```

- [ ] **Step 2: WASM 복사 스크립트**

`frontend/scripts/copy-litert-wasm.mjs`:

```js
// node_modules/@litert-lm/core/wasm → public/litert-wasm (같은 오리진 서빙, CDN 금지)
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = resolve(root, 'node_modules/@litert-lm/core/wasm')
const dst = resolve(root, 'public/litert-wasm')
if (!existsSync(src)) {
  console.error('copy-litert-wasm: source not found:', src)
  process.exit(1)
}
rmSync(dst, { recursive: true, force: true })
mkdirSync(dst, { recursive: true })
cpSync(src, dst, { recursive: true })
console.log('copy-litert-wasm: copied to', dst)
```

`frontend/package.json` scripts에 추가:

```json
"postinstall": "node scripts/copy-litert-wasm.mjs",
"prebuild": "node scripts/copy-litert-wasm.mjs"
```

루트 `.gitignore`에 추가:

```
frontend/public/litert-wasm/
```

`frontend/.prettierignore`에 `public/litert-wasm` 추가. `frontend/eslint.config.js`의 `ignores`에 `'scripts/**'`는 넣지 않는다(스크립트도 lint 대상, node globals는 `**/*.ts`에만 있으므로 `.mjs`용 블록 추가):

```js
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: globals.node } },
```

Run: `pnpm install` → `public/litert-wasm/`에 `.wasm` 4개 + `.js` 4개 생성 확인.

- [ ] **Step 3: `services/llm.ts`**

```ts
import { Engine, loadLiteRtLm, type Conversation, type Message } from '@litert-lm/core'

export const WASM_PATH = '/litert-wasm/'

export interface LlmSession {
  send(text: string, onToken: (delta: string) => void, signal?: AbortSignal): Promise<string>
  tokenCount(): Promise<number>
  dispose(): Promise<void>
}

let wasmLoaded = false
let engine: Engine | null = null
let current: Conversation | null = null

async function ensureWasm() {
  if (wasmLoaded) return
  await loadLiteRtLm(WASM_PATH)
  wasmLoaded = true
}

export async function initEngine(model: Blob, opts: { maxNumTokens: number }): Promise<void> {
  await ensureWasm()
  await disposeEngine()
  engine = await Engine.create({ model, mainExecutorSettings: { maxNumTokens: opts.maxNumTokens } })
}

function textOf(m: Message): string {
  if (typeof m.content === 'string') return m.content
  if (!m.content) return ''
  return m.content.map((p) => (p.type === 'text' ? p.text : '')).join('')
}

export async function startSession(systemPrompt: string): Promise<LlmSession> {
  if (!engine) throw new Error('engine not initialized')
  if (current) {
    await current.delete().catch(() => undefined)
    current = null
  }
  const conv = await engine.createConversation({
    preface: { messages: [{ role: 'system', content: systemPrompt }] },
    sessionConfig: { samplerParams: { temperature: 0.7, k: 40 }, maxOutputTokens: 1024 },
  })
  current = conv
  return {
    async send(text, onToken, signal) {
      let full = ''
      const stream = conv.sendMessageStreaming(text)
      const reader = stream.getReader()
      const onAbort = () => conv.cancel()
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const delta = textOf(value)
          if (delta) {
            full += delta
            onToken(delta)
          }
        }
      } catch (e) {
        if (!signal?.aborted) throw e
      } finally {
        signal?.removeEventListener('abort', onAbort)
        reader.releaseLock()
      }
      return full
    },
    async tokenCount() {
      try {
        return await conv.getTokenCount()
      } catch {
        return -1
      }
    },
    async dispose() {
      if (current === conv) current = null
      await conv.delete().catch(() => undefined)
    },
  }
}

export async function disposeEngine(): Promise<void> {
  if (current) {
    await current.delete().catch(() => undefined)
    current = null
  }
  if (engine) {
    await engine.delete().catch(() => undefined)
    engine = null
  }
}
```

`sendMessageStreaming`이 `ReadableStream<Message>`를 반환하고, 각 `Message`의 `content`는 `string | ContentPart[]`다(패키지 `dist/conversation.d.ts`, `dist/conversation_config.d.ts`). 청크가 누적 텍스트인지 델타인지는 Step 5 스파이크에서 확인한다. **누적이면** `const delta = t.slice(full.length)`로 바꾼다.

- [ ] **Step 4: 타입체크·린트**

Run: `pnpm exec vue-tsc --noEmit && pnpm lint`
Expected: 오류 없음. `@litert-lm/core` 타입에서 오류가 나면 해당 줄에 `// eslint-disable-next-line` 대신 타입을 좁혀 해결한다(예: `p.type === 'text' && 'text' in p`).

- [ ] **Step 5: 브라우저 스파이크 (수동, 필수)**

백엔드를 로컬로 띄운다(`backend/`에서 `uv run uvicorn app.main:app --port 8000`). `frontend/`에서 `pnpm dev` → Chrome에서 `http://localhost:5173` → 랜딩 동의 → 모델 다운로드 완료(캐시). 그 다음 DevTools 콘솔에서:

```js
const llm = await import('/src/services/llm.ts')
const cache = await caches.open('momo-models')
const keys = await cache.keys()
const blob = await (await cache.match(keys[0])).blob()
console.time('init'); await llm.initEngine(blob, { maxNumTokens: 8192 }); console.timeEnd('init')
const s = await llm.startSession('당신은 면접관입니다. 한국어 존댓말로 자기소개 질문을 하나만 하세요.')
let out = ''; console.time('gen'); await s.send('면접을 시작해 주세요.', (d) => { out += d; console.log(JSON.stringify(d)) }); console.timeEnd('gen')
console.log('FULL:', out, 'tokens:', await s.tokenCount())
```

기록할 것(PR 본문에 첨부): init 시간, 첫 청크가 델타인지 누적인지, 한국어 질문이 나왔는지, tokenCount 값. **누적이면 Step 3의 주석대로 수정 후 재확인.** 네트워크 탭에 `cdn.jsdelivr.net` 요청이 없어야 한다.

- [ ] **Step 6: 커밋**

```bash
git add package.json pnpm-lock.yaml scripts/copy-litert-wasm.mjs src/services/llm.ts .prettierignore eslint.config.js ../.gitignore
git commit -m "feat(frontend): LiteRT-LM JS 런타임 서비스 + WASM 자체 서빙 (스파이크 통과)"
```

---

### Task 2: 순수 유틸 — thoughts · tokens · endDetector · goodAnswer

**Files:**
- Create: `frontend/src/utils/thoughts.ts`, `tokens.ts`, `endDetector.ts`, `goodAnswer.ts`
- Test: `frontend/src/utils/thoughts.test.ts`, `tokens.test.ts`, `endDetector.test.ts`, `goodAnswer.test.ts`

**Interfaces:**
- Produces:
  - `class ThoughtFilter { push(delta: string): string; flush(): string }` — 스트리밍 중 `<|channel>thought … <channel|>` 구간을 숨긴다. 태그가 청크 경계에 걸쳐도 동작.
  - `stripThoughts(text: string): string`
  - `approxTokens(text: string): number` — 한글(가-힣) 1자 = 1, 그 외 4자 = 1(올림)
  - `END_PHRASE = '면접을 마치겠습니다'`, `hasEndPhrase(text: string): boolean`
  - `isGoodAnswer(text: string): boolean` — trim 후 150자 이상 && 문장 2개 이상(`.`, `!`, `?`, `。`, 줄바꿈으로 나눈 비어 있지 않은 조각)

- [ ] **Step 1: 실패하는 테스트**

`thoughts.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ThoughtFilter, stripThoughts } from './thoughts'

describe('stripThoughts', () => {
  it('완결된 thought 블록을 지운다', () => {
    expect(stripThoughts('안녕<|channel>thought 생각 중<channel|>하세요')).toBe('안녕하세요')
  })
  it('태그가 없으면 그대로', () => {
    expect(stripThoughts('그대로')).toBe('그대로')
  })
})

describe('ThoughtFilter', () => {
  it('청크 경계에 걸친 태그도 숨긴다', () => {
    const f = new ThoughtFilter()
    const out = ['안녕<|chan', 'nel>thought 숨김', ' 계속<chan', 'nel|>하세요'].map((c) => f.push(c)).join('')
    expect(out + f.flush()).toBe('안녕하세요')
  })
  it('열린 태그가 닫히지 않으면 내부는 끝까지 보류한다', () => {
    const f = new ThoughtFilter()
    expect(f.push('질문<|channel>thought 아직')).toBe('질문')
    expect(f.flush()).toBe('')
  })
  it('태그 접두처럼 보이던 문자가 태그가 아니면 내보낸다', () => {
    const f = new ThoughtFilter()
    expect(f.push('a<') + f.push('b')).toBe('a<b')
  })
})
```

`tokens.test.ts`:

```ts
import { expect, it } from 'vitest'
import { approxTokens } from './tokens'

it('한글 1자 = 1토큰', () => expect(approxTokens('가나다')).toBe(3))
it('그 외 4자 = 1토큰(올림)', () => expect(approxTokens('abcde')).toBe(2))
it('혼합', () => expect(approxTokens('가나 ab')).toBe(2 + 1))
it('빈 문자열은 0', () => expect(approxTokens('')).toBe(0))
```

`endDetector.test.ts`:

```ts
import { expect, it } from 'vitest'
import { END_PHRASE, hasEndPhrase } from './endDetector'

it('종료 문장을 감지한다', () => {
  expect(hasEndPhrase(`수고하셨습니다. ${END_PHRASE}.`)).toBe(true)
})
it('없으면 false', () => expect(hasEndPhrase('다음 질문입니다.')).toBe(false))
it('공백 변형도 감지한다', () => expect(hasEndPhrase('면접을  마치겠습니다')).toBe(true))
```

`goodAnswer.test.ts`:

```ts
import { expect, it } from 'vitest'
import { isGoodAnswer } from './goodAnswer'

const long = '저는 백엔드 개발자로 3년간 일했습니다. '.repeat(7) // 161자, 문장 7개
it('150자 이상 + 문장 2개 이상이면 true', () => expect(isGoodAnswer(long)).toBe(true))
it('짧으면 false', () => expect(isGoodAnswer('네. 그렇습니다.')).toBe(false))
it('길어도 문장 1개면 false', () => expect(isGoodAnswer('가'.repeat(200))).toBe(false))
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- utils`
Expected: 4개 파일 모두 import 실패로 FAIL.

- [ ] **Step 3: 구현**

`thoughts.ts`:

```ts
const OPEN = '<|channel>thought'
const CLOSE = '<channel|>'

export function stripThoughts(text: string): string {
  return text.replace(/<\|channel>thought[\s\S]*?<channel\|>/g, '')
}

/** 스트리밍용. 열린 thought 구간은 닫힐 때까지 보류하고, 태그 접두일 수 있는 꼬리도 보류한다. */
export class ThoughtFilter {
  private buf = ''
  private inside = false

  push(delta: string): string {
    this.buf += delta
    let out = ''
    for (;;) {
      if (this.inside) {
        const end = this.buf.indexOf(CLOSE)
        if (end < 0) {
          this.buf = this.buf.slice(-(CLOSE.length - 1)) // 닫는 태그가 걸쳐 올 수 있는 꼬리만 유지
          return out
        }
        this.buf = this.buf.slice(end + CLOSE.length)
        this.inside = false
        continue
      }
      const start = this.buf.indexOf(OPEN)
      if (start >= 0) {
        out += this.buf.slice(0, start)
        this.buf = this.buf.slice(start + OPEN.length)
        this.inside = true
        continue
      }
      // 태그의 접두가 될 수 있는 꼬리('<', '<|', '<|chan'...)는 보류
      const keep = tailPrefixLength(this.buf, OPEN)
      out += this.buf.slice(0, this.buf.length - keep)
      this.buf = this.buf.slice(this.buf.length - keep)
      return out
    }
  }

  flush(): string {
    if (this.inside) {
      this.buf = ''
      return ''
    }
    const rest = this.buf
    this.buf = ''
    return rest
  }
}

function tailPrefixLength(s: string, tag: string): number {
  const max = Math.min(s.length, tag.length - 1)
  for (let n = max; n > 0; n--) if (tag.startsWith(s.slice(s.length - n))) return n
  return 0
}
```

`tokens.ts`:

```ts
export function approxTokens(text: string): number {
  const hangul = (text.match(/[가-힣]/g) ?? []).length
  const other = text.length - hangul
  return hangul + Math.ceil(other / 4)
}
```

`endDetector.ts`:

```ts
export const END_PHRASE = '면접을 마치겠습니다'

export function hasEndPhrase(text: string): boolean {
  return text.replace(/\s+/g, '').includes(END_PHRASE.replace(/\s+/g, ''))
}
```

`goodAnswer.ts`:

```ts
export const GOOD_ANSWER_MIN_CHARS = 150
export const GOOD_ANSWER_MIN_SENTENCES = 2

export function isGoodAnswer(text: string): boolean {
  const t = text.trim()
  if (t.length < GOOD_ANSWER_MIN_CHARS) return false
  const sentences = t.split(/[.!?。\n]+/).filter((s) => s.trim().length > 0)
  return sentences.length >= GOOD_ANSWER_MIN_SENTENCES
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- utils`
Expected: 새 테스트 전부 PASS. `thoughts.test.ts`의 마지막 케이스(`'a<' + 'b'`): 첫 push는 `'a'`를 내보내고 `'<'`를 보류, 둘째 push에서 `'<b'`는 태그 접두가 아니므로 `'<b'`를 내보낸다 → 합쳐서 `'a<b'`.

- [ ] **Step 5: 커밋**

```bash
git add src/utils/thoughts.ts src/utils/tokens.ts src/utils/endDetector.ts src/utils/goodAnswer.ts src/utils/*.test.ts
git commit -m "feat(frontend): thought 필터·토큰 근사·종료 감지·좋은 답변 순수 함수"
```

---

### Task 3: 프롬프트 — `prompts/interviewer.ts` · `prompts/report.ts`

**Files:**
- Create: `frontend/src/prompts/interviewer.ts`, `frontend/src/prompts/report.ts`
- Test: `frontend/src/prompts/interviewer.test.ts`

**Interfaces:**
- Produces:
  - `buildSystemPrompt(input: { fieldLabel: string; job: string; resumeText: string; fallbackQuestions: string[]; override?: string | null }): string`
  - `KICKOFF = '면접을 시작해 주세요.'`
  - `REPORT_INSTRUCTION: string`

- [ ] **Step 1: 실패하는 테스트**

`interviewer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { KICKOFF, buildSystemPrompt } from './interviewer'
import { END_PHRASE } from '@/utils/endDetector'

const base = { fieldLabel: 'IT', job: '백엔드 개발자', resumeText: '이력서 본문', fallbackQuestions: ['q1', 'q2'] }

describe('buildSystemPrompt', () => {
  it('분야·직무·이력서·종료 문장을 포함한다', () => {
    const p = buildSystemPrompt(base)
    expect(p).toContain('IT 분야')
    expect(p).toContain('"백엔드 개발자"')
    expect(p).toContain('이력서 본문')
    expect(p).toContain(`"${END_PHRASE}."`)
  })
  it('폴백 질문을 목록으로 넣는다', () => {
    expect(buildSystemPrompt(base)).toContain('- q1\n- q2')
  })
  it('폴백 질문이 없으면 참고 절을 생략한다', () => {
    expect(buildSystemPrompt({ ...base, fallbackQuestions: [] })).not.toContain('참고용 질문 예시')
  })
  it('override가 있으면 그대로 쓴다', () => {
    expect(buildSystemPrompt({ ...base, override: 'OVERRIDE' })).toBe('OVERRIDE')
  })
  it('KICKOFF 문구', () => expect(KICKOFF).toBe('면접을 시작해 주세요.'))
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- prompts` → FAIL (모듈 없음)

- [ ] **Step 3: 구현**

`interviewer.ts`:

```ts
import { END_PHRASE } from '@/utils/endDetector'

export const KICKOFF = '면접을 시작해 주세요.'

export interface SystemPromptInput {
  fieldLabel: string
  job: string
  resumeText: string
  fallbackQuestions: string[]
  override?: string | null
}

export function buildSystemPrompt(i: SystemPromptInput): string {
  if (i.override) return i.override
  const examples = i.fallbackQuestions.length
    ? `\n\n[참고용 질문 예시 — 이력서와 무관하면 쓰지 않아도 됩니다]\n${i.fallbackQuestions.map((q) => `- ${q}`).join('\n')}`
    : ''
  return `당신은 ${i.fieldLabel} 분야 기업의 채용 면접관입니다. 지원 직무는 "${i.job}"입니다.
지금부터 지원자와 1:1 모의 면접을 진행합니다.

[지원자 이력서]
${i.resumeText}

[진행 규칙]
1. 한국어 존댓말을 씁니다. 한 번에 질문을 하나만 합니다. 질문은 두 문장 이내로 짧게 합니다.
2. 이력서 내용을 근거로 질문 5개를 준비해 순서대로 진행합니다. 첫 질문은 자기소개입니다.
3. 지원자의 답변이 짧거나 구체성이 부족하거나 흥미로우면 꼬리질문을 할 수 있습니다. 한 질문당 꼬리질문은 최대 2개입니다.
4. 답변에 대한 평가, 점수, 조언은 면접 중에는 절대 말하지 않습니다. 짧은 반응("네, 알겠습니다." 정도)만 허용됩니다.
5. 질문 번호나 남은 질문 수를 말하지 않습니다.
6. 다섯 번째 질문의 답변(꼬리질문 포함)이 끝나면 정확히 이 문장으로 끝냅니다: "${END_PHRASE}."
7. 질문 외의 설명, 머리말, 이모지, 마크다운은 쓰지 않습니다.${examples}`
}
```

`report.ts`:

```ts
export const REPORT_INSTRUCTION = `면접이 끝났습니다. 지금까지 당신이 한 질문과 지원자의 답변을 문항별로 정리해 피드백을 작성하세요.
꼬리질문은 원래 질문에 합쳐 하나의 문항으로 다룹니다.
아래 JSON 배열 형식으로만 출력하고, 다른 말은 하지 마세요. 코드 펜스는 써도 됩니다.
feedback 안에서 가장 중요한 구절 하나는 **별표 두 개**로 감싸 강조하세요.

[
  {"question": "질문 원문", "answerSummary": "지원자 답변 요약 (한두 문장)", "feedback": "구체적인 피드백 (두세 문장, 점수 없이)"}
]`
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- prompts` → PASS

- [ ] **Step 5: 커밋**

```bash
git add src/prompts
git commit -m "feat(frontend): 면접관 시스템 프롬프트·리포트 지시문"
```

---

### Task 4: `utils/reportParser.ts`

**Files:**
- Create: `frontend/src/utils/reportParser.ts`
- Test: `frontend/src/utils/reportParser.test.ts`

**Interfaces:**
- Produces:
  - `interface ReportItem { question: string; answerSummary: string; feedback: string }`
  - `parseReport(raw: string): ReportItem[] | null` — 코드 펜스 제거 → 첫 `[`~마지막 `]` → JSON.parse → 검증. 실패 시 `null`
  - `splitEmphasis(text: string): { text: string; strong: boolean }[]` — `**…**`를 조각으로
  - `reportToText(items: ReportItem[], fieldLabel: string, job: string): string` — 복사용 텍스트(별표 제거)

- [ ] **Step 1: 실패하는 테스트**

```ts
import { describe, expect, it } from 'vitest'
import { parseReport, reportToText, splitEmphasis } from './reportParser'

const item = { question: 'Q', answerSummary: 'A', feedback: '좋았지만 **근거**가 필요합니다.' }

describe('parseReport', () => {
  it('코드 펜스를 벗기고 파싱한다', () => {
    const raw = '```json\n' + JSON.stringify([item]) + '\n```'
    expect(parseReport(raw)).toEqual([item])
  })
  it('앞뒤 잡담이 있어도 배열 구간만 파싱한다', () => {
    expect(parseReport('네, 리포트입니다.\n' + JSON.stringify([item]) + '\n감사합니다.')).toEqual([item])
  })
  it('필드가 빠지면 null', () => {
    expect(parseReport(JSON.stringify([{ question: 'Q' }]))).toBeNull()
  })
  it('배열이 아니면 null', () => expect(parseReport('{"a":1}')).toBeNull())
  it('빈 배열은 null', () => expect(parseReport('[]')).toBeNull())
  it('깨진 JSON은 null', () => expect(parseReport('[{')).toBeNull())
})

describe('splitEmphasis', () => {
  it('별표 구간을 strong으로 나눈다', () => {
    expect(splitEmphasis('a **b** c')).toEqual([
      { text: 'a ', strong: false },
      { text: 'b', strong: true },
      { text: ' c', strong: false },
    ])
  })
  it('별표가 없으면 한 조각', () => {
    expect(splitEmphasis('plain')).toEqual([{ text: 'plain', strong: false }])
  })
})

describe('reportToText', () => {
  it('복사 형식과 별표 제거', () => {
    expect(reportToText([item], 'IT', '백엔드')).toBe(
      '모두의 모의면접 리포트 · IT · 백엔드\n\nQ1. Q\n답변 요약: A\n피드백: 좋았지만 근거가 필요합니다.',
    )
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- reportParser` → FAIL

- [ ] **Step 3: 구현**

```ts
export interface ReportItem {
  question: string
  answerSummary: string
  feedback: string
}

function isItem(v: unknown): v is ReportItem {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.question === 'string' &&
    typeof o.answerSummary === 'string' &&
    typeof o.feedback === 'string'
  )
}

export function parseReport(raw: string): ReportItem[] | null {
  let s = raw.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '')
  const start = s.indexOf('[')
  const end = s.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  s = s.slice(start, end + 1)
  try {
    const v: unknown = JSON.parse(s)
    if (!Array.isArray(v) || v.length === 0 || !v.every(isItem)) return null
    return v
  } catch {
    return null
  }
}

export function splitEmphasis(text: string): { text: string; strong: boolean }[] {
  const parts: { text: string; strong: boolean }[] = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0
    if (i > last) parts.push({ text: text.slice(last, i), strong: false })
    parts.push({ text: m[1], strong: true })
    last = i + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), strong: false })
  return parts.length ? parts : [{ text, strong: false }]
}

export function reportToText(items: ReportItem[], fieldLabel: string, job: string): string {
  const strip = (s: string) => s.replace(/\*\*/g, '')
  const body = items
    .map((it, i) => `Q${i + 1}. ${strip(it.question)}\n답변 요약: ${strip(it.answerSummary)}\n피드백: ${strip(it.feedback)}`)
    .join('\n\n')
  return `모두의 모의면접 리포트 · ${fieldLabel} · ${job}\n\n${body}`
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- reportParser` → PASS

- [ ] **Step 5: 커밋**

```bash
git add src/utils/reportParser.ts src/utils/reportParser.test.ts
git commit -m "feat(frontend): 리포트 JSON 파서·강조 분리·복사 텍스트"
```

---

### Task 5: `stores/model.ts` — `init()` (downloaded → initializing → ready)

**Files:**
- Modify: `frontend/src/stores/model.ts`
- Test: `frontend/src/stores/model.test.ts`

**Interfaces:**
- Consumes: `initEngine(blob, {maxNumTokens})`, `disposeEngine()` (Task 1), `getModelBlob(id, url)` (기존 `services/modelCache.ts`)
- Produces:
  - `useModelStore().init(): Promise<void>` — 캐시 Blob → `initEngine` → `status = 'ready'`. 실패 시 `status = 'error'`, `error` 메시지, `initFailed = true`
  - `download()`는 성공 후 자동으로 `init()`을 호출한다(랜딩 → 준비 화면 흐름이 끊기지 않게)
  - `useFallback()`은 폴백으로 바꿔 `download()`(→ init)
  - `MAX_NUM_TOKENS = 8192`

- [ ] **Step 1: 실패하는 테스트 (기존 파일에 추가·수정)**

`model.test.ts` 상단 mock에 llm 추가:

```ts
vi.mock('@/services/llm', () => ({ initEngine: vi.fn(), disposeEngine: vi.fn() }))
import { initEngine } from '@/services/llm'
import { getModelBlob } from '@/services/modelCache'
```

`modelCache` mock에 `getModelBlob: vi.fn()` 추가. `beforeEach`에 `vi.mocked(getModelBlob).mockResolvedValue(new Blob(['x']))`, `vi.mocked(initEngine).mockResolvedValue(undefined)`.

기존 `'download는 진행률을 반영하고 downloaded로 끝난다'`와 `'캐시에 있으면 다운로드를 건너뛴다'`의 기대값을 `'ready'`로 바꾸고, 다음을 추가:

```ts
  it('download 후 init이 이어져 ready가 된다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(initEngine).toHaveBeenCalledWith(expect.any(Blob), { maxNumTokens: 8192 })
    expect(s.status).toBe('ready')
  })

  it('init 실패는 error + initFailed', async () => {
    vi.mocked(initEngine).mockRejectedValue(new Error('gpu oom'))
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(s.status).toBe('error')
    expect(s.error).toBe('gpu oom')
    expect(s.initFailed).toBe(true)
  })

  it('캐시에 Blob이 없으면 error', async () => {
    vi.mocked(getModelBlob).mockResolvedValue(null)
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(s.status).toBe('error')
  })
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- stores/model` → 새 테스트 FAIL(`init` 없음, 상태 `downloaded`)

- [ ] **Step 3: 구현**

`model.ts` 수정:

```ts
import { getModelBlob, clearModels, downloadModel, hasModel } from '@/services/modelCache'
import { disposeEngine, initEngine } from '@/services/llm'

export const MAX_NUM_TOKENS = 8192
```

state에 `initFailed: false` 추가. actions:

```ts
    async download() {
      if (!this.active) {
        this.status = 'error'
        this.error = 'manifest not loaded'
        return
      }
      const { id, url, size } = this.active
      this.status = 'downloading'
      this.error = null
      this.initFailed = false
      try {
        if (await hasModel(id, url)) {
          this.received = size
        } else {
          await downloadModel(id, url, size, (r) => (this.received = r), undefined)
        }
        this.status = 'downloaded'
      } catch (e) {
        this.status = 'error'
        this.error = e instanceof Error ? e.message : String(e)
        return
      }
      await this.init()
    },
    async init() {
      if (!this.active) return
      this.status = 'initializing'
      this.error = null
      try {
        const blob = await getModelBlob(this.active.id, this.active.url)
        if (!blob) throw new Error('cached model not found')
        await initEngine(blob, { maxNumTokens: MAX_NUM_TOKENS })
        this.status = 'ready'
      } catch (e) {
        this.status = 'error'
        this.initFailed = true
        this.error = e instanceof Error ? e.message : String(e)
      }
    },
    retry() {
      return this.download()
    },
    async useFallback() {
      if (!this.manifest?.fallback) return
      await disposeEngine()
      this.setActive(this.manifest.fallback)
      await this.download()
    },
    async clearCache() {
      await disposeEngine()
      await clearModels()
      this.received = 0
      this.status = 'idle'
      this.error = null
      this.initFailed = false
    },
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- stores/model` → PASS. `PrepareView.test.ts`도 실행해 `ready` 관련 기대가 깨지지 않는지 확인: `pnpm test -- PrepareView`.

- [ ] **Step 5: 커밋**

```bash
git add src/stores/model.ts src/stores/model.test.ts
git commit -m "feat(frontend): 모델 스토어 init — 캐시 Blob으로 엔진 초기화, downloaded→initializing→ready"
```

---

### Task 6: `stores/interview.ts` — 대화·stage·스트리밍·종료·리포트

**Files:**
- Modify: `frontend/src/stores/interview.ts`, `frontend/src/views/PrepareView.vue:118-120`
- Test: `frontend/src/stores/interview.test.ts`

**Interfaces:**
- Consumes: `startSession(systemPrompt): Promise<LlmSession>` (Task 1), `ThoughtFilter`, `approxTokens`, `hasEndPhrase`, `isGoodAnswer` (Task 2), `buildSystemPrompt`, `KICKOFF`, `REPORT_INSTRUCTION` (Task 3), `parseReport`, `ReportItem` (Task 4), `useModelStore().manifest.systemPromptOverride`
- Produces (state):
  - `messages: { role: 'user' | 'model'; text: string }[]` (킥오프·리포트 지시문은 제외)
  - `stage: 'idle' | 'asking' | 'waiting' | 'listening' | 'thinking'`
  - `streaming: string` (현재 면접관 발화, 스트리밍 중 누적), `generating: boolean`, `genError: string | null`
  - `reactPending: boolean` (직전 답변이 좋은 답변 → 화면이 react 1회 재생 후 `consumeReact()`)
  - `ended: boolean` (종료 문장 감지), `tokenCount: number`, `overLimit: boolean` (getter, `> TOKEN_LIMIT`)
  - `report: ReportItem[] | null`, `reportRaw: string`, `reportStatus: 'idle' | 'writing' | 'done' | 'error'`
  - `TOKEN_LIMIT = 6500`
- Produces (actions): `start()`, `send(text)`, `abort()`, `retryLast()`, `setListening(on: boolean)`, `consumeReact()`, `finish()`, `reset()`

- [ ] **Step 1: 실패하는 테스트 (기존 파일에 추가)**

상단 mock 추가:

```ts
vi.mock('@/services/llm', () => ({ startSession: vi.fn() }))
import { startSession } from '@/services/llm'
import type { LlmSession } from '@/services/llm'

function fakeSession(replies: string[], tokens = 100): LlmSession & { sent: string[] } {
  const sent: string[] = []
  let i = 0
  return {
    sent,
    async send(text, onToken, signal) {
      sent.push(text)
      const reply = replies[i++] ?? ''
      for (const ch of reply.split(' ')) {
        if (signal?.aborted) break
        onToken(ch + ' ')
        await Promise.resolve()
      }
      return reply + ' '
    },
    async tokenCount() {
      return tokens
    },
    async dispose() {},
  }
}

async function readyStore() {
  const model = useModelStore()
  model.status = 'ready'
  model.manifest = {
    id: 'e4b', url: '/models/e4b', size: 1,
    template: { turnStart: '', turnEnd: '', roles: {} },
    systemPromptOverride: null, fallback: null,
  }
  const s = useInterviewStore()
  await s.setField('it')
  s.setJob('백엔드')
  s.setResume('cv.pdf', '가'.repeat(100))
  return s
}
```

테스트:

```ts
describe('interview flow', () => {
  it('start는 시스템 프롬프트로 세션을 열고 킥오프를 보내 첫 질문을 받는다', async () => {
    const sess = fakeSession(['자기소개를 해주세요.'])
    vi.mocked(startSession).mockResolvedValue(sess)
    const s = await readyStore()
    await s.start()
    expect(startSession).toHaveBeenCalledWith(expect.stringContaining('IT 분야'))
    expect(sess.sent[0]).toBe('면접을 시작해 주세요.')
    expect(s.phase).toBe('interview')
    expect(s.messages).toEqual([{ role: 'model', text: '자기소개를 해주세요. ' }])
    expect(s.stage).toBe('waiting')
    expect(s.tokenCount).toBe(100)
  })

  it('send는 user 턴을 기록하고 응답을 스트리밍한다', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['첫 질문', '꼬리 질문']))
    const s = await readyStore()
    await s.start()
    await s.send('제 답변입니다')
    expect(s.messages.map((m) => m.role)).toEqual(['model', 'user', 'model'])
    expect(s.messages[2].text).toBe('꼬리 질문 ')
    expect(s.stage).toBe('waiting')
  })

  it('좋은 답변이면 reactPending', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q', 'q2']))
    const s = await readyStore()
    await s.start()
    await s.send('저는 개발자입니다. '.repeat(15))
    expect(s.reactPending).toBe(true)
    s.consumeReact()
    expect(s.reactPending).toBe(false)
  })

  it('종료 문장이 나오면 ended', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q', '수고하셨습니다. 면접을 마치겠습니다.']))
    const s = await readyStore()
    await s.start()
    await s.send('답')
    expect(s.ended).toBe(true)
  })

  it('setListening은 waiting↔listening만 바꾼다', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await readyStore()
    await s.start()
    s.setListening(true)
    expect(s.stage).toBe('listening')
    s.setListening(false)
    expect(s.stage).toBe('waiting')
  })

  it('생성 실패는 genError + 마지막 user 턴을 retryLast로 재전송', async () => {
    const sess = fakeSession(['q'])
    let fail = true
    const origSend = sess.send
    sess.send = async (t, on, sig) => {
      if (fail && t === '답') {
        fail = false
        throw new Error('boom')
      }
      return origSend(t, on, sig)
    }
    vi.mocked(startSession).mockResolvedValue(sess)
    const s = await readyStore()
    await s.start()
    await s.send('답')
    expect(s.genError).toBe('boom')
    expect(s.messages.at(-1)).toEqual({ role: 'user', text: '답' })
    await s.retryLast()
    expect(s.genError).toBeNull()
    expect(s.messages.at(-1)?.role).toBe('model')
  })

  it('finish는 리포트 지시문을 보내고 파싱한다', async () => {
    const json = JSON.stringify([{ question: 'Q', answerSummary: 'A', feedback: 'F' }])
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q', '```json\n' + json + '\n```']))
    const s = await readyStore()
    await s.start()
    await s.finish()
    expect(s.phase).toBe('report')
    expect(s.reportStatus).toBe('done')
    expect(s.report).toEqual([{ question: 'Q', answerSummary: 'A', feedback: 'F' }])
  })

  it('리포트 파싱 실패는 report null + reportRaw 유지', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q', '그냥 텍스트']))
    const s = await readyStore()
    await s.start()
    await s.finish()
    expect(s.report).toBeNull()
    expect(s.reportRaw).toContain('그냥 텍스트')
    expect(s.reportStatus).toBe('done')
  })

  it('tokenCount가 -1이면 근사치를 쓴다', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['가나다'], -1))
    const s = await readyStore()
    await s.start()
    expect(s.tokenCount).toBeGreaterThan(0)
  })

  it('reset은 대화·리포트를 비우고 prepare로 간다', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await readyStore()
    await s.start()
    await s.reset()
    expect(s.phase).toBe('prepare')
    expect(s.messages).toEqual([])
    expect(s.report).toBeNull()
    expect(s.profile.job).toBe('')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- stores/interview` → 새 테스트 FAIL

- [ ] **Step 3: 구현**

`interview.ts`에 import 추가:

```ts
import { startSession, type LlmSession } from '@/services/llm'
import { buildSystemPrompt, KICKOFF } from '@/prompts/interviewer'
import { REPORT_INSTRUCTION } from '@/prompts/report'
import { ThoughtFilter } from '@/utils/thoughts'
import { approxTokens } from '@/utils/tokens'
import { hasEndPhrase } from '@/utils/endDetector'
import { isGoodAnswer } from '@/utils/goodAnswer'
import { parseReport, type ReportItem } from '@/utils/reportParser'

export type Stage = 'idle' | 'asking' | 'waiting' | 'listening' | 'thinking'
export interface ChatMessage {
  role: 'user' | 'model'
  text: string
}
export const TOKEN_LIMIT = 6500

let session: LlmSession | null = null // 모듈 스코프: Pinia state에 비직렬 객체를 넣지 않는다
let abortCtl: AbortController | null = null
```

state 추가:

```ts
    messages: [] as ChatMessage[],
    stage: 'idle' as Stage,
    streaming: '',
    generating: false,
    genError: null as string | null,
    reactPending: false,
    ended: false,
    tokenCount: 0,
    report: null as ReportItem[] | null,
    reportRaw: '',
    reportStatus: 'idle' as 'idle' | 'writing' | 'done' | 'error',
```

getters 추가:

```ts
    overLimit: (s) => s.tokenCount > TOKEN_LIMIT,
```

actions 추가:

```ts
    async start() {
      if (!this.canStart || !this.profile.field) return
      const model = useModelStore()
      const prompt = buildSystemPrompt({
        fieldLabel: FIELD_LABELS[this.profile.field],
        job: this.profile.job,
        resumeText: this.resumeText,
        fallbackQuestions: this.fallbackQuestions,
        override: model.manifest?.systemPromptOverride,
      })
      if (session) await session.dispose().catch(() => undefined)
      session = await startSession(prompt)
      this.messages = []
      this.ended = false
      this.genError = null
      this.report = null
      this.reportRaw = ''
      this.reportStatus = 'idle'
      this.phase = 'interview'
      await this.generate(KICKOFF, { record: false })
    },

    async send(text: string) {
      const t = text.trim()
      if (!t || this.generating || this.ended) return
      this.messages.push({ role: 'user', text: t })
      this.reactPending = isGoodAnswer(t)
      await this.generate(t, { record: true })
    },

    /** 내부: user 턴을 보내고 응답을 스트리밍해 messages에 확정한다 */
    async generate(userText: string, opts: { record: boolean }) {
      if (!session) return
      this.generating = true
      this.genError = null
      this.streaming = ''
      this.stage = 'thinking'
      abortCtl = new AbortController()
      const filter = new ThoughtFilter()
      let first = true
      try {
        await session.send(
          userText,
          (delta) => {
            const shown = filter.push(delta)
            if (!shown) return
            if (first) {
              first = false
              this.stage = 'asking'
            }
            this.streaming += shown
          },
          abortCtl.signal,
        )
        this.streaming += filter.flush()
        const text = this.streaming.trim()
        if (text) this.messages.push({ role: 'model', text: this.streaming })
        if (hasEndPhrase(text)) this.ended = true
      } catch (e) {
        this.genError = e instanceof Error ? e.message : String(e)
      } finally {
        this.generating = false
        this.stage = 'waiting'
        abortCtl = null
        await this.refreshTokens()
      }
      void opts
    },

    abort() {
      abortCtl?.abort()
    },

    async retryLast() {
      const last = this.messages.at(-1)
      if (!last || last.role !== 'user' || this.generating) return
      await this.generate(last.text, { record: true })
    },

    setListening(on: boolean) {
      if (this.generating) return
      if (on && this.stage === 'waiting') this.stage = 'listening'
      if (!on && this.stage === 'listening') this.stage = 'waiting'
    },

    consumeReact() {
      this.reactPending = false
    },

    async refreshTokens() {
      const n = session ? await session.tokenCount() : -1
      this.tokenCount = n >= 0 ? n : approxTokens(this.messages.map((m) => m.text).join('\n'))
    },

    async finish() {
      if (!session || this.reportStatus === 'writing') return
      if (this.generating) this.abort()
      this.phase = 'report'
      this.reportStatus = 'writing'
      this.reportRaw = ''
      try {
        const raw = await session.send(REPORT_INSTRUCTION, (d) => (this.reportRaw += d))
        this.reportRaw = raw
        this.report = parseReport(raw)
        this.reportStatus = 'done'
      } catch (e) {
        this.genError = e instanceof Error ? e.message : String(e)
        this.reportStatus = 'error'
      }
    },

    async reset() {
      if (session) await session.dispose().catch(() => undefined)
      session = null
      this.messages = []
      this.stage = 'idle'
      this.streaming = ''
      this.generating = false
      this.genError = null
      this.reactPending = false
      this.ended = false
      this.tokenCount = 0
      this.report = null
      this.reportRaw = ''
      this.reportStatus = 'idle'
      this.profile = { field: null, job: '' }
      this.resumeText = ''
      this.resumeName = null
      this.fallbackQuestions = []
      this.phase = 'prepare'
    },
```

`generate`의 `void opts`는 `record` 옵션이 현재 분기에 쓰이지 않아 lint 경고를 피하려는 것이다 — 그 대신 옵션 자체를 없애도 된다(킥오프는 `send`를 거치지 않으므로 user 턴이 기록되지 않음). **옵션을 없애고 시그니처를 `generate(userText: string)`로 단순화한다.** 위 코드의 `{ record: ... }` 인자와 `void opts`를 모두 제거.

`PrepareView.vue`의 `start()`:

```ts
function start() {
  if (interview.canStart) void interview.start()
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- stores` → 전부 PASS. `pnpm exec vue-tsc --noEmit` 통과.

- [ ] **Step 5: 커밋**

```bash
git add src/stores/interview.ts src/stores/interview.test.ts src/views/PrepareView.vue
git commit -m "feat(frontend): 면접 스토어 — 세션 시작·스트리밍·stage·종료 감지·리포트 생성"
```

---

### Task 7: `services/speech.ts` + 타입

**Files:**
- Create: `frontend/src/services/speech.ts`
- Modify: `frontend/src/env.d.ts`
- Test: `frontend/src/services/speech.test.ts`

**Interfaces:**
- Produces: `speechSupported(): boolean`, `startSpeech(onInterim: (t: string) => void, onFinal: (t: string) => void, onError: (msg: string) => void): void`, `stopSpeech(): void`, `isSpeechActive(): boolean`

- [ ] **Step 1: 타입 선언 (`env.d.ts`에 추가)**

```ts
interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: { transcript: string }
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}
interface Window {
  SpeechRecognition?: new () => SpeechRecognitionLike
  webkitSpeechRecognition?: new () => SpeechRecognitionLike
}
```

- [ ] **Step 2: 실패하는 테스트**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSpeechActive, speechSupported, startSpeech, stopSpeech } from './speech'

class FakeRec extends EventTarget implements SpeechRecognitionLike {
  static last: FakeRec | null = null
  lang = ''
  continuous = false
  interimResults = false
  onresult: SpeechRecognitionLike['onresult'] = null
  onerror: SpeechRecognitionLike['onerror'] = null
  onend: SpeechRecognitionLike['onend'] = null
  started = 0
  stopped = 0
  constructor() {
    super()
    FakeRec.last = this
  }
  start() {
    this.started++
  }
  stop() {
    this.stopped++
    this.onend?.()
  }
}

afterEach(() => {
  stopSpeech()
  delete (window as Window).webkitSpeechRecognition
})

describe('speech', () => {
  it('미지원이면 supported=false', () => {
    expect(speechSupported()).toBe(false)
  })
  it('ko-KR·continuous·interim으로 시작하고 결과를 나눠 전달한다', () => {
    ;(window as Window).webkitSpeechRecognition = FakeRec
    const interim = vi.fn()
    const final = vi.fn()
    startSpeech(interim, final, vi.fn())
    const r = FakeRec.last!
    expect(r.lang).toBe('ko-KR')
    expect(r.continuous).toBe(true)
    expect(r.interimResults).toBe(true)
    expect(r.started).toBe(1)
    expect(isSpeechActive()).toBe(true)
    r.onresult!({
      resultIndex: 0,
      results: [{ isFinal: false, 0: { transcript: '안녕' } }, { isFinal: true, 0: { transcript: '하세요' } }],
    } as unknown as SpeechRecognitionEventLike)
    expect(interim).toHaveBeenCalledWith('안녕')
    expect(final).toHaveBeenCalledWith('하세요')
    stopSpeech()
    expect(r.stopped).toBe(1)
    expect(isSpeechActive()).toBe(false)
  })
  it('오류는 onError로 전달하고 비활성이 된다', () => {
    ;(window as Window).webkitSpeechRecognition = FakeRec
    const err = vi.fn()
    startSpeech(vi.fn(), vi.fn(), err)
    FakeRec.last!.onerror!({ error: 'not-allowed' })
    expect(err).toHaveBeenCalledWith('not-allowed')
    expect(isSpeechActive()).toBe(false)
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm test -- speech` → FAIL

- [ ] **Step 4: 구현**

```ts
let rec: SpeechRecognitionLike | null = null

function ctor() {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

export function speechSupported(): boolean {
  return ctor() !== null
}

export function isSpeechActive(): boolean {
  return rec !== null
}

export function startSpeech(
  onInterim: (t: string) => void,
  onFinal: (t: string) => void,
  onError: (msg: string) => void,
): void {
  const C = ctor()
  if (!C || rec) return
  const r = new C()
  r.lang = 'ko-KR'
  r.continuous = true
  r.interimResults = true
  r.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]
      const t = res[0].transcript
      if (res.isFinal) onFinal(t)
      else onInterim(t)
    }
  }
  r.onerror = (e) => {
    onError(e.error)
    rec = null
  }
  r.onend = () => {
    rec = null
  }
  rec = r
  r.start()
}

export function stopSpeech(): void {
  const r = rec
  rec = null
  r?.stop()
}
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm test -- speech` → PASS. `pnpm lint` 통과(전역 타입은 `env.d.ts`의 ambient 선언).

- [ ] **Step 6: 커밋**

```bash
git add src/services/speech.ts src/services/speech.test.ts src/env.d.ts
git commit -m "feat(frontend): Web Speech API 래퍼 (ko-KR, continuous, interim)"
```

---

### Task 8: 면접 컴포넌트 — `interviewerAnims.ts` · `InterviewStage.vue` · `ChatLog.vue`

**Files:**
- Create: `frontend/src/components/interview/interviewerAnims.ts`, `InterviewStage.vue`, `ChatLog.vue`
- Test: `frontend/src/components/interview/interviewerAnims.test.ts`, `InterviewStage.test.ts`

**Interfaces:**
- Consumes: `SpriteFrame`(props `src frameW frameH frames scale index fps`), 스프라이트 시트 `/sprites/interviewers/<name>.png` (`public/sprites/interviewers/manifest.json`과 동일한 프레임 수)
- Produces:
  - `animsFor(stage: Stage, opts: { react: boolean; watch: boolean }): { left: AnimName; center: AnimName; clerk: AnimName }`
  - `ANIMS: Record<AnimName, { file: string; frames: number; loop: boolean }>`
  - `<InterviewStage :stage :bubble :streaming :react-pending :watch-tick :field-label :job @react-done @end />`
  - `<ChatLog :messages />`

- [ ] **Step 1: 실패하는 테스트**

`interviewerAnims.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ANIMS, animsFor } from './interviewerAnims'

describe('animsFor', () => {
  it('대기: idle/idle/idle', () =>
    expect(animsFor('waiting', { react: false, watch: false })).toEqual({
      left: 'left_idle', center: 'center_idle', clerk: 'clerk_idle',
    }))
  it('질문 중: idle/talk/idle', () =>
    expect(animsFor('asking', { react: false, watch: false }).center).toBe('center_talk'))
  it('듣는 중: idle/nod/write', () =>
    expect(animsFor('listening', { react: false, watch: false })).toEqual({
      left: 'left_idle', center: 'center_nod', clerk: 'clerk_write',
    }))
  it('좋은 답변: react/react/write', () =>
    expect(animsFor('thinking', { react: true, watch: false })).toEqual({
      left: 'left_react', center: 'center_react', clerk: 'clerk_write',
    }))
  it('답변 지연: watch/watch/idle', () =>
    expect(animsFor('waiting', { react: false, watch: true })).toEqual({
      left: 'left_watch', center: 'center_watch', clerk: 'clerk_idle',
    }))
  it('프레임 수는 manifest와 같다', () => {
    expect(ANIMS.center_talk.frames).toBe(7)
    expect(ANIMS.left_react.frames).toBe(9)
    expect(ANIMS.clerk_write.frames).toBe(9)
  })
})
```

`InterviewStage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import InterviewStage from './InterviewStage.vue'

const base = { stage: 'waiting' as const, bubble: '자기소개를 해주세요.', streaming: false, reactPending: false, watchTick: 0, fieldLabel: 'IT', job: '백엔드' }

describe('InterviewStage', () => {
  it('말풍선·분야·직무를 표시하고 질문 번호는 없다', () => {
    const w = mount(InterviewStage, { props: base })
    expect(w.text()).toContain('자기소개를 해주세요.')
    expect(w.text()).toContain('IT')
    expect(w.text()).toContain('백엔드')
    expect(w.text()).not.toMatch(/질문\s*\d|\d\s*\/\s*\d|남은/)
  })
  it('면접 종료 버튼은 end를 emit한다', async () => {
    const w = mount(InterviewStage, { props: base })
    await w.find('[data-test="end"]').trigger('click')
    expect(w.emitted('end')).toHaveLength(1)
  })
  it('스프라이트 3장 + 지원자 정수리', () => {
    const w = mount(InterviewStage, { props: base })
    expect(w.findAll('.sprite').length).toBe(4)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- components/interview` → FAIL

- [ ] **Step 3: 구현**

`interviewerAnims.ts`:

```ts
import type { Stage } from '@/stores/interview'

export type AnimName =
  | 'left_idle' | 'left_react' | 'left_watch'
  | 'center_idle' | 'center_talk' | 'center_nod' | 'center_react' | 'center_watch'
  | 'clerk_idle' | 'clerk_write'

/** public/sprites/interviewers/manifest.json과 동일하게 유지한다 (32×32, 0번 기본 + 1..N 루프) */
export const ANIMS: Record<AnimName, { file: string; frames: number; loop: boolean }> = {
  left_idle: { file: '/sprites/interviewers/left_idle.png', frames: 5, loop: true },
  left_react: { file: '/sprites/interviewers/left_react.png', frames: 9, loop: false },
  left_watch: { file: '/sprites/interviewers/left_watch.png', frames: 9, loop: false },
  center_idle: { file: '/sprites/interviewers/center_idle.png', frames: 5, loop: true },
  center_talk: { file: '/sprites/interviewers/center_talk.png', frames: 7, loop: true },
  center_nod: { file: '/sprites/interviewers/center_nod.png', frames: 5, loop: true },
  center_react: { file: '/sprites/interviewers/center_react.png', frames: 9, loop: false },
  center_watch: { file: '/sprites/interviewers/center_watch.png', frames: 9, loop: false },
  clerk_idle: { file: '/sprites/interviewers/clerk_idle.png', frames: 5, loop: true },
  clerk_write: { file: '/sprites/interviewers/clerk_write.png', frames: 9, loop: true },
}
export const CANDIDATE_BACK = { file: '/sprites/interviewers/candidate_back.png', w: 48, h: 32 }
export const FPS = 10
export const SCALE = 6

export function animsFor(stage: Stage, o: { react: boolean; watch: boolean }) {
  if (o.react) return { left: 'left_react', center: 'center_react', clerk: 'clerk_write' } as const
  if (o.watch) return { left: 'left_watch', center: 'center_watch', clerk: 'clerk_idle' } as const
  switch (stage) {
    case 'asking':
      return { left: 'left_idle', center: 'center_talk', clerk: 'clerk_idle' } as const
    case 'listening':
    case 'thinking':
      return { left: 'left_idle', center: 'center_nod', clerk: 'clerk_write' } as const
    default:
      return { left: 'left_idle', center: 'center_idle', clerk: 'clerk_idle' } as const
  }
}
```

`InterviewStage.vue` — 1회 재생(react·watch)은 `frames-1` 프레임 × 100ms 뒤에 끝난 것으로 보고 `react-done`을 emit한다(`SpriteFrame`은 루프만 지원하므로 1회 재생 동안만 해당 시트를 보여주고 타이머로 되돌린다):

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import SpriteFrame from '@/components/ui/SpriteFrame.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import PixelTag from '@/components/ui/PixelTag.vue'
import type { Stage } from '@/stores/interview'
import { ANIMS, CANDIDATE_BACK, FPS, SCALE, animsFor } from './interviewerAnims'

const props = defineProps<{
  stage: Stage
  bubble: string
  streaming: boolean
  reactPending: boolean
  watchTick: number
  fieldLabel: string
  job: string
}>()
const emit = defineEmits<{ 'react-done': []; end: [] }>()

const reacting = ref(false)
const watching = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null
function playOnce(kind: 'react' | 'watch') {
  if (timer) clearTimeout(timer)
  const flag = kind === 'react' ? reacting : watching
  flag.value = true
  const frames = ANIMS[kind === 'react' ? 'center_react' : 'center_watch'].frames
  timer = setTimeout(() => {
    flag.value = false
    if (kind === 'react') emit('react-done')
  }, (frames - 1) * (1000 / FPS))
}
watch(() => props.reactPending, (v) => v && playOnce('react'))
watch(() => props.watchTick, (v) => v > 0 && playOnce('watch'))
onBeforeUnmount(() => timer && clearTimeout(timer))

const anims = computed(() => animsFor(props.stage, { react: reacting.value, watch: watching.value }))
const sheet = (name: keyof typeof ANIMS) => ANIMS[name]
</script>

<template>
  <section class="stage" aria-label="면접실">
    <div class="topbar">
      <PixelTag tone="muted">{{ fieldLabel }} · {{ job }}</PixelTag>
      <PixelButton variant="secondary" data-test="end" @click="emit('end')">면접 종료</PixelButton>
    </div>

    <div class="bubble mono" :class="{ streaming }" aria-live="polite">
      <span>{{ bubble || '…' }}</span><span v-if="streaming" class="blink">▌</span>
    </div>

    <div class="row">
      <SpriteFrame :src="sheet(anims.left).file" :frame-w="32" :frame-h="32" :frames="sheet(anims.left).frames" :scale="SCALE" :fps="FPS" />
      <SpriteFrame :src="sheet(anims.center).file" :frame-w="32" :frame-h="32" :frames="sheet(anims.center).frames" :scale="SCALE" :fps="FPS" />
      <SpriteFrame :src="sheet(anims.clerk).file" :frame-w="32" :frame-h="32" :frames="sheet(anims.clerk).frames" :scale="SCALE" :fps="FPS" />
    </div>
    <div class="desk" />
    <div class="candidate">
      <SpriteFrame :src="CANDIDATE_BACK.file" :frame-w="CANDIDATE_BACK.w" :frame-h="CANDIDATE_BACK.h" :frames="1" :scale="SCALE" />
    </div>
  </section>
</template>

<style scoped>
.stage {
  position: relative;
  background: var(--win);
  border: var(--win-border);
  box-shadow: var(--win-inner);
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.stage::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 24px;
  background: var(--bg);
}
.topbar {
  position: absolute;
  inset: var(--sp-4) var(--sp-4) auto var(--sp-4);
  display: flex;
  justify-content: space-between;
  align-items: center;
  z-index: 2;
}
.bubble {
  margin-top: 72px;
  max-width: 720px;
  min-height: 72px;
  padding: var(--sp-4) var(--sp-5);
  background: var(--bg);
  color: var(--text);
  border: var(--win-border);
  font-size: var(--fs-body-md);
  line-height: 1.6;
  white-space: pre-wrap;
  position: relative;
}
.bubble::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -12px;
  width: 12px;
  height: 12px;
  background: var(--bg);
  transform: translateX(-50%) rotate(45deg);
}
.row {
  display: flex;
  gap: var(--sp-8);
  margin-top: var(--sp-6);
}
.desk {
  width: 80%;
  height: 48px;
  margin-top: -8px;
  background: var(--raise);
  border-bottom: 4px solid var(--bg);
}
.candidate {
  position: absolute;
  bottom: -64px;
  left: 50%;
  transform: translateX(-50%);
}
</style>
```

`ChatLog.vue`:

```vue
<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { ChatMessage } from '@/stores/interview'

const props = defineProps<{ messages: ChatMessage[] }>()
const box = ref<HTMLElement | null>(null)
watch(
  () => props.messages.length,
  async () => {
    await nextTick()
    box.value?.scrollTo({ top: box.value.scrollHeight })
  },
)
</script>

<template>
  <div ref="box" class="log" aria-label="대화 기록">
    <div v-for="(m, i) in messages" :key="i" class="line" :class="m.role">
      <span class="mono role">{{ m.role === 'model' ? '면접관' : '지원자' }}</span>
      <p class="text">{{ m.text }}</p>
    </div>
  </div>
</template>

<style scoped>
.log {
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding-right: var(--sp-2);
}
.line {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: var(--sp-3);
}
.role {
  color: var(--text-3);
  font-size: var(--fs-meta);
  padding-top: 2px;
}
.user .role {
  color: var(--accent);
}
.text {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.6;
  font-size: var(--fs-body-sm);
}
</style>
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- components/interview` → PASS

- [ ] **Step 5: 커밋**

```bash
git add src/components/interview
git commit -m "feat(frontend): 면접실 무대(면접관 3인·말풍선·상태 애니)와 대화 기록 컴포넌트"
```

---

### Task 9: `AnswerInput.vue` — 답변 입력 · 말하기 토글 · 전송/중단

**Files:**
- Create: `frontend/src/components/interview/AnswerInput.vue`
- Test: `frontend/src/components/interview/AnswerInput.test.ts`

**Interfaces:**
- Consumes: `speechSupported/startSpeech/stopSpeech` (Task 7), `PixelButton`
- Produces: `<AnswerInput :generating :disabled @send="(text)" @abort @typing="(hasText: boolean)" />`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@/services/speech', () => ({
  speechSupported: vi.fn(() => false),
  startSpeech: vi.fn(),
  stopSpeech: vi.fn(),
  isSpeechActive: vi.fn(() => false),
}))
import { speechSupported, startSpeech } from '@/services/speech'
import AnswerInput from './AnswerInput.vue'

beforeEach(() => vi.mocked(speechSupported).mockReturnValue(false))

describe('AnswerInput', () => {
  it('Enter로 전송, Shift+Enter는 줄바꿈', async () => {
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    const ta = w.find('textarea')
    await ta.setValue('답변')
    await ta.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(w.emitted('send')).toBeUndefined()
    await ta.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('send')?.[0]).toEqual(['답변'])
    expect((ta.element as HTMLTextAreaElement).value).toBe('')
  })
  it('빈 입력은 전송하지 않는다', async () => {
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    await w.find('[data-test="send"]').trigger('click')
    expect(w.emitted('send')).toBeUndefined()
  })
  it('생성 중이면 입력 비활성 + 버튼이 중단', async () => {
    const w = mount(AnswerInput, { props: { generating: true, disabled: false } })
    expect(w.find('textarea').attributes('disabled')).toBeDefined()
    expect(w.find('[data-test="send"]').text()).toBe('중단')
    await w.find('[data-test="send"]').trigger('click')
    expect(w.emitted('abort')).toHaveLength(1)
  })
  it('typing은 입력 유무를 emit한다', async () => {
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    await w.find('textarea').setValue('a')
    expect(w.emitted('typing')?.at(-1)).toEqual([true])
    await w.find('textarea').setValue('')
    expect(w.emitted('typing')?.at(-1)).toEqual([false])
  })
  it('음성 미지원이면 말하기 버튼 비활성', () => {
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    expect(w.find('[data-test="mic"]').attributes('disabled')).toBeDefined()
  })
  it('말하기 ON이면 확정 결과를 덧붙이고 자동 전송하지 않는다', async () => {
    vi.mocked(speechSupported).mockReturnValue(true)
    vi.mocked(startSpeech).mockImplementation((_i, onFinal) => onFinal('안녕하세요'))
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    await w.find('textarea').setValue('기존 ')
    await w.find('[data-test="mic"]').trigger('click')
    expect((w.find('textarea').element as HTMLTextAreaElement).value).toBe('기존 안녕하세요')
    expect(w.emitted('send')).toBeUndefined()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- AnswerInput` → FAIL

- [ ] **Step 3: 구현**

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import { speechSupported, startSpeech, stopSpeech } from '@/services/speech'

const props = defineProps<{ generating: boolean; disabled: boolean }>()
const emit = defineEmits<{ send: [text: string]; abort: []; typing: [hasText: boolean] }>()

const text = ref('')
const interim = ref('')
const listening = ref(false)
const micError = ref('')
const supported = speechSupported()

watch(text, (v) => emit('typing', v.trim().length > 0))

function submit() {
  if (props.generating) {
    emit('abort')
    return
  }
  const t = text.value.trim()
  if (!t || props.disabled) return
  emit('send', t)
  text.value = ''
  interim.value = ''
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    submit()
  }
}
function toggleMic() {
  if (!supported || props.disabled || props.generating) return
  if (listening.value) {
    stopSpeech()
    listening.value = false
    interim.value = ''
    return
  }
  micError.value = ''
  listening.value = true
  startSpeech(
    (t) => (interim.value = t),
    (t) => {
      text.value += t
      interim.value = ''
    },
    (err) => {
      micError.value = err === 'not-allowed' ? '마이크 권한이 거부되었습니다' : `음성 인식 오류: ${err}`
      listening.value = false
      interim.value = ''
    },
    () => {
      // 브라우저가 무음 등으로 스스로 끝냄 — 토글 표시를 내린다
      listening.value = false
      interim.value = ''
    },
  )
}
watch(
  () => props.generating,
  (g) => {
    if (g && listening.value) {
      stopSpeech()
      listening.value = false
      interim.value = ''
    }
  },
)
onBeforeUnmount(() => listening.value && stopSpeech())

const micTitle = computed(() =>
  !supported ? '이 브라우저는 음성 인식을 지원하지 않습니다' : micError.value || (listening.value ? '듣는 중 — 다시 누르면 종료' : '말하기'),
)
</script>

<template>
  <div class="input-panel">
    <div class="ta-wrap" :class="{ listening }">
      <textarea
        v-model="text"
        class="input mono"
        rows="4"
        placeholder="답변을 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)"
        :disabled="generating || disabled"
        @keydown="onKey"
      />
      <div v-if="interim" class="interim mono" aria-live="polite">{{ interim }}</div>
    </div>
    <div class="actions">
      <button
        type="button"
        class="mic display"
        :class="{ on: listening }"
        data-test="mic"
        :title="micTitle"
        :disabled="!supported || generating || disabled"
        @click="toggleMic"
      >
        <span v-if="listening" class="dot blink" />{{ listening ? '듣는 중' : '말하기' }}
      </button>
      <PixelButton data-test="send" :disabled="disabled && !generating" @click="submit">
        {{ generating ? '중단' : '전송' }}
      </PixelButton>
    </div>
    <p v-if="micError" class="mono err">{{ micError }}</p>
  </div>
</template>

<style scoped>
.input-panel {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  height: 100%;
}
.ta-wrap {
  position: relative;
  flex: 1;
}
.ta-wrap textarea {
  width: 100%;
  height: 100%;
  resize: none;
}
.ta-wrap.listening textarea {
  border-color: var(--accent);
}
.interim {
  position: absolute;
  left: var(--sp-3);
  bottom: var(--sp-2);
  color: var(--text-2);
  font-size: var(--fs-meta);
  pointer-events: none;
}
.actions {
  display: flex;
  gap: var(--sp-3);
  justify-content: flex-end;
}
.mic {
  background: var(--raise);
  color: var(--text);
  border: var(--win-border);
  padding: var(--sp-2) var(--sp-4);
  font-size: var(--fs-button);
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  cursor: pointer;
}
.mic.on {
  background: var(--accent);
  color: var(--bg);
}
.mic:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dot {
  width: 8px;
  height: 8px;
  background: currentColor;
}
.err {
  color: var(--danger);
  font-size: var(--fs-meta);
  margin: 0;
}
</style>
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- AnswerInput` → PASS

- [ ] **Step 5: 커밋**

```bash
git add src/components/interview/AnswerInput.vue src/components/interview/AnswerInput.test.ts
git commit -m "feat(frontend): 답변 입력 — Enter 전송, 말하기 토글(덧붙이기), 생성 중 중단"
```

---

### Task 10: `InterviewView.vue` — 조립 · 답변 지연 watch · 종료 확인 · 토큰 한도

**Files:**
- Modify: `frontend/src/views/InterviewView.vue` (자리표시자 교체)
- Test: `frontend/src/views/InterviewView.test.ts`

**Interfaces:**
- Consumes: `useInterviewStore()` (Task 6), `InterviewStage`, `ChatLog`, `AnswerInput` (Task 8·9), `PixelWindow`, `PixelButton`
- Produces: 화면. 종료 확인은 브라우저 `confirm()` 대신 인라인 확인 창(자동화·테스트 가능).

- [ ] **Step 1: 실패하는 테스트**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/llm', () => ({ startSession: vi.fn() }))
vi.mock('@/services/api', () => ({ getQuestions: vi.fn(), getManifest: vi.fn() }))
vi.mock('@/services/speech', () => ({
  speechSupported: () => false, startSpeech: vi.fn(), stopSpeech: vi.fn(), isSpeechActive: () => false,
}))
import { useInterviewStore } from '@/stores/interview'
import InterviewView from './InterviewView.vue'

beforeEach(() => setActivePinia(createPinia()))

function mountWith(patch: Partial<ReturnType<typeof useInterviewStore>['$state']>) {
  const s = useInterviewStore()
  s.$patch({ phase: 'interview', stage: 'waiting', profile: { field: 'it', job: '백엔드' }, ...patch })
  return { w: mount(InterviewView, { attachTo: document.body }), s }
}

describe('InterviewView', () => {
  it('말풍선에는 스트리밍 중 텍스트, 아니면 마지막 면접관 발화', () => {
    const { w } = mountWith({ messages: [{ role: 'model', text: '첫 질문' }] })
    expect(w.text()).toContain('첫 질문')
  })
  it('면접 종료 → 인라인 확인 → 확인하면 finish', async () => {
    const { w, s } = mountWith({ messages: [{ role: 'model', text: 'q' }] })
    const finish = vi.spyOn(s, 'finish').mockResolvedValue()
    await w.find('[data-test="end"]').trigger('click')
    expect(w.text()).toContain('지금까지의 답변으로 리포트를 만들까요?')
    await w.find('[data-test="end-confirm"]').trigger('click')
    expect(finish).toHaveBeenCalled()
  })
  it('토큰 한도를 넘으면 입력을 막고 안내를 띄운다', () => {
    const { w } = mountWith({ tokenCount: 7000, messages: [{ role: 'model', text: 'q' }] })
    expect(w.text()).toContain('면접관이 마무리하려 합니다')
    expect(w.find('textarea').attributes('disabled')).toBeDefined()
  })
  it('종료 문장이 나오면 자동으로 finish', async () => {
    const s = useInterviewStore()
    const finish = vi.spyOn(s, 'finish').mockResolvedValue()
    mountWith({ messages: [{ role: 'model', text: '면접을 마치겠습니다.' }], ended: true })
    await Promise.resolve()
    expect(finish).toHaveBeenCalled()
  })
  it('생성 오류면 다시 물어보기 버튼', async () => {
    const { w, s } = mountWith({ genError: 'boom', messages: [{ role: 'user', text: '답' }] })
    const retry = vi.spyOn(s, 'retryLast').mockResolvedValue()
    expect(w.text()).toContain('응답이 끊겼습니다')
    await w.find('[data-test="retry"]').trigger('click')
    expect(retry).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- InterviewView` → FAIL

- [ ] **Step 3: 구현**

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { FIELD_LABELS, useInterviewStore } from '@/stores/interview'
import PixelWindow from '@/components/ui/PixelWindow.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import InterviewStage from '@/components/interview/InterviewStage.vue'
import ChatLog from '@/components/interview/ChatLog.vue'
import AnswerInput from '@/components/interview/AnswerInput.vue'

const s = useInterviewStore()

const fieldLabel = computed(() => (s.profile.field ? FIELD_LABELS[s.profile.field] : ''))
const lastModel = computed(() => [...s.messages].reverse().find((m) => m.role === 'model')?.text ?? '')
const bubble = computed(() => (s.generating ? s.streaming : lastModel.value))
const inputDisabled = computed(() => s.ended || s.overLimit || s.reportStatus !== 'idle')

/* 답변 지연 watch: waiting 20초 → 1회, 이후 30초마다 */
const watchTick = ref(0)
let idleTimer: ReturnType<typeof setTimeout> | null = null
function armIdle(ms: number) {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (s.stage === 'waiting') {
      watchTick.value++
      armIdle(30_000)
    }
  }, ms)
}
watch(
  () => s.stage,
  (st) => {
    if (st === 'waiting') armIdle(20_000)
    else if (idleTimer) clearTimeout(idleTimer)
  },
  { immediate: true },
)
onBeforeUnmount(() => idleTimer && clearTimeout(idleTimer))

/* 종료 */
const confirming = ref(false)
watch(
  () => s.ended,
  (e) => e && !s.generating && void s.finish(),
  { immediate: true },
)
</script>

<template>
  <main class="interview">
    <div class="stage-area">
      <InterviewStage
        :stage="s.stage"
        :bubble="bubble"
        :streaming="s.generating"
        :react-pending="s.reactPending"
        :watch-tick="watchTick"
        :field-label="fieldLabel"
        :job="s.profile.job"
        @react-done="s.consumeReact()"
        @end="confirming = true"
      />
      <div v-if="confirming" class="confirm" role="dialog">
        <PixelWindow padding="sm">
          <p class="mono">지금까지의 답변으로 리포트를 만들까요?</p>
          <div class="btns">
            <PixelButton variant="secondary" @click="confirming = false">계속 진행</PixelButton>
            <PixelButton data-test="end-confirm" @click="s.finish()">리포트 만들기</PixelButton>
          </div>
        </PixelWindow>
      </div>
    </div>

    <div class="panel">
      <PixelWindow padding="sm" class="log-win">
        <ChatLog :messages="s.messages" />
      </PixelWindow>
      <PixelWindow padding="sm" class="input-win">
        <p v-if="s.overLimit" class="mono note">면접관이 마무리하려 합니다. 면접 종료를 눌러 리포트를 받으세요.</p>
        <p v-if="s.genError" class="mono note danger">
          응답이 끊겼습니다.
          <PixelButton variant="secondary" data-test="retry" @click="s.retryLast()">다시 물어보기</PixelButton>
        </p>
        <AnswerInput
          :generating="s.generating"
          :disabled="inputDisabled"
          @send="s.send($event)"
          @abort="s.abort()"
          @typing="s.setListening($event)"
        />
      </PixelWindow>
    </div>
  </main>
</template>

<style scoped>
.interview {
  height: 100vh;
  display: grid;
  grid-template-rows: 2fr 1fr;
  gap: var(--sp-4);
  padding: var(--sp-4) var(--page-x);
  box-sizing: border-box;
  overflow: hidden;
}
.stage-area {
  position: relative;
  min-height: 0;
}
.confirm {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--bg) 70%, transparent);
  z-index: 5;
}
.btns {
  display: flex;
  gap: var(--sp-3);
  justify-content: flex-end;
}
.panel {
  display: grid;
  grid-template-columns: 7fr 5fr;
  gap: var(--sp-4);
  min-height: 0;
}
.log-win,
.input-win {
  min-height: 0;
}
.note {
  margin: 0 0 var(--sp-2);
  color: var(--text-2);
  font-size: var(--fs-meta);
}
.note.danger {
  color: var(--danger);
}
</style>
```

`color-mix`는 색 리터럴이 아니라 토큰 혼합이므로 허용(토큰 테스트가 막으면 `.confirm` 배경을 `var(--bg)`에 `opacity` 대신 자식 창만 불투명하게 두는 방식으로 바꾼다).

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- InterviewView` → PASS. `pnpm test` 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/views/InterviewView.vue src/views/InterviewView.test.ts
git commit -m "feat(frontend): 면접 화면 조립 — 무대·기록·입력, 답변 지연 watch, 종료 확인, 토큰 한도"
```

---

### Task 11: `ReportView.vue` — 카드 · 복사 · 다시 면접 보기

**Files:**
- Modify: `frontend/src/views/ReportView.vue`
- Test: `frontend/src/views/ReportView.test.ts`

**Interfaces:**
- Consumes: `useInterviewStore().report/reportRaw/reportStatus/messages/profile/reset()`, `splitEmphasis`, `reportToText` (Task 4), `PixelWindow`, `PixelButton`, `PixelTag`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/llm', () => ({ startSession: vi.fn() }))
vi.mock('@/services/api', () => ({ getQuestions: vi.fn(), getManifest: vi.fn() }))
import { useInterviewStore } from '@/stores/interview'
import ReportView from './ReportView.vue'

beforeEach(() => setActivePinia(createPinia()))

const items = [
  { question: 'Q1', answerSummary: 'A1', feedback: '좋았지만 **근거**가 필요합니다.' },
  { question: 'Q2', answerSummary: 'A2', feedback: 'F2' },
]

describe('ReportView', () => {
  it('생성 중 문구', () => {
    useInterviewStore().$patch({ phase: 'report', reportStatus: 'writing', profile: { field: 'it', job: '백엔드' } })
    expect(mount(ReportView).text()).toContain('리포트를 쓰는 중')
  })
  it('카드와 강조 span, 질문·꼬리질문 수', () => {
    useInterviewStore().$patch({
      phase: 'report', reportStatus: 'done', report: items, profile: { field: 'it', job: '백엔드' },
      messages: [
        { role: 'model', text: 'q1' }, { role: 'user', text: 'a' }, { role: 'model', text: 'q1-1' },
        { role: 'user', text: 'a' }, { role: 'model', text: 'q2' },
      ],
    })
    const w = mount(ReportView)
    expect(w.findAll('[data-test="card"]')).toHaveLength(2)
    expect(w.find('.strong').text()).toBe('근거')
    expect(w.text()).toContain('질문 2 · 꼬리질문 1')
  })
  it('파싱 실패면 원문 창 하나', () => {
    useInterviewStore().$patch({ phase: 'report', reportStatus: 'done', report: null, reportRaw: '원문', profile: { field: 'it', job: 'j' } })
    const w = mount(ReportView)
    expect(w.findAll('[data-test="card"]')).toHaveLength(0)
    expect(w.find('[data-test="raw"]').text()).toContain('원문')
  })
  it('복사 버튼은 텍스트를 클립보드에 쓰고 2초간 복사됨', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    useInterviewStore().$patch({ phase: 'report', reportStatus: 'done', report: items, profile: { field: 'it', job: '백엔드' } })
    const w = mount(ReportView)
    await w.find('[data-test="copy"]').trigger('click')
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Q1. Q1'))
    await Promise.resolve()
    expect(w.find('[data-test="copy"]').text()).toBe('복사됨')
  })
  it('다시 면접 보기는 reset', async () => {
    const s = useInterviewStore()
    s.$patch({ phase: 'report', reportStatus: 'done', report: items, profile: { field: 'it', job: 'j' } })
    const reset = vi.spyOn(s, 'reset').mockResolvedValue()
    await mount(ReportView).find('[data-test="restart"]').trigger('click')
    expect(reset).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- ReportView` → FAIL

- [ ] **Step 3: 구현**

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { FIELD_LABELS, useInterviewStore } from '@/stores/interview'
import { reportToText, splitEmphasis } from '@/utils/reportParser'
import PixelWindow from '@/components/ui/PixelWindow.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import PixelTag from '@/components/ui/PixelTag.vue'

const s = useInterviewStore()
const fieldLabel = computed(() => (s.profile.field ? FIELD_LABELS[s.profile.field] : ''))
const modelTurns = computed(() => s.messages.filter((m) => m.role === 'model').length)
const nQ = computed(() => s.report?.length ?? 0)
const nFollow = computed(() => Math.max(0, modelTurns.value - nQ.value))

const copied = ref(false)
async function copy() {
  const text = s.report
    ? reportToText(s.report, fieldLabel.value, s.profile.job)
    : `모두의 모의면접 리포트 · ${fieldLabel.value} · ${s.profile.job}\n\n${s.reportRaw}`
  await navigator.clipboard.writeText(text)
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}
</script>

<template>
  <main class="report stars">
    <header class="head">
      <h1 class="display">면접 리포트</h1>
      <div class="meta">
        <PixelTag tone="muted">{{ fieldLabel }} · {{ s.profile.job }}</PixelTag>
        <PixelTag v-if="s.reportStatus === 'done' && s.report" tone="muted">질문 {{ nQ }} · 꼬리질문 {{ nFollow }}</PixelTag>
      </div>
      <p class="mono note">이 리포트는 이 화면에만 있습니다. 새로고침하면 사라집니다.</p>
      <div class="btns">
        <PixelButton variant="secondary" data-test="copy" :disabled="s.reportStatus !== 'done'" @click="copy">{{ copied ? '복사됨' : '텍스트 복사' }}</PixelButton>
        <PixelButton data-test="restart" @click="s.reset()">다시 면접 보기</PixelButton>
      </div>
    </header>

    <PixelWindow v-if="s.reportStatus === 'writing'" title="총평">
      <p class="mono">리포트를 쓰는 중…<span class="blink">▌</span></p>
    </PixelWindow>

    <PixelWindow v-else-if="s.reportStatus === 'error'" title="총평">
      <p class="mono danger">리포트 생성에 실패했습니다. {{ s.genError }}</p>
      <PixelButton variant="secondary" @click="s.finish()">다시 시도</PixelButton>
    </PixelWindow>

    <template v-else-if="s.report">
      <PixelWindow v-for="(it, i) in s.report" :key="i" :title="`Q${i + 1}. ${it.question}`" data-test="card">
        <dl class="kv">
          <dt class="mono">답변 요약</dt>
          <dd>{{ it.answerSummary }}</dd>
          <dt class="mono">피드백</dt>
          <dd>
            <template v-for="(p, j) in splitEmphasis(it.feedback)" :key="j">
              <span :class="{ strong: p.strong }">{{ p.text }}</span>
            </template>
          </dd>
        </dl>
      </PixelWindow>
    </template>

    <PixelWindow v-else title="리포트 원문" data-test="raw">
      <pre class="mono raw">{{ s.reportRaw }}</pre>
    </PixelWindow>

    <div class="btns bottom">
      <PixelButton variant="secondary" :disabled="s.reportStatus !== 'done'" @click="copy">{{ copied ? '복사됨' : '텍스트 복사' }}</PixelButton>
      <PixelButton @click="s.reset()">다시 면접 보기</PixelButton>
    </div>
  </main>
</template>

<style scoped>
.report {
  max-width: var(--content-w);
  margin: 0 auto;
  padding: var(--sp-8) var(--page-x) var(--sp-14);
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
}
.head {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.meta,
.btns {
  display: flex;
  gap: var(--sp-3);
}
.btns.bottom {
  justify-content: center;
}
.note {
  color: var(--text-3);
  font-size: var(--fs-meta);
  margin: 0;
}
.kv {
  display: grid;
  grid-template-columns: 80px 1fr;
  gap: var(--sp-2) var(--sp-4);
  margin: 0;
}
.kv dt {
  color: var(--text-3);
}
.kv dd {
  margin: 0;
  line-height: 1.6;
}
.strong {
  color: var(--accent);
}
.danger {
  color: var(--danger);
}
.raw {
  white-space: pre-wrap;
  margin: 0;
}
</style>
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- ReportView` → PASS

- [ ] **Step 5: 커밋**

```bash
git add src/views/ReportView.vue src/views/ReportView.test.ts
git commit -m "feat(frontend): 리포트 화면 — 문항 카드·강조·복사·다시 면접 보기"
```

---

### Task 12: 전체 게이트 · 브라우저 리허설 · PR · 파이 배포

- [ ] **Step 1: 게이트**

`frontend/`에서:

Run: `pnpm test && pnpm lint && pnpm exec prettier --check . && pnpm exec vue-tsc --noEmit && pnpm build`
Expected: 전부 PASS·clean. `dist/`에 `litert-wasm/` 이 없어야 한다(`public/litert-wasm`은 `prebuild`가 만들고 Vite가 `dist/`로 복사한다 → **있어야 한다**. `ls dist/litert-wasm` 확인).

- [ ] **Step 2: 브라우저 리허설 (수동, PR 본문에 결과 첨부)**

로컬 백엔드(`uv run uvicorn app.main:app --port 8000`) + `pnpm dev`. Chrome에서:
1. 랜딩 → 동의 → 장비 확인 → 준비 화면. 진행 창이 `downloading`(캐시면 건너뜀) → `initializing`("출근 완료 — 자리에 앉는 중") → `ready`.
2. 분야·직무·이력서 입력 → "면접 시작" 활성 → 클릭.
3. 면접 화면: 첫 질문이 3초 안에 스트리밍 시작, 가운데 면접관 talk 애니. 질문 번호·잔여 수 없음 확인.
4. 텍스트로 답변 3회, 말하기 토글로 1회(결과가 덧붙고 자동 전송 안 됨). 긴 답변(150자+) 후 react 애니 1회. 20초 방치 → watch 1회.
5. 생성 중 "중단" → 말풍선이 받은 데까지로 확정.
6. 5문항 완주 → "면접을 마치겠습니다" → 자동으로 리포트 화면 → "리포트를 쓰는 중…" → 카드 N개(강조 span 포함). 텍스트 복사 → "복사됨".
7. "다시 면접 보기" → 준비 화면(모델 ready 유지, 다운로드 창 완료 상태).
8. 네트워크 탭: `/api/manifest`, `/api/questions/*`, `/models/*`, `/litert-wasm/*` 외 요청 없음. 특히 `cdn.jsdelivr.net` 없음.

문제가 있으면 여기서 고치고(추가 커밋) 다시 확인한다. 프롬프트를 고쳤다면 PR 본문에 전후 비교를 넣는다.

- [ ] **Step 3: PR**

```bash
git push -u origin feature/frontend-interview
gh pr create --base main --head feature/frontend-interview --title "feat(frontend): 면접 화면·LiteRT-LM 런타임·음성·리포트 (plan 2)" --body-file - <<'EOF'
## 무엇을
면접 시작부터 5문항 완주, 종료, 리포트 카드까지 브라우저 안에서 동작. LiteRT-LM JS(@litert-lm/core)로 런타임 연결(WASM 같은 오리진 서빙), 면접 스토어·무대·입력·음성·리포트 화면.

## 왜
docs/specs/frontend/2026-09-15-screens-design.md 4.3·4.4, docs/specs/frontend/2026-09-16-prompts-design.md, docs/plans/frontend/2026-09-16-interview.md

## 어떻게 검증했는지
- [x] Vitest N passed (thought 필터·토큰·종료·좋은 답변·파서·프롬프트·스토어·컴포넌트·화면)
- [x] 브라우저 리허설: (Task 12 Step 2 결과를 항목별로 기록 — init 시간, 첫 토큰, 완주, 리포트 파싱 성공 여부, 네트워크 요청 목록)
- [x] `pnpm lint`, `prettier --check`, `vue-tsc --noEmit`, `pnpm build` clean

## 체크리스트
- [x] feature 브랜치, Conventional Commits
- [x] frontend/ + 루트 .gitignore(litert-wasm) 만 수정. backend/·deploy/ 미수정
- [x] 계약 변경 없음
- [x] 계층 규율 경로(src/prompts/, src/services/llm.ts) 변경 — 리허설 결과 첨부(위)
- [x] 이력서·대화·리포트 서버 전송 없음 (네트워크 탭 확인)

## 리뷰어가 볼 것 (@leemonta9482)
- services/llm.ts 인터페이스가 화면 spec 6절과 다름(프롬프트 spec 5절로 대체). 화면은 스토어만 봐서 영향 없음
- frontend/CLAUDE.md의 "@mediapipe/tasks-genai" 표기는 후속 PR에서 갱신 요망

## BREAKING CHANGE?
- [x] 없음
EOF
```

- [ ] **Step 4: 머지 후 파이 배포**

```
ssh admin@webPi
cd /srv/apps/Woo-MoMo-Project && git pull && cd deploy && docker compose up -d --build
```

도메인에서 `https://momo.ssenu.cloud/litert-wasm/litertlm_wasm_internal.wasm`이 200(`application/wasm`)인지, 그리고 전체 흐름을 한 번 더 돌린다. nginx의 `/assets/`만 immutable이고 `/litert-wasm/`은 `no-cache` 경로(`location /`)에 걸리므로 22~34MB WASM이 매번 재검증(ETag 304)된다 — 동작에는 문제없고, 장기 캐시가 필요하면 후속 `deploy/` PR에서 `location /litert-wasm/`을 추가한다.

## 이후

- plan 3(잔여): `docs/demo-checklist.md`, 데모 노트북 E4B 실측, `frontend/CLAUDE.md` 런타임 표기 갱신, `package.json` `packageManager` 고정, `/litert-wasm/` 캐시 헤더(deploy/).
- 리허설에서 프롬프트 튜닝(꼬리질문 과다·종료 문장 누락 시 규칙 문구 조정).

## Self-Review (계획 검토)

- 스펙 커버리지 — 4.3 무대·말풍선·분야/직무·종료 버튼·번호 미표시 → Task 8·10. 상태 기계(asking/waiting/listening/thinking, watch 20/30초, react 1회) → Task 6·8·10. thought 제거 → Task 2·6. 하단 패널(기록·textarea·Enter/Shift+Enter·말하기 토글·덧붙이기·자동 전송 없음·생성 중 비활성·중단·오류 재시도) → Task 7·9·10. 종료 조건(종료 문장·종료 버튼 확인·토큰 6,500) → Task 2·6·10. 4.4 리포트(지시문·파싱·강조·태그 N/M·복사 형식·2초 복사됨·다시 면접 보기·새로고침 안내) → Task 3·4·6·11. 5 에러(음성 권한·생성 오류·파싱 실패) → Task 9·10·11. 6 인터페이스(model.init, interview 확장, speech, llm) → Task 1·5·6·7. 프롬프트 spec 3·4·5절 → Task 1·3. 10 성공 기준의 Vitest 목록 → Task 2·3·4·6·9·10·11. ✅
- Placeholder 없음: 모든 Step에 실제 코드·명령. Task 1만 단위 테스트 없음(GPU, 스파이크 절차 명시). ✅
- 타입·이름 일치: `LlmSession.send(text,onToken,signal)/tokenCount()/dispose()`, `initEngine(blob,{maxNumTokens})`, `startSession(prompt)`; 스토어 `messages/stage/streaming/generating/genError/reactPending/ended/tokenCount/overLimit/report/reportRaw/reportStatus`, `start/send/abort/retryLast/setListening/consumeReact/finish/reset`; 컴포넌트 props `stage/bubble/streaming/reactPending/watchTick/fieldLabel/job`, emits `react-done/end`, `AnswerInput` emits `send/abort/typing`; `parseReport/splitEmphasis/reportToText`; `animsFor(stage,{react,watch})`. Task 6의 `generate` 시그니처는 단순화 지시대로 `generate(userText)`. ✅
- 함정 선제 회피: WASM CDN 기본값 → 자체 서빙 + 네트워크 탭 확인(Task 1·12), 스트리밍 청크 델타/누적 불확실 → 스파이크에서 판별(Task 1), 태그가 청크 경계에 걸침 → ThoughtFilter 꼬리 보류(Task 2), Pinia state에 세션 객체 금지 → 모듈 스코프(Task 6), `SpriteFrame`이 루프만 지원 → 1회 재생을 타이머로(Task 8), `confirm()` 다이얼로그 금지 → 인라인 확인(Task 10), IME 조합 중 Enter → `isComposing` 체크(Task 9). ✅
