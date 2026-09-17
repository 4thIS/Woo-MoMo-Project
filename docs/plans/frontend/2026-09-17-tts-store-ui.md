# frontend plan 5 — 면접관 음성 TTS #2: 스토어·화면 연동 (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- 생성일시: 2026-09-17
- 담당: @leemonta9482. 브랜치: `feature/frontend-tts-store-ui` (main `a8dd39c`에서 생성). 이슈 #13
- 선행: PR #16 머지됨(`services/tts.ts`·`services/audio.ts`·워커). 계약 `manifest.tts`는 PR #14

**Goal:** 준비 화면에서 TTS 모델까지 내려받아 초기화하고, 면접관이 질문을 만들면 합성한 음성과 함께 말풍선 글자가 음성 길이에 맞춰 드러나게 한다. 재생 중엔 마이크·전송이 잠기고, 음소거 토글이 즉시 반영되며, 실패하면 텍스트만 즉시 보이고 면접은 계속된다.

**Architecture:** `stores/model.ts`가 Gemma `ready` 뒤 `initTts()`(+워밍업 한 문장)를 돌려 `ttsStatus`를 관리한다. `stores/interview.ts`의 `generate()`는 스트리밍 텍스트를 말풍선에 내지 않고 확정 텍스트를 `speak()`에 넘긴다 — `synthesize`(15초 상한) → `playClip` → `revealed`를 `durationMs`에 균등 배분해 50ms마다 채운다. 화면은 `revealed`·`speaking`·`muted`·`ttsWarning`만 읽는다. stage는 `thinking → speaking → waiting`이고 `asking`은 삭제한다.

**Tech Stack:** Vue 3 + Pinia + Vitest(기존). 신규 의존성 없음.

**Spec:** `docs/specs/frontend/2026-09-17-tts-design.md` 4절(이 plan), 5절(에러), 6절(성공 기준), 8절(열린 결정: revealed 균등 배분)

## Global Constraints

