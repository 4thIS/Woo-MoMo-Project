import { defineStore } from 'pinia'
import { getQuestions } from '@/services/api'
import { truncateResume } from '@/utils/truncate'
import { useModelStore, MAX_NUM_TOKENS } from './model'
import { startSession, type LlmSession } from '@/services/llm'
import { buildSystemPrompt, KICKOFF } from '@/prompts/interviewer'
import { REPORT_INSTRUCTION } from '@/prompts/report'
import { stripThoughts, ThoughtFilter } from '@/utils/thoughts'
import { approxTokens } from '@/utils/tokens'
import { hasEndPhrase } from '@/utils/endDetector'
import { isGoodAnswer } from '@/utils/goodAnswer'
import { parseReport, type ReportItem } from '@/utils/reportParser'
import { synthesize } from '@/services/tts'
import { playClip, setMuted } from '@/services/audio'

export type Phase = 'landing' | 'prepare' | 'interview' | 'report'
export type Field = 'it' | 'finance' | 'manufacturing' | 'retail' | 'general'

export const FIELD_LABELS: Record<Field, string> = {
  it: 'IT',
  finance: '금융',
  manufacturing: '제조',
  retail: '유통',
  general: '기타',
}

export const RESUME_MIN = 50

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
export interface ChatMessage {
  role: 'user' | 'model'
  text: string
  /** epoch ms. 면접관 턴은 말이 끝난 시각, 지원자 턴은 전송 시각. 스토어가 만드는 메시지는 항상 찍는다 */
  at?: number
}
// 엔진 컨텍스트 상한 − maxOutputTokens(리포트/응답 최대 생성량) − 여유
export const TOKEN_LIMIT = MAX_NUM_TOKENS - 1024 - 512

let session: LlmSession | null = null // 모듈 스코프: Pinia state에 비직렬 객체를 넣지 않는다
let abortCtl: AbortController | null = null
let inflight: Promise<void> | null = null // 진행 중 generate — abort()/finish()가 정리 완료를 기다리는 데 쓴다
let starting = false // start() 중복 클릭 가드
let lastSent = '' // retryLast가 재전송할 마지막 요청 텍스트(user 턴이 없을 때 — 킥오프 실패 등)
let systemPrompt = '' // 근사치 계산에 프리필(시스템 프롬프트) 분량을 포함시키기 위해 보관
let speakCtl: AbortController | null = null // 진행 중 합성의 취소(사용자 중단·15초 상한)
let playing: { stop(): void } | null = null
let revealTimer: ReturnType<typeof setInterval> | null = null
let speakText = '' // 재생 중인 발화 전문 — 중단 시 이걸로 revealed를 채운다

