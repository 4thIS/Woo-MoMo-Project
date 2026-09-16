import { defineStore } from 'pinia'
import { getQuestions } from '@/services/api'
import { truncateResume } from '@/utils/truncate'
import { useModelStore } from './model'
import { startSession, type LlmSession } from '@/services/llm'
import { buildSystemPrompt, KICKOFF } from '@/prompts/interviewer'
import { REPORT_INSTRUCTION } from '@/prompts/report'
import { ThoughtFilter } from '@/utils/thoughts'
import { approxTokens } from '@/utils/tokens'
import { hasEndPhrase } from '@/utils/endDetector'
import { isGoodAnswer } from '@/utils/goodAnswer'
import { parseReport, type ReportItem } from '@/utils/reportParser'

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

export type Stage = 'idle' | 'asking' | 'waiting' | 'listening' | 'thinking'
export interface ChatMessage {
  role: 'user' | 'model'
  text: string
}
export const TOKEN_LIMIT = 6500

let session: LlmSession | null = null // 모듈 스코프: Pinia state에 비직렬 객체를 넣지 않는다
let abortCtl: AbortController | null = null

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
    generating: false,
    genError: null as string | null,
    reactPending: false,
    ended: false,
    tokenCount: 0,
    report: null as ReportItem[] | null,
    reportRaw: '',
    reportStatus: 'idle' as 'idle' | 'writing' | 'done' | 'error',
  }),
  getters: {
    profileDone: (s) => s.profile.field !== null && s.profile.job.trim().length > 0,
    resumeDone: (s) => s.resumeText.length >= RESUME_MIN,
    canStart(): boolean {
      return useModelStore().status === 'ready' && this.profileDone && this.resumeDone
    },
    startBlockReason(): string | null {
      if (this.canStart) return null
      if (useModelStore().status !== 'ready') return '면접관이 자리에 앉으면 열립니다'
      return '위 항목을 채우면 열립니다'
    },
    overLimit: (s) => s.tokenCount > TOKEN_LIMIT,
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
      await this.generate(KICKOFF)
    },

    async send(text: string) {
      const t = text.trim()
      if (!t || this.generating || this.ended) return
      this.messages.push({ role: 'user', text: t })
      this.reactPending = isGoodAnswer(t)
      await this.generate(t)
    },

    /** 내부: user 턴을 보내고 응답을 스트리밍해 messages에 확정한다 */
    async generate(userText: string) {
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
        // 트림한 값이 아니라 원본으로 판단한다: 공백만 온 턴도 실제로 응답이 온 것이므로 기록한다.
        // (thought만 오고 화면에 보일 텍스트가 전혀 없었던 경우에만 진짜 빈 문자열이 되어 걸러진다.)
        if (this.streaming) this.messages.push({ role: 'model', text: this.streaming })
        if (hasEndPhrase(this.streaming.trim())) this.ended = true
      } catch (e) {
        this.genError = e instanceof Error ? e.message : String(e)
      } finally {
        this.generating = false
        this.stage = 'waiting'
        abortCtl = null
        await this.refreshTokens()
      }
    },

    abort() {
      abortCtl?.abort()
    },

    async retryLast() {
      const last = this.messages.at(-1)
      if (!last || last.role !== 'user' || this.generating) return
      await this.generate(last.text)
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
  },
})