- 자기 영역(`frontend/`)과 `docs/demo-checklist.md`만. `backend/`·`deploy/` 수정 없음. 계약 변경 없음.
- 계층: `utils/`는 브라우저 API·스토어 import 금지. `services/`는 스토어 import 금지. `stores/`는 `services/`를 import해도 된다.
- 색 리터럴은 `styles/tokens.css`에만. 새 색 없이 `--accent`(소리 켜짐)·`--text-3`(음소거)·`--danger`만 쓴다.
- 누를 수 있는 것은 전부 `.press`. 면접 화면에 질문 번호·잔여 질문·꼬리질문 수를 표시하지 않는다.
- 이력서·대화·리포트를 서버로 보내는 코드 금지. 네트워크 요청은 매니페스트·질문·모델·`/litert-wasm/`·`/ort-wasm/`뿐.
- 소비하는 인터페이스(PR #16, 변경 금지):
  ```ts
  // services/tts.ts
  initTts(cfg: TtsManifest, onProgress?: (received: number, total: number) => void): Promise<void>
  synthesize(text: string, signal?: AbortSignal): Promise<AudioClip>   // AudioClip { samples; sampleRate; durationMs }
  disposeTts(): void
  // services/audio.ts
  playClip(clip: AudioClip, opts: { muted: boolean }): { done: Promise<void>; stop(): void }
  warmUpAudio(): void
  ```
- 상수: `SYNTH_TIMEOUT_MS = 15_000`, `PLAY_GRACE_MS = 1_000`, `REVEAL_TICK_MS = 50`, `TTS_WARNING = '음성을 만들지 못했습니다'`, `TTS_WARMUP_TEXT = '안녕하세요.'`, localStorage 키 `'momo.muted'`(값 `'1'`/`'0'`).
- 모든 명령은 `frontend/`에서 `pnpm`으로. 게이트: `pnpm test && pnpm lint && pnpm exec prettier --check . && pnpm exec vue-tsc --noEmit && pnpm build`. prettier는 `frontend/` 안에서만 돌린다(`docs/`에 돌리면 기본 설정으로 재정렬됨).
- 커밋 `feat(frontend):` / `test(frontend):` / `docs:`. AI 저작 표기 금지. 새 코드는 실패 테스트 → 구현 → 통과.
- Vitest 가짜 시계: `vi.useFakeTimers()`는 `Date`도 가짜로 만든다. `vi.setSystemTime`과 `advanceTimersByTime`을 섞지 않는다.

## 파일 구조

| 파일 | 역할 | 작업 |
|---|---|---|
| `src/services/audio.ts` | `setMuted(on)` 추가 — 재생 중 클립의 GainNode에 즉시 반영 | 수정 (Task 1) |
| `src/stores/model.ts` | `ttsStatus/ttsReceived/ttsTotal/ttsError`, `ttsEnabled/ttsProgress/ready` getter, `loadTts()/retryTts()` | 수정 (Task 2) |
| `src/stores/interview.ts` | `Stage`에서 `asking` 제거·`speaking` 추가, `speaking/revealed/muted/ttsWarning`, `speak()/stopSpeaking()/toggleMuted()`, 가드 | 수정 (Task 3) |
| `src/components/interview/interviewerAnims.ts` | `baseAnims('speaking')` → 가운데 질문 제스처 | 수정 (Task 3) |
| `src/components/ui/icons/SpeakerIcon.vue` | 픽셀 스피커 아이콘(`muted`면 X) | 생성 (Task 4) |
| `src/components/interview/InterviewStage.vue` | 우상단 음소거 토글, 말풍선 아래 경고 한 줄 | 수정 (Task 4) |
| `src/views/InterviewView.vue` | `bubble = revealed`, `speaking`이면 입력 잠금·타이머 없음·마무리 창 보류, 토글 연결 | 수정 (Task 5) |
| `src/components/ui/PixelProgress.vue` | `phase: 'voice'`(목소리 준비 중, look_up 유지) | 수정 (Task 6) |
| `src/views/PrepareView.vue` | 진행 창 2단계, 체크리스트 "목소리 준비", TTS만 다시 시도, 시작 클릭에 `warmUpAudio()` | 수정 (Task 6) |
| `docs/demo-checklist.md` | "음성(TTS) — 면접 연동" 절 | 수정 (Task 6) |

---

### Task 1: `services/audio.ts` — `setMuted(on)`

**Files:**
- Modify: `frontend/src/services/audio.ts`
- Test: `frontend/src/services/audio.test.ts`

**Interfaces:**
- Consumes: 기존 `playClip`.
- Produces: `export function setMuted(on: boolean): void` — 재생 중인 클립이 있으면 그 GainNode를 즉시 0/1로 바꾸고, 다음 `playClip`이 `opts.muted`를 생략하면 이 값을 쓴다. `playClip(clip, opts?: { muted?: boolean })`로 완화(기존 호출 호환).

- [ ] **Step 1: 실패 테스트 추가** — `audio.test.ts`의 `describe('audio')` 안 끝에:

```ts
  it('setMuted는 재생 중인 클립의 게인을 즉시 바꾸고, 다음 재생의 기본값이 된다', () => {
    playClip(clip, { muted: false })
    setMuted(true)
    expect(ctx.gains[0].gain.value).toBe(0)
    setMuted(false)
    expect(ctx.gains[0].gain.value).toBe(1)
    setMuted(true)
    playClip(clip) // opts 생략 → setMuted 값
    expect(ctx.gains[1].gain.value).toBe(0)
    setMuted(false)
  })
```
import 줄을 `import { __setAudioContextFactory, playClip, setMuted, warmUpAudio } from './audio'`로.

- [ ] **Step 2: 실패 확인** — `pnpm vitest run src/services/audio.test.ts` → `setMuted is not a function`

- [ ] **Step 3: 구현** — `audio.ts`:

```ts
let current: GainNode | null = null // 재생 중인 클립의 게인 — setMuted가 즉시 반영할 대상
let mutedFlag = false

/** 재생 중인 소리에 즉시 반영. 이후 playClip이 muted를 생략하면 이 값을 쓴다 */
export function setMuted(on: boolean): void {
  mutedFlag = on
  if (current) current.gain.value = on ? 0 : 1
}
```
`playClip` 시그니처를 `playClip(clip: AudioClip, opts?: { muted?: boolean })`로, 본문에서
```ts
  const gain = c.createGain()
  gain.gain.value = (opts?.muted ?? mutedFlag) ? 0 : 1
  current = gain
```
그리고 `src.onended`와 `stop()` 양쪽에서 끝날 때 `if (current === gain) current = null`. `finish` 호출 앞에 넣는다.

- [ ] **Step 4: 통과 확인** — `pnpm vitest run src/services/audio.test.ts` → 전부 PASS

- [ ] **Step 5: 커밋**
```bash
git add src/services/audio.ts src/services/audio.test.ts
git commit -m "feat(frontend): audio.setMuted — 재생 중 게인 즉시 반영, 다음 재생 기본값"
```

---

### Task 2: `stores/model.ts` — TTS 준비 상태

**Files:**
- Modify: `frontend/src/stores/model.ts`
- Test: `frontend/src/stores/model.test.ts`

**Interfaces:**
- Consumes: `initTts/synthesize/disposeTts`(`@/services/tts`), `Manifest.tts?: TtsManifest | null`.
- Produces(Task 3·6이 읽음):
  ```ts
  export type TtsStatus = 'idle' | 'downloading' | 'initializing' | 'ready' | 'error'
  export const TTS_WARMUP_TEXT = '안녕하세요.'
  state: ttsStatus: TtsStatus; ttsReceived: number; ttsTotal: number; ttsError: string | null
  getters: ttsEnabled: boolean /* !!manifest.tts */; ttsProgress: number /* 0~100 */; ready: boolean /* status==='ready' && (!ttsEnabled || ttsStatus==='ready') */
  actions: loadTts(): Promise<void>; retryTts(): Promise<void>
  ```
  `init()`은 Gemma `ready` 직후 `await this.loadTts()`를 부른다. `clearCache()`는 `disposeTts()` + `ttsStatus='idle'`.

- [ ] **Step 1: 실패 테스트** — `model.test.ts` 상단 mock 블록에 추가:

```ts
vi.mock('@/services/tts', () => ({ initTts: vi.fn(), synthesize: vi.fn(), disposeTts: vi.fn() }))
import { disposeTts, initTts, synthesize } from '@/services/tts'
import { TTS_WARMUP_TEXT, useModelStore } from './model'
```
(기존 `import { useModelStore } from './model'` 줄은 위 줄로 대체.) `beforeEach`에 `vi.mocked(initTts).mockResolvedValue(undefined); vi.mocked(synthesize).mockResolvedValue({ samples: new Float32Array(1), sampleRate: 44100, durationMs: 0 })` 추가. 파일 끝에:

```ts
const tts = {
  id: 'supertonic-3',
  baseUrl: '/models/tts/supertonic-3/',
  files: [
    { path: 'a.onnx', size: 60 },
    { path: 'b.onnx', size: 40 },
  ],
  voice: 'M2',
  lang: 'ko',
}

describe('model store — TTS', () => {
  it('manifest.tts가 없으면 initTts 없이 ttsStatus도 ready (텍스트 전용)', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(s.status).toBe('ready')
    expect(s.ttsEnabled).toBe(false)
    expect(s.ttsStatus).toBe('ready')
    expect(s.ready).toBe(true)
    expect(initTts).not.toHaveBeenCalled()
  })

  it('manifest.tts가 있으면 Gemma ready 뒤 다운로드 → 초기화 → 워밍업 → ready', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    vi.mocked(initTts).mockImplementation(async (_cfg, onProgress) => {
      onProgress?.(60, 100)
      onProgress?.(100, 100)
    })
    const s = useModelStore()
    await s.loadManifest()
    const seen: string[] = []
    s.$subscribe((_m, st) => seen.push(st.ttsStatus), { detached: true })
    await s.download()
    expect(s.status).toBe('ready')
    expect(seen).toContain('downloading')
    expect(seen).toContain('initializing')
    expect(initTts).toHaveBeenCalledWith(tts, expect.any(Function))
    expect(synthesize).toHaveBeenCalledWith(TTS_WARMUP_TEXT)
    expect(s.ttsReceived).toBe(100)
    expect(s.ttsTotal).toBe(100)
    expect(s.ttsProgress).toBe(100)
    expect(s.ttsStatus).toBe('ready')
    expect(s.ready).toBe(true)
  })

  it('TTS 준비 전에는 ready가 false다 (Gemma는 ready여도)', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    let release!: () => void
    vi.mocked(initTts).mockReturnValue(new Promise<void>((r) => (release = r)))
    const s = useModelStore()
    await s.loadManifest()
    const p = s.download()
    await vi.waitFor(() => expect(s.status).toBe('ready'))
    expect(s.ready).toBe(false)
    release()
    await p
    expect(s.ready).toBe(true)
  })

  it('initTts 실패 → ttsStatus error + 원인. retryTts로 TTS만 다시', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    vi.mocked(initTts).mockRejectedValueOnce(new Error('size mismatch'))
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(s.status).toBe('ready')
    expect(s.ttsStatus).toBe('error')
    expect(s.ttsError).toBe('size mismatch')
    expect(s.ready).toBe(false)
    await s.retryTts()
    expect(initTts).toHaveBeenCalledTimes(2)
    expect(initEngine).toHaveBeenCalledTimes(1) // Gemma는 다시 올리지 않는다
    expect(s.ttsStatus).toBe('ready')
  })

  it('워밍업 합성 실패는 무시한다', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    vi.mocked(synthesize).mockRejectedValueOnce(new Error('warm'))
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(s.ttsStatus).toBe('ready')
  })

  it('이미 ready인 TTS는 Gemma를 다시 올려도(경량 모델 전환) 다시 초기화하지 않는다', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    await s.useFallback()
    expect(initTts).toHaveBeenCalledTimes(1)
    expect(s.ready).toBe(true)
  })

  it('clearCache는 disposeTts하고 ttsStatus를 idle로', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts })
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    await s.clearCache()
    expect(disposeTts).toHaveBeenCalled()
    expect(s.ttsStatus).toBe('idle')
    expect(s.ttsReceived).toBe(0)
  })
})
```

- [ ] **Step 2: 실패 확인** — `pnpm vitest run src/stores/model.test.ts` → `TTS_WARMUP_TEXT` 없음 / `ttsStatus` undefined로 FAIL

- [ ] **Step 3: 구현** — `model.ts`:

```ts
import { disposeTts, initTts, synthesize } from '@/services/tts'

export type TtsStatus = 'idle' | 'downloading' | 'initializing' | 'ready' | 'error'
/** 준비 단계에서 한 번 미리 합성해 두는 문장 — 첫 질문의 합성이 워밍업 비용을 물지 않게 (spec 6절) */
export const TTS_WARMUP_TEXT = '안녕하세요.'
```
state 추가:
```ts
    ttsStatus: 'idle' as TtsStatus,
    ttsReceived: 0,
    ttsTotal: 0,
    ttsError: null as string | null,
```
getters 추가:
```ts
    ttsEnabled: (s) => !!s.manifest?.tts,
    ttsProgress: (s) =>
      s.ttsTotal ? Math.min(100, Math.round((s.ttsReceived / s.ttsTotal) * 100)) : 0,
    /** 면접을 시작할 수 있는 상태: Gemma ready + (TTS가 있으면) TTS ready */
    ready: (s) => s.status === 'ready' && (!s.manifest?.tts || s.ttsStatus === 'ready'),
```
`init()`의 `this.status = 'ready'` 바로 다음 줄에 `await this.loadTts()`. actions 추가:
```ts
    /** Gemma ready 뒤 TTS 파일을 받아 워커를 올리고 워밍업 한 문장을 돌린다. manifest.tts가 없으면 텍스트 전용으로 바로 ready */
    async loadTts() {
      const cfg = this.manifest?.tts
      if (!cfg) {
        this.ttsStatus = 'ready'
        return
      }
      if (this.ttsStatus === 'ready') return // 경량 모델 전환 등으로 Gemma만 다시 올릴 때 TTS는 그대로 둔다
      this.ttsStatus = 'initializing' // 캐시 조회 중에도 진행 창이 look_up을 유지하도록
      this.ttsError = null
      this.ttsReceived = 0
      this.ttsTotal = cfg.files.reduce((n, f) => n + f.size, 0)
      try {
        await initTts(cfg, (r, t) => {
          this.ttsReceived = r
          this.ttsTotal = t
          this.ttsStatus = r < t ? 'downloading' : 'initializing'
        })
        await synthesize(TTS_WARMUP_TEXT).catch(() => undefined) // 워밍업 실패는 무시 — 실제 턴에서 다시 시도된다
        this.ttsStatus = 'ready'
      } catch (e) {
        this.ttsStatus = 'error'
        this.ttsError = e instanceof Error ? e.message : String(e)
      }
    },
    retryTts() {
      return this.loadTts()
    },
```
`clearCache()`에 `disposeTts()`(await 불필요)와 `this.ttsStatus = 'idle'; this.ttsReceived = 0; this.ttsError = null` 추가.

- [ ] **Step 4: 통과 확인** — `pnpm vitest run src/stores/model.test.ts` → PASS. `pnpm vitest run src/stores src/views` 로 기존 테스트도 깨지지 않는지(기존 테스트는 `manifest.tts`가 없어 텍스트 전용 경로).

- [ ] **Step 5: 커밋**
```bash
git add src/stores/model.ts src/stores/model.test.ts
git commit -m "feat(frontend): model 스토어 TTS 준비 상태 — Gemma ready 뒤 initTts·워밍업, retryTts, ready getter"
```

---

### Task 3: `stores/interview.ts` — speaking·revealed·muted·speak()

**Files:**
- Modify: `frontend/src/stores/interview.ts`
- Modify: `frontend/src/components/interview/interviewerAnims.ts:43-45`
- Test: `frontend/src/stores/interview.test.ts`, `frontend/src/components/interview/interviewerAnims.test.ts:15`, `frontend/src/components/interview/InterviewStage.test.ts:91`

**Interfaces:**
- Consumes: Task 1 `setMuted`, `playClip`; Task 2 `model.ready/ttsEnabled/ttsStatus`; `synthesize`.
- Produces(Task 4·5가 읽음):
  ```ts
  export type Stage = 'idle' | 'thinking' | 'speaking' | 'waiting' | 'listening'   // asking 삭제
  export const SYNTH_TIMEOUT_MS = 15_000, PLAY_GRACE_MS = 1_000, TTS_WARNING = '음성을 만들지 못했습니다'
  state: speaking: boolean; revealed: string; muted: boolean; ttsWarning: string | null
  actions: toggleMuted(): void; speak(text: string): Promise<void>(내부); stopSpeaking(): void(내부)
  ```
  `send/setListening/start`는 `speaking` 중 무시. `abort/finish/reset`은 재생 중이면 정지 + `revealed = 전체`. 재생이 끝나면 마지막 model 메시지의 `at`을 그 시각으로 다시 찍는다(답변 타이머 기준).

- [ ] **Step 1: 실패 테스트** — `interview.test.ts` 상단 mock에 추가:

```ts
vi.mock('@/services/tts', () => ({ synthesize: vi.fn(), initTts: vi.fn(), disposeTts: vi.fn() }))
vi.mock('@/services/audio', () => ({ playClip: vi.fn(), setMuted: vi.fn(), warmUpAudio: vi.fn() }))
import { synthesize } from '@/services/tts'
import { playClip, setMuted } from '@/services/audio'
import { PLAY_GRACE_MS, SYNTH_TIMEOUT_MS, TTS_WARNING, useInterviewStore } from './interview'
```
(기존 `import { useInterviewStore } from './interview'`는 위 줄로 대체.) `beforeEach`에 `localStorage.clear()` 추가. 파일 끝에:

```ts
const TTS = {
  id: 'tts',
  baseUrl: '/models/tts/',
  files: [{ path: 'a', size: 1 }],
  voice: 'M2',
  lang: 'ko',
}
async function voiceStore() {
  const s = await readyStore()
  const m = useModelStore()
  m.manifest = { ...m.manifest!, tts: TTS }
  m.ttsStatus = 'ready'
  return s
}
const clip = (durationMs: number) => ({ samples: new Float32Array(4), sampleRate: 44100, durationMs })
function fakePlay() {
  let end!: () => void
  const done = new Promise<void>((r) => (end = r))
  return { done, stop: vi.fn(() => end()), end }
}

describe('interview flow — 음성', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('TTS가 없으면 합성 없이 텍스트를 즉시 보인다', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['첫 질문']))
    const s = await readyStore()
    await s.start()
    expect(synthesize).not.toHaveBeenCalled()
    expect(s.revealed).toBe('첫 질문 ')
    expect(s.stage).toBe('waiting')
  })

  it('생성 중엔 revealed가 비고(…), 합성 뒤 재생과 함께 글자가 균등하게 차오르며 끝나면 waiting', async () => {
    vi.mocked(synthesize).mockResolvedValue(clip(1000))
    const play = fakePlay()
    vi.mocked(playClip).mockReturnValue(play)
    vi.mocked(startSession).mockResolvedValue(fakeSession(['가나다라']))
    const s = await voiceStore()
    const p = s.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.stage).toBe('speaking')
    expect(s.speaking).toBe(true)
    expect(s.revealed).toBe('')
    expect(playClip).toHaveBeenCalledWith(expect.objectContaining({ durationMs: 1000 }), { muted: false })
    await vi.advanceTimersByTimeAsync(500)
    expect(s.revealed).toBe('가나') // '가나다라 ' 5자 중 절반
    play.end()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.revealed).toBe('가나다라 ')
    expect(s.speaking).toBe(false)
    expect(s.stage).toBe('waiting')
    expect(s.messages[0].at).toBe(Date.now()) // 답변 타이머 기준 = 재생이 끝난 시각
    await p
  })

  it('onended가 오지 않아도(suspended) durationMs + 여유 뒤에 끝난다', async () => {
    vi.mocked(synthesize).mockResolvedValue(clip(1000))
    vi.mocked(playClip).mockReturnValue(fakePlay())
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await voiceStore()
    const p = s.start()
    await vi.advanceTimersByTimeAsync(1000 + PLAY_GRACE_MS)
    expect(s.speaking).toBe(false)
    expect(s.stage).toBe('waiting')
    await p
  })

  it('합성 실패는 텍스트 즉시 + 경고 한 줄, 다음 턴에 경고를 지운다', async () => {
    vi.mocked(synthesize).mockRejectedValueOnce(new Error('boom')).mockResolvedValue(clip(0))
    vi.mocked(playClip).mockImplementation(() => ({ done: Promise.resolve(), stop: vi.fn() }))
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q1', 'q2']))
    const s = await voiceStore()
    await s.start()
    expect(s.revealed).toBe('q1 ')
    expect(s.ttsWarning).toBe(TTS_WARNING)
    expect(s.stage).toBe('waiting')
    expect(playClip).not.toHaveBeenCalled()
    const p = s.send('답')
    await vi.advanceTimersByTimeAsync(0)
    expect(s.ttsWarning).toBeNull()
    await vi.advanceTimersByTimeAsync(PLAY_GRACE_MS)
    await p
  })

  it('15초 안에 합성이 끝나지 않으면 abort 신호를 보내고 텍스트만 보인다', async () => {
    vi.mocked(synthesize).mockImplementation(
      (_t, signal) =>
        new Promise((_res, rej) =>
          signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))),
        ),
    )
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await voiceStore()
    const p = s.start()
    await vi.advanceTimersByTimeAsync(SYNTH_TIMEOUT_MS - 1)
    expect(s.stage).toBe('thinking')
    await vi.advanceTimersByTimeAsync(1)
    expect(s.revealed).toBe('q ')
    expect(s.ttsWarning).toBe(TTS_WARNING)
    expect(s.stage).toBe('waiting')
    await p
  })

  it('재생 중 abort()는 소리를 멈추고 텍스트를 전부 보인다 (경고 없음)', async () => {
    vi.mocked(synthesize).mockResolvedValue(clip(5000))
    const play = fakePlay()
    vi.mocked(playClip).mockReturnValue(play)
    vi.mocked(startSession).mockResolvedValue(fakeSession(['긴 질문']))
    const s = await voiceStore()
    const p = s.start()
    await vi.advanceTimersByTimeAsync(100)
    expect(s.speaking).toBe(true)
    await s.abort()
    expect(play.stop).toHaveBeenCalled()
    expect(s.speaking).toBe(false)
    expect(s.revealed).toBe('긴 질문 ')
    expect(s.ttsWarning).toBeNull()
    expect(s.stage).toBe('waiting')
    await p
  })

  it('재생 중엔 send·setListening이 막힌다', async () => {
    vi.mocked(synthesize).mockResolvedValue(clip(5000))
    const play = fakePlay()
    vi.mocked(playClip).mockReturnValue(play)
    const sess = fakeSession(['q', 'q2'])
    vi.mocked(startSession).mockResolvedValue(sess)
    const s = await voiceStore()
    const p = s.start()
    await vi.advanceTimersByTimeAsync(100)
    await s.send('끼어들기')
    expect(sess.sent).toHaveLength(1)
    s.setListening(true)
    expect(s.stage).toBe('speaking')
    play.end()
    await vi.advanceTimersByTimeAsync(0)
    await p
  })

  it('finish()는 재생을 멈추고 리포트를 요청한다 (리포트는 합성하지 않는다)', async () => {
    vi.mocked(synthesize).mockResolvedValue(clip(5000))
    const play = fakePlay()
    vi.mocked(playClip).mockReturnValue(play)
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q', '[]']))
    const s = await voiceStore()
    const p = s.start()
    await vi.advanceTimersByTimeAsync(100)
    await s.finish()
    expect(play.stop).toHaveBeenCalled()
    expect(s.reportStatus).toBe('done')
    expect(synthesize).toHaveBeenCalledTimes(1)
    await p
  })

  it('toggleMuted는 setMuted를 부르고 momo.muted에 기억한다. 새 스토어는 저장값을 읽는다', async () => {
    const s = await voiceStore()
    expect(s.muted).toBe(false)
    s.toggleMuted()
    expect(s.muted).toBe(true)
    expect(setMuted).toHaveBeenCalledWith(true)
    expect(localStorage.getItem('momo.muted')).toBe('1')
    setActivePinia(createPinia())
    expect(useInterviewStore().muted).toBe(true)
  })

  it('muted면 playClip에 muted:true로 넘긴다', async () => {
    localStorage.setItem('momo.muted', '1')
    vi.mocked(synthesize).mockResolvedValue(clip(0))
    vi.mocked(playClip).mockImplementation(() => ({ done: Promise.resolve(), stop: vi.fn() }))
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await voiceStore()
    const p = s.start()
    await vi.advanceTimersByTimeAsync(PLAY_GRACE_MS)
    expect(playClip).toHaveBeenCalledWith(expect.anything(), { muted: true })
    await p
  })

  it('reset은 재생을 멈추고 revealed·ttsWarning을 비운다', async () => {
    vi.mocked(synthesize).mockResolvedValue(clip(5000))
    const play = fakePlay()
    vi.mocked(playClip).mockReturnValue(play)
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await voiceStore()
    const p = s.start()
    await vi.advanceTimersByTimeAsync(100)
    await s.reset()
    expect(play.stop).toHaveBeenCalled()
    expect(s.speaking).toBe(false)
    expect(s.revealed).toBe('')
    expect(s.stage).toBe('idle')
    await p
  })
})

describe('canStart — TTS', () => {
  it('manifest.tts가 있고 ttsStatus가 ready가 아니면 잠기고 이유를 말한다', async () => {
    const s = await readyStore()
    const m = useModelStore()
    m.manifest = { ...m.manifest!, tts: TTS }
    m.ttsStatus = 'downloading'
    expect(s.canStart).toBe(false)
    expect(s.startBlockReason).toBe('면접관 목소리를 준비하면 열립니다')
    m.ttsStatus = 'ready'
    expect(s.canStart).toBe(true)
  })
})
```
`afterEach`를 vitest import에 추가한다. `interviewerAnims.test.ts:15`의 `'asking'`을 `'speaking'`으로, `InterviewStage.test.ts:91`의 `stage: 'asking'`을 `stage: 'speaking'`으로 바꾼다.

- [ ] **Step 2: 실패 확인** — `pnpm vitest run src/stores/interview.test.ts src/components/interview` → 새 테스트 FAIL(타입 오류 포함)

- [ ] **Step 3: 구현** — `interviewerAnims.ts`:
```ts
/** 상태별 기본 애니. 말하는 중엔 가운데가 질문 제스처를 말이 끝날 때까지 반복한다 */
export function baseAnims(stage: Stage): Trio {
  return stage === 'speaking' ? { ...IDLE, center: 'center_question' } : IDLE
}
```
`interview.ts`:
```ts
import { synthesize } from '@/services/tts'
import { playClip, setMuted } from '@/services/audio'

export type Stage = 'idle' | 'thinking' | 'speaking' | 'waiting' | 'listening'
export const SYNTH_TIMEOUT_MS = 15_000
/** AudioContext가 suspended라 onended가 오지 않을 때, durationMs 뒤 이만큼만 더 기다리고 끝낸다 */
export const PLAY_GRACE_MS = 1_000
const REVEAL_TICK_MS = 50
export const TTS_WARNING = '음성을 만들지 못했습니다'
const MUTED_KEY = 'momo.muted'
function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1'
  } catch {
    return false
  }
}
```
모듈 스코프 변수 추가:
```ts
let speakCtl: AbortController | null = null // 진행 중 합성의 취소(사용자 중단·15초 상한)
let playing: { stop(): void } | null = null
let revealTimer: ReturnType<typeof setInterval> | null = null
let speakText = '' // 재생 중인 발화 전문 — 중단 시 이걸로 revealed를 채운다
```
state 추가: `speaking: false, revealed: '', muted: loadMuted(), ttsWarning: null as string | null`.

getters:
```ts
    canStart(): boolean {
      return useModelStore().ready && this.profileDone && this.resumeDone
    },
    startBlockReason(): string | null {
      if (this.canStart) return null
      const m = useModelStore()
      if (m.status !== 'ready') return '면접관이 자리에 앉으면 열립니다'
      if (!m.ready) return '면접관 목소리를 준비하면 열립니다'
      return '위 항목을 채우면 열립니다'
    },
```
`start()` 가드에 `|| this.speaking`, `send()` 가드에 `|| this.speaking`, `setListening()` 첫 줄을 `if (this.generating || this.speaking) return`.

`generate()`의 `run`을 아래로 교체:
```ts
      const run = async () => {
        if (!session) return
        this.generating = true
        this.genError = null
        this.ttsWarning = null
        this.streaming = ''
        this.revealed = '' // 생성 중 말풍선은 "…" — 확정 텍스트를 음성과 함께 드러낸다
        this.stage = 'thinking'
        abortCtl = new AbortController()
        const filter = new ThoughtFilter()
        let text = ''
        try {
          await session.send(
            userText,
            (delta) => {
              const shown = filter.push(delta)
              if (shown) this.streaming += shown
            },
            abortCtl.signal,
          )
          this.streaming += filter.flush()
          // 태그 쌍이 통째로 버퍼링되어 필터를 통과했을 수 있는 잔여 thought를 최종 텍스트에서 제거
          this.streaming = stripThoughts(this.streaming)
          // 공백만 남은 턴(thought만 오고 끝난 경우 등)은 기록하지 않는다 — 빈 말풍선 방지
          text = this.streaming.trim()
          if (text) this.messages.push({ role: 'model', text: this.streaming, at: Date.now() })
          if (hasEndPhrase(text)) {
            this.ended = true
            if (this.endedAt === null) this.endedAt = Date.now()
          }
        } catch (e) {
          this.genError = e instanceof Error ? e.message : String(e)
        } finally {
          this.generating = false
          abortCtl = null
        }
        if (text) await this.speak(this.streaming)
        else this.revealed = [...this.messages].reverse().find((m) => m.role === 'model')?.text ?? ''
        this.stage = 'waiting'
        await this.refreshTokens()
      }
```
actions 추가:
```ts
    /** 내부: 발화를 합성·재생하며 revealed를 음성 길이에 균등 배분해 채운다. 실패·타임아웃이면 텍스트만 즉시 */
    async speak(text: string) {
      const model = useModelStore()
      if (!model.ttsEnabled || model.ttsStatus !== 'ready') {
        this.revealed = text
        return
      }
      const ctl = new AbortController()
      speakCtl = ctl
      let timedOut = false
      const timeout = setTimeout(() => {
        timedOut = true
        ctl.abort()
      }, SYNTH_TIMEOUT_MS)
      let clip
      try {
        clip = await synthesize(text.trim(), ctl.signal)
      } catch {
        if (timedOut || !ctl.signal.aborted) this.ttsWarning = TTS_WARNING // 사용자 중단은 경고가 아니다
        this.revealed = text
        return
      } finally {
        clearTimeout(timeout)
        if (speakCtl === ctl) speakCtl = null
      }
      if (ctl.signal.aborted) {
        this.revealed = text
        return
      }
      speakText = text
      playing = playClip(clip, { muted: this.muted })
      this.speaking = true
      this.stage = 'speaking'
      const t0 = Date.now()
      const dur = Math.max(1, clip.durationMs)
      revealTimer = setInterval(() => {
        const n = Math.min(text.length, Math.floor((text.length * (Date.now() - t0)) / dur))
        this.revealed = text.slice(0, n)
      }, REVEAL_TICK_MS)
      await Promise.race([
        playing.done,
        new Promise<void>((r) => setTimeout(r, clip.durationMs + PLAY_GRACE_MS)),
      ])
      this.stopSpeaking()
    },

    /** 내부: 재생·타이핑을 멈추고 텍스트를 전부 보인다. 재생이 끝난 시각을 마지막 질문의 at으로 (답변 타이머 기준) */
    stopSpeaking() {
      if (revealTimer) clearInterval(revealTimer)
      revealTimer = null
      playing?.stop()
      playing = null
      if (!this.speaking) return
      this.speaking = false
      this.revealed = speakText
      const last = this.messages.at(-1)
      if (last?.role === 'model') last.at = Date.now()
    },

    toggleMuted() {
      this.muted = !this.muted
      setMuted(this.muted)
      try {
        localStorage.setItem(MUTED_KEY, this.muted ? '1' : '0')
      } catch {
        /* 사생활 모드 등 — 이번 세션만 유지 */
      }
    },
```
`abort()`:
```ts
    async abort() {
      abortCtl?.abort()
      speakCtl?.abort()
      this.stopSpeaking()
      await inflight
    },
```
`reset()` 앞부분에 `speakCtl?.abort(); this.stopSpeaking()` 추가하고 state 초기화에 `this.speaking = false; this.revealed = ''; this.ttsWarning = null` 추가(`muted`는 유지). `finish()`는 이미 `abort()`를 부르므로 그대로.

- [ ] **Step 4: 통과 확인** — `pnpm vitest run src/stores src/components/interview src/views` → PASS. `pnpm exec vue-tsc --noEmit`도 통과(`asking` 참조가 남아 있으면 여기서 잡힌다).

- [ ] **Step 5: 커밋**
```bash
git add src/stores/interview.ts src/stores/interview.test.ts src/components/interview/interviewerAnims.ts src/components/interview/interviewerAnims.test.ts src/components/interview/InterviewStage.test.ts
git commit -m "feat(frontend): interview 스토어 음성 턴 — speaking 단계, 합성→재생과 함께 revealed 타이핑, 15초 상한, 음소거 기억, 중단 시 정지"
```

---

### Task 4: `InterviewStage` — 음소거 토글·경고 줄

**Files:**
- Create: `frontend/src/components/ui/icons/SpeakerIcon.vue`
- Modify: `frontend/src/components/interview/InterviewStage.vue`
- Test: `frontend/src/components/interview/InterviewStage.test.ts`

**Interfaces:**
- Consumes: Task 3 `Stage`(`speaking`).
- Produces: props `muted: boolean`, `warning?: string`; emit `'toggle-mute': []`. `data-test="mute"`(`aria-pressed` = muted), `data-test="tts-warning"`.

- [ ] **Step 1: 실패 테스트** — `InterviewStage.test.ts`의 `base`에 `muted: false` 추가, `describe('InterviewStage')`에:

```ts
  it('음소거 토글: 켜짐이면 aria-pressed=false, 클릭하면 toggle-mute', async () => {
    const w = mount(InterviewStage, { props: base })
    const btn = w.find('[data-test="mute"]')
    expect(btn.attributes('aria-pressed')).toBe('false')
    expect(btn.classes()).toContain('press')
    await btn.trigger('click')
    expect(w.emitted('toggle-mute')).toHaveLength(1)
    await w.setProps({ muted: true })
    expect(w.find('[data-test="mute"]').attributes('aria-pressed')).toBe('true')
  })
  it('경고 한 줄은 말풍선 아래에만, 없으면 렌더하지 않는다', async () => {
    const w = mount(InterviewStage, { props: base })
    expect(w.find('[data-test="tts-warning"]').exists()).toBe(false)
    await w.setProps({ warning: '음성을 만들지 못했습니다' })
    expect(w.find('[data-test="tts-warning"]').text()).toBe('음성을 만들지 못했습니다')
  })
  it('생성 중(thinking)엔 말풍선이 …', () => {
    const w = mount(InterviewStage, { props: { ...base, stage: 'thinking', bubble: '' } })
    expect(w.find('.bubble').text()).toBe('…')
  })
```

- [ ] **Step 2: 실패 확인** — `pnpm vitest run src/components/interview/InterviewStage.test.ts` → `[data-test="mute"]` 없음

- [ ] **Step 3: 구현** — `SpeakerIcon.vue`:
```vue
<script setup lang="ts">
withDefaults(defineProps<{ muted?: boolean; size?: number }>(), { muted: false, size: 16 })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="currentColor"
    shape-rendering="crispEdges"
    aria-hidden="true"
  >
    <path d="M2 6h3l4-4v12l-4-4H2z" />
    <template v-if="!muted">
      <rect x="11" y="6" width="2" height="4" />
      <rect x="14" y="4" width="2" height="8" />
    </template>
    <path v-else d="M10 5l1-1 5 5-1 1zM15 4l1 1-5 5-1-1z" />
  </svg>
</template>
```
`InterviewStage.vue`: import `SpeakerIcon`, props에 `muted: boolean; warning?: string`, emits에 `'toggle-mute': []`. 템플릿 topbar 오른쪽을
```vue
      <div class="right">
        <button
          type="button"
          class="mute press"
          :class="{ off: muted }"
          data-test="mute"
          :aria-pressed="muted"
          :title="muted ? '소리 켜기' : '소리 끄기'"
          @click="emit('toggle-mute')"
        >
          <span><SpeakerIcon :muted="muted" /></span>
        </button>
        <PixelButton variant="secondary" data-test="end" @click="emit('end')">면접 종료</PixelButton>
      </div>
```
(아이콘을 `<span>`으로 감싸는 이유: `.press:hover > svg:first-child`의 커서 nudge가 스피커에 걸리지 않게.) 말풍선 바로 아래에
```vue
    <p v-if="warning" class="mono warning" data-test="tts-warning">{{ warning }}</p>
```
스타일:
```css
.right {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.mute {
  width: 36px;
  height: 36px;
  display: inline-grid;
  place-items: center;
  background: var(--raise);
  color: var(--accent);
  border: 2px solid var(--line);
  --press-shadow: var(--raise);
  box-shadow: 4px 4px 0 var(--press-shadow);
  cursor: pointer;
}
.mute.off {
  color: var(--text-3);
}
.warning {
  margin: var(--sp-3) 0 0;
  font-size: var(--fs-meta);
  color: var(--danger);
}
```

- [ ] **Step 4: 통과 확인** — `pnpm vitest run src/components/interview/InterviewStage.test.ts` → PASS

- [ ] **Step 5: 커밋**
```bash
git add src/components/ui/icons/SpeakerIcon.vue src/components/interview/InterviewStage.vue src/components/interview/InterviewStage.test.ts
git commit -m "feat(frontend): 면접실 우상단 음소거 토글(스피커 아이콘)과 말풍선 아래 음성 경고 줄"
```

---

### Task 5: `InterviewView` — revealed·speaking 연동

**Files:**
- Modify: `frontend/src/views/InterviewView.vue`
- Test: `frontend/src/views/InterviewView.test.ts`

**Interfaces:**
- Consumes: Task 3 `s.revealed/speaking/muted/ttsWarning/toggleMuted`, Task 4 props/emit.
- Produces: 없음(화면).

- [ ] **Step 1: 실패 테스트** — `InterviewView.test.ts` 상단 mock에 `vi.mock('@/services/tts', () => ({ synthesize: vi.fn(), initTts: vi.fn(), disposeTts: vi.fn() }))`와 `vi.mock('@/services/audio', () => ({ playClip: vi.fn(), setMuted: vi.fn(), warmUpAudio: vi.fn() }))` 추가. 첫 테스트를 교체하고 아래를 추가:

```ts
  it('말풍선은 revealed(음성에 맞춰 드러난 부분)만 보인다', () => {
    const { w } = mountWith({
      messages: [{ role: 'model', text: '첫 질문입니다' }],
      revealed: '첫 질',
    })
    expect(w.find('.bubble').text()).toBe('첫 질')
  })
  it('speaking 중엔 말하기·전송이 잠기고 답변 타이머가 없다', () => {
    const { w } = mountWith({
      stage: 'speaking',
      speaking: true,
      messages: [{ role: 'model', text: 'q', at: Date.now() }],
    })
    expect((w.find('[data-test="send"]').element as HTMLButtonElement).disabled).toBe(true)
    expect((w.find('textarea').element as HTMLTextAreaElement).disabled).toBe(true)
    expect(w.find('[data-test="answer-timer"]').exists()).toBe(false)
  })
  it('ended여도 speaking 중엔 마무리 창을 띄우지 않는다', async () => {
    const { w, s } = mountWith({
      stage: 'speaking',
      speaking: true,
      ended: true,
      messages: [{ role: 'model', text: '마치겠습니다', at: Date.now() }],
    })
    expect(w.find('[data-test="closing"]').exists()).toBe(false)
    s.$patch({ speaking: false, stage: 'waiting' })
    await w.vm.$nextTick()
    expect(w.find('[data-test="closing"]').exists()).toBe(true)
  })
  it('음소거 토글은 store.toggleMuted, 경고는 store.ttsWarning', async () => {
    const { w, s } = mountWith({ ttsWarning: '음성을 만들지 못했습니다' })
    const toggle = vi.spyOn(s, 'toggleMuted').mockImplementation(() => undefined)
    expect(w.find('[data-test="tts-warning"]').text()).toBe('음성을 만들지 못했습니다')
    await w.find('[data-test="mute"]').trigger('click')
    expect(toggle).toHaveBeenCalled()
  })
```

- [ ] **Step 2: 실패 확인** — `pnpm vitest run src/views/InterviewView.test.ts` → FAIL

- [ ] **Step 3: 구현** — `InterviewView.vue` script에서 `lastModel`·`bubble` computed를 삭제하고:
```ts
const inputDisabled = computed(
  () => s.ended || s.overLimit || s.reportStatus !== 'idle' || s.speaking,
)
```
`questionAt` 조건에 `!s.speaking &&` 추가(`!s.generating && !s.speaking && !s.ended && …`). `closing`을 `s.ended && !s.generating && !s.speaking && s.reportStatus === 'idle'`. 템플릿 `<InterviewStage>`를
```vue
      <InterviewStage
        :stage="s.stage"
        :bubble="s.revealed"
        :streaming="s.speaking"
        :react-pending="s.reactPending"
        :watch-tick="watchTick"
        :field-label="fieldLabel"
        :job="s.profile.job"
        :elapsed-ms="elapsedMs"
        :muted="s.muted"
        :warning="s.ttsWarning ?? ''"
        @react-done="s.consumeReact()"
        @toggle-mute="s.toggleMuted()"
        @end="confirming = true"
      />
```

- [ ] **Step 4: 통과 확인** — `pnpm vitest run src/views/InterviewView.test.ts src/components/interview` → PASS

- [ ] **Step 5: 커밋**
```bash
git add src/views/InterviewView.vue src/views/InterviewView.test.ts
git commit -m "feat(frontend): 면접 화면 음성 연동 — 말풍선은 revealed, 재생 중 입력 잠금·타이머 보류·마무리 창 보류, 음소거 토글"
```

---

### Task 6: 준비 화면 "목소리 준비 중" 단계 + 데모 체크리스트

**Files:**
- Modify: `frontend/src/components/ui/PixelProgress.vue`
- Modify: `frontend/src/views/PrepareView.vue`
- Modify: `docs/demo-checklist.md`
- Test: `frontend/src/components/ui/PixelProgress.test.ts`, `frontend/src/views/PrepareView.test.ts`

**Interfaces:**
- Consumes: Task 2 `model.ttsEnabled/ttsStatus/ttsProgress/ttsReceived/ttsTotal/ttsError/ready/retryTts`, `warmUpAudio`.
- Produces: `PixelProgress` prop `phase`에 `'voice'` 추가 — 캡션 "목소리 준비 중", 오른쪽 `N%`, 캔버스 장면은 look_up 유지(진행률이 0으로 떨어져도 장면을 리셋하지 않는다).

- [ ] **Step 1: 실패 테스트** — `PixelProgress.test.ts`에:
```ts
  it('voice 단계: 캡션 "목소리 준비 중"과 진행률, 걷기 장면으로 돌아가지 않는다', () => {
    const w = mount(PixelProgress, { props: { ...base, progress: 42, phase: 'voice' } })
    expect(w.text()).toContain('목소리 준비 중')
    expect(w.text()).toContain('42%')
  })
```
`PrepareView.test.ts` 상단 mock에 `vi.mock('@/services/tts', () => ({ initTts: vi.fn(async () => {}), synthesize: vi.fn(async () => ({ samples: new Float32Array(1), sampleRate: 44100, durationMs: 0 })), disposeTts: vi.fn() }))`, `vi.mock('@/services/audio', () => ({ warmUpAudio: vi.fn(), playClip: vi.fn(), setMuted: vi.fn() }))`, `import { warmUpAudio } from '@/services/audio'`. 테스트 추가:

```ts
const TTS = {
  id: 'supertonic-3',
  baseUrl: '/models/tts/supertonic-3/',
  files: [{ path: 'a.onnx', size: 100 }],
  voice: 'M2',
  lang: 'ko',
}
const manifestWithTts = {
  id: 'e4b',
  url: '/models/e4b.litertlm',
  size: 100,
  template: { turnStart: '', turnEnd: '', roles: {} },
  systemPromptOverride: null,
  fallback: null,
  tts: TTS,
}

describe('PrepareView — 목소리 준비', () => {
  it('Gemma ready + TTS 다운로드 중이면 진행 창은 voice 단계에 TTS 수치, 체크리스트에 "목소리 준비"', () => {
    const m = useModelStore()
    m.manifest = manifestWithTts
    m.status = 'ready'
    m.received = 100
    m.$patch({ ttsStatus: 'downloading', ttsReceived: 40, ttsTotal: 100 })
    const w = mountView()
    const stub = w.find('pixel-progress-stub')
    expect(stub.attributes('phase')).toBe('voice')
    expect(stub.attributes('progress')).toBe('40')
    expect(stub.attributes('filename')).toBe('supertonic-3')
    expect(w.text()).toContain('목소리 준비 (40%)')
    expect((w.find('[data-test="start"]').element as HTMLButtonElement).disabled).toBe(true)
  })
  it('TTS 실패면 error 단계 + 원인, 다시 시도는 retryTts만 부른다', async () => {
    const m = useModelStore()
    m.manifest = manifestWithTts
    m.status = 'ready'
    m.$patch({ ttsStatus: 'error', ttsError: 'size mismatch' })
    const retryTts = vi.spyOn(m, 'retryTts').mockResolvedValue()
    const retry = vi.spyOn(m, 'retry').mockResolvedValue()
    const w = mount(PrepareView)
    expect(w.text()).toContain('size mismatch')
    expect(w.text()).toContain('목소리 준비 (실패)')
    await w.find('[data-test="retry-tts"]').trigger('click')
    expect(retryTts).toHaveBeenCalled()
    expect(retry).not.toHaveBeenCalled()
    expect(w.find('[data-test="retry-model"]').exists()).toBe(false)
  })
  it('manifest.tts가 없으면 체크리스트에 목소리 항목이 없고 Gemma ready면 ready 단계', () => {
    const m = useModelStore()
    m.manifest = { ...manifestWithTts, tts: null }
    m.status = 'ready'
    m.ttsStatus = 'ready'
    const w = mountView()
    expect(w.text()).not.toContain('목소리 준비')
    expect(w.find('pixel-progress-stub').attributes('phase')).toBe('ready')
  })
  it('면접 시작 클릭은 warmUpAudio를 먼저 부른다', async () => {
    const m = useModelStore()
    m.manifest = manifestWithTts
    m.status = 'ready'
    m.ttsStatus = 'ready'
    const w = mountView()
    await fillProfile(w)
    vi.mocked(extractPdfText).mockResolvedValue('가'.repeat(100))
    const input = w.find('[data-test="file"]')
    Object.defineProperty(input.element, 'files', {
      value: [new File(['x'], 'cv.pdf', { type: 'application/pdf' })],
    })
    await input.trigger('change')
    await flushPromises()
    const interview = useInterviewStore()
    const start = vi.spyOn(interview, 'start').mockResolvedValue()
    await w.find('[data-test="start"]').trigger('click')
    expect(warmUpAudio).toHaveBeenCalled()
    expect(start).toHaveBeenCalled()
  })
})
```
(파일 업로드 시뮬레이션은 이 테스트 파일에 이미 같은 패턴이 있으면 그 헬퍼를 쓴다.)

- [ ] **Step 2: 실패 확인** — `pnpm vitest run src/components/ui/PixelProgress.test.ts src/views/PrepareView.test.ts` → FAIL

- [ ] **Step 3: 구현** — `PixelProgress.vue`: `phase: 'download' | 'init' | 'voice' | 'ready' | 'error'`. `caption`에 `if (props.phase === 'voice') return '목소리 준비 중'`(init 분기 다음). `right`를
```ts
const right = computed(() =>
  props.phase === 'download' || props.phase === 'voice'
    ? [`${props.progress}%`, props.eta].filter(Boolean).join(' · ')
    : props.phase === 'init'
      ? '초기화 중'
      : '',
)
```
진행률 watch의 리셋을 걷기 단계에서만: `if (p < (prev ?? 0) && props.phase === 'download') resetScene()`. (voice에서는 장면이 이미 look_up 마지막 프레임이고 `phase !== 'download'`라 걷지 않는다.)

`PrepareView.vue`:
```ts
import { warmUpAudio } from '@/services/audio'

/* 진행 창: Gemma(다운로드→초기화) 다음에 목소리(voice). 둘 다 끝나야 ready */
const voice = computed(() => model.status === 'ready' && model.ttsEnabled)
const phase = computed(() => {
  if (model.status === 'error' || (voice.value && model.ttsStatus === 'error')) return 'error'
  if (model.status !== 'ready') return model.status === 'initializing' ? 'init' : 'download'
  return model.ready ? 'ready' : 'voice'
})
const fileName = computed(() =>
  voice.value ? (model.manifest?.tts?.id ?? '') : (model.active?.url.split('/').pop() ?? ''),
)
const ttsError = computed(() => voice.value && model.ttsStatus === 'error')
```
템플릿 `<PixelProgress>`:
```vue
          <PixelProgress
            :progress="voice ? model.ttsProgress : model.progress"
            :phase="phase"
            :received="voice ? model.ttsReceived : model.received"
            :total="voice ? model.ttsTotal : model.total"
            :file-name="fileName"
            :eta="eta"
            :error-text="ttsError ? `목소리를 준비하지 못했습니다: ${model.ttsError}` : (model.error ?? '')"
          >
            <template #actions>
              <template v-if="ttsError">
                <PixelButton variant="secondary" data-test="retry-tts" @click="model.retryTts()">
                  다시 시도
                </PixelButton>
              </template>
              <template v-else>
                <PixelButton variant="secondary" data-test="retry-model" @click="model.retry()">다시 시도</PixelButton>
                <!-- 기존 경량 모델·캐시 지우기 버튼 그대로 -->
              </template>
            </template>
          </PixelProgress>
```
체크리스트 `<li>` 면접관 출근 다음에:
```vue
            <li v-if="model.ttsEnabled">
              <i
                :class="{
                  ok: model.ttsStatus === 'ready',
                  wait: model.ttsStatus !== 'ready',
                  blink: model.ttsStatus !== 'ready' && model.ttsStatus !== 'error',
                }"
              />
              목소리 준비 ({{
                model.ttsStatus === 'ready'
                  ? '완료'
                  : model.ttsStatus === 'error'
                    ? '실패'
                    : `${model.ttsProgress}%`
              }})
            </li>
```
`start()`의 `if` 블록 첫 줄에 `warmUpAudio()` (사용자 제스처 안에서 AudioContext를 푼다).

`docs/demo-checklist.md`의 "## 리포트" 앞에:
```markdown
## 음성(TTS) — 면접 연동 (이슈 #13)

- [ ] 준비 화면: 면접관 출근(다운로드→초기화)이 끝나면 같은 진행 창이 "목소리 준비 중"으로 바뀌고 TTS 진행률이 오른다. 캐릭터는 자리에 앉은 채(look_up) 그대로. 체크리스트에 "목소리 준비" 줄이 있고, 둘 다 완료돼야 `면접 시작`이 열린다
- [ ] 첫 질문: 말풍선이 "…"로 있다가 음성이 나오기 시작하면서 글자가 말 속도에 맞춰 드러난다(끝나는 시점이 음성과 같다). 가운데 면접관은 말하는 동안 질문 제스처를 반복
- [ ] 재생 중 말하기·전송·텍스트 영역이 잠기고, 답변 타이머는 없다가 재생이 끝나면 60초에서 시작한다
- [ ] 우상단 스피커 토글: 재생 도중 눌러도 즉시 조용해지고(글자는 계속 드러남), 새로고침해도 상태가 남는다
- [ ] 재생 중 `면접 종료 → 리포트 만들기`: 소리가 바로 멈추고 리포트로 넘어간다. 리포트 응답은 읽지 않는다
- [ ] 로컬 서빙(8765)을 끈 채 준비: "목소리를 준비하지 못했습니다: …"와 `다시 시도`(TTS만). 서빙을 켜고 다시 시도하면 Gemma 재초기화 없이 목소리만 준비된다
- [ ] 60자 질문의 "생각 중"(생성+합성) 첫 턴 8초 이내, 이후 6초 이내 — 측정값을 PR에 적는다
```

- [ ] **Step 4: 통과 확인** — 전체 게이트: `pnpm test && pnpm lint && pnpm exec prettier --check . && pnpm exec vue-tsc --noEmit && pnpm build`

- [ ] **Step 5: 커밋**
```bash
git add src/components/ui/PixelProgress.vue src/components/ui/PixelProgress.test.ts src/views/PrepareView.vue src/views/PrepareView.test.ts ../docs/demo-checklist.md
git commit -m "feat(frontend): 준비 화면 목소리 준비 단계(진행률·TTS만 다시 시도·체크리스트), 시작 클릭에 warmUpAudio, 데모 체크리스트 음성 연동 절"
```

---

## Self-Review

- spec 4절 ↔ Task: model 상태·`retryTts`(T2), `speaking/revealed/muted`·`canStart`·stage 전이·15초·실패 처리·`abort/finish/reset` 정지·리포트 미합성(T3), `InterviewStage` bubble/…/speaking 제스처/토글(T4 + T3의 `baseAnims`), `AnswerInput` 잠금·침묵 타이머(T5: `disabled`에 `speaking` → 기존 watch가 듣기·타이머를 내린다), 답변 지연 watch(waiting 진입 그대로), `warmUpAudio`(T6), `PrepareView` 2단계·look_up·TTS만 재시도(T6).
- spec 5절: 다운로드·워커 실패 → `ttsStatus='error'` + 원인(T2·T6). 합성 실패·15초(T3). AudioContext 차단 → `warmUpAudio` + `PLAY_GRACE_MS` 상한(T3·T6). 중단·종료·리셋(T3).
- spec 6절: 워밍업(T2). 마이크·전송 잠금(T5), 토글 즉시 반영(T1·T3).
- 타입 일치: `Stage`에서 `asking` 제거는 T3에서 `interviewerAnims.ts`·두 테스트를 함께 고친다. `playClip(clip, { muted })` 호출 형태는 T1 완화 뒤에도 그대로 유효. `model.ready`는 T2가 만들고 T3(`canStart`)·T6(`phase`)이 읽는다.
- spec과 다른 점(의도): spec은 "`speaking`이면 talk"라 했으나 1차 애니 세트(talk)는 폐기됐고 사용자 결정으로 질문 중엔 `center_question` 반복 → `baseAnims('speaking')`이 그것. spec의 `canStart`에 `ttsStatus==='ready'` 추가는 `model.ready`(= `!ttsEnabled || ttsStatus==='ready'`)로 구현해 텍스트 전용 폴백을 같은 식으로 처리.