export const useInterviewStore = defineStore('interview', {
  state: () => ({
    phase: 'landing' as Phase,
    profile: { field: null as Field | null, job: '' },
    resumeText: '',
    resumeName: null as string | null,
    fallbackQuestions: [] as string[],
    messages: [] as ChatMessage[],
    stage: 'idle' as Stage,
    streaming: '',
    speaking: false,
    revealed: '',
    muted: loadMuted(),
    ttsWarning: null as string | null,
    generating: false,
    genError: null as string | null,
    reactPending: false,
    ended: false,
    tokenCount: 0,
    report: null as ReportItem[] | null,
    reportRaw: '',
    reportStatus: 'idle' as 'idle' | 'writing' | 'done' | 'error',
    startedAt: null as number | null,
    endedAt: null as number | null,
  }),
  getters: {
    profileDone: (s) => s.profile.field !== null && s.profile.job.trim().length > 0,
    resumeDone: (s) => s.resumeText.length >= RESUME_MIN,
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
    overLimit: (s) => s.tokenCount > TOKEN_LIMIT,
    /** 면접관 차례(생성·합성 대기·재생). 이 동안 지원자 입력과 답변 타이머는 멈춘다 */
    interviewerTurn: (s) => s.generating || s.speaking || s.stage === 'thinking',
  },
  actions: {
    goto(phase: Phase) {
      this.phase = phase
    },
    async setField(field: Field) {
      this.profile.field = field
      try {
        this.fallbackQuestions = (await getQuestions(field)).questions
      } catch {
        this.fallbackQuestions = [] // 폴백 질문 없이도 면접은 진행한다 (spec 5절)
      }
    },
    setJob(job: string) {
      this.profile.job = job.slice(0, 40)
    },
    setResume(name: string, rawText: string) {
      this.resumeName = name
      this.resumeText = truncateResume(rawText)
    },

    async start() {
      if (
        !this.canStart ||
        !this.profile.field ||
        starting ||
        this.generating ||
        this.speaking ||
        this.phase === 'interview'
      )
        return
      starting = true
      try {
        const model = useModelStore()
        const prompt = buildSystemPrompt({
          fieldLabel: FIELD_LABELS[this.profile.field],
          job: this.profile.job,
          resumeText: this.resumeText,
          fallbackQuestions: this.fallbackQuestions,
          override: model.manifest?.systemPromptOverride,
        })
        if (session) await session.dispose().catch(() => undefined)
        systemPrompt = prompt
        session = await startSession(prompt)
        this.messages = []
        this.ended = false
        this.genError = null
        this.report = null
        this.reportRaw = ''
        this.reportStatus = 'idle'
        this.startedAt = Date.now()
        this.endedAt = null
        this.phase = 'interview'
        await this.generate(KICKOFF)
      } finally {
        starting = false
      }
    },

    async send(text: string) {
      const t = text.trim()
      if (!t || this.interviewerTurn || this.ended) return
      this.messages.push({ role: 'user', text: t, at: Date.now() })
      this.reactPending = isGoodAnswer(t)
      await this.generate(t)
    },

    /** 내부: user 턴을 보내고 응답을 스트리밍해 messages에 확정한다 */
    async generate(userText: string) {
      if (!session) return
      lastSent = userText
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
        if (text) {
          // playClip이 던져도(AudioContext 생성 실패 등) 면접이 thinking에 갇히지 않게 — 텍스트만 보이고 계속
          try {
            await this.speak(this.streaming)
          } catch {
            this.revealed = this.streaming
            this.ttsWarning = TTS_WARNING
          }
        } else
          this.revealed = [...this.messages].reverse().find((m) => m.role === 'model')?.text ?? ''
        this.stage = 'waiting'
        await this.refreshTokens()
      }
      inflight = run()
      try {
        await inflight
      } finally {
        inflight = null
      }
    },

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
        if (timedOut) this.ttsWarning = TTS_WARNING // 신호를 무시하고 15초 뒤 늦게 온 결과 — 타임아웃과 같은 취급
        this.revealed = text
        return
      }
      speakText = text
      const play = playClip(clip, { muted: this.muted })
      playing = play
      this.speaking = true
      this.stage = 'speaking'
      const t0 = Date.now()
      const dur = Math.max(1, clip.durationMs)
      revealTimer = setInterval(() => {
        const n = Math.min(text.length, Math.floor((text.length * (Date.now() - t0)) / dur))
        this.revealed = text.slice(0, n)
      }, REVEAL_TICK_MS)
      await Promise.race([
        play.done,
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

    /** 진행 중 생성·재생을 중단한다. 반환 Promise는 중단된 generate가 완전히 정리된 뒤 resolve한다. */
    async abort() {
      abortCtl?.abort()
      speakCtl?.abort()
      this.stopSpeaking()
      await inflight
    },

    async retryLast() {
      if (this.generating) return
      const last = this.messages.at(-1)
      const text = last?.role === 'user' ? last.text : lastSent
      if (!text) return
      await this.generate(text)
    },

    setListening(on: boolean) {
      if (this.interviewerTurn) return
      if (on && this.stage === 'waiting') this.stage = 'listening'
      if (!on && this.stage === 'listening') this.stage = 'waiting'
    },

    consumeReact() {
      this.reactPending = false
    },

    async refreshTokens() {
      const n = session ? await session.tokenCount() : -1
      this.tokenCount =
        n >= 0 ? n : approxTokens(systemPrompt + '\n' + this.messages.map((m) => m.text).join('\n'))
    },

    async finish() {
      if (!session || this.reportStatus === 'writing') return
      // 가드를 await 이전에 동기로 선점 — finish()가 겹쳐 불려도 리포트 요청은 한 번만 나간다
      this.reportStatus = 'writing'
      if (this.endedAt === null) this.endedAt = Date.now()
      this.phase = 'report'
      this.reportRaw = ''
      // 진행 중이던 generate의 정리를 기다린다(inflight가 없으면 즉시 통과) —
      // abort()가 항상 inflight를 기다리므로 generate()의 꼬리(refreshTokens 등)와
      // 리포트 send가 겹치지 않는다
      await this.abort()
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
      await this.abort() // 재생·생성을 멈추고 generate의 꼬리까지 끝낸 뒤 비운다 — 안 그러면 꼬리가 stage를 waiting으로 되돌린다
      if (session) await session.dispose().catch(() => undefined)
      session = null
      lastSent = ''
      systemPrompt = ''
      this.messages = []
      this.stage = 'idle'
      this.streaming = ''
      this.speaking = false
      this.revealed = ''
      this.ttsWarning = null
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
      this.startedAt = null
      this.endedAt = null
      this.phase = 'prepare'
    },
  },
})
