import { defineStore } from 'pinia'
import { getQuestions } from '@/services/api'
import { truncateResume } from '@/utils/truncate'
import { useModelStore, MAX_NUM_TOKENS } from './model'
import { startSession, type LlmSession } from '@/services/llm'
import { buildSystemPrompt, KICKOFF } from '@/prompts/interviewer'
import { buildReportInstruction } from '@/prompts/report'
import { PERSONAS } from '@/prompts/personas'
import {
  DEFAULT_INTERVIEWER,
  interviewerById,
  type Interviewer,
  type InterviewerId,
} from '@/interviewers'
import { useInterviewerStore } from './interviewer'
import { stripThoughts, ThoughtFilter } from '@/utils/thoughts'
import { approxTokens } from '@/utils/tokens'
import { normalizePostingUrl } from '@/utils/postingUrl'
import { hasEndPhrase } from '@/utils/endDetector'
import { isGoodAnswer } from '@/utils/goodAnswer'
import { canStartWith, trackOf } from '@/utils/track'
import type { ArchiveDraft, Track } from '@/services/account'
import { useAccountStore } from './account'
import { parseReport, type ReportItem } from '@/utils/reportParser'
import { type ReportV2 } from '@/utils/reportV2'
import { synthesize } from '@/services/tts'
import { startRecording, type Recorder } from '@/services/recorder'
import {
  BenError,
  reportStream,
  startInterview,
  turnStream,
  uploadVoice,
  type DeliveryMetric,
  type StartRequest,
} from '@/services/benInterview'
import { decodeClip, playClip, setMuted } from '@/services/audio'
import { analyzeSpeech, countSyllables, fillerLevelOf } from '@/utils/delivery'
import { toWav16k } from '@/utils/wav'

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
/** 한 면접의 녹음 합계 상한. 라즈베리파이 디스크를 지키는 값이다 — cw가 정한 값이 오면 그 값으로 */
export const RECORDING_MAX_BYTES = 30 * 1024 * 1024
export const RECORDING_FULL = '녹음 용량이 차서 이후 답변은 녹음되지 않습니다'
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

/** 벤 면접 id. 있으면 이 면접은 **서버가** 대화를 가진다 */
let benId: string | null = null
let recorder: Recorder | null = null
/** 답변별 녹음 조각. 기록을 만든 **뒤에** 올려야 하므로 그때까지 들고 있는다.
 *  Blob은 직렬화할 수 없어 Pinia state에 두지 않는다 */
let clips: { turn: number; blob: Blob; durationSec: number }[] = []
/** 전달력 측정(벤 전용, #99). 답변마다 바로 걸어 두고 리포트 요청 직전에 거둔다 —
 *  마지막에 몰아 재면 리포트를 누른 뒤 멈춘 것처럼 보인다 */
let measuring: Promise<DeliveryMetric | null>[] = []
let recordedBytes = 0
let session: LlmSession | null = null // 모듈 스코프: Pinia state에 비직렬 객체를 넣지 않는다
let abortCtl: AbortController | null = null
let inflight: Promise<void> | null = null // 진행 중 generate — abort()/finish()가 정리 완료를 기다리는 데 쓴다
let starting = false // start() 중복 클릭 가드
let lastSent = '' // retryLast가 재전송할 마지막 요청 텍스트(user 턴이 없을 때 — 킥오프 실패 등)
let systemPrompt = '' // 근사치 계산에 프리필(시스템 프롬프트) 분량을 포함시키기 위해 보관
let speakCtl: AbortController | null = null // 진행 중 합성의 취소(사용자 중단·15초 상한)
let playing: { stop(): void } | null = null
let revealTimer: ReturnType<typeof setInterval> | null = null
let graceTimer: ReturnType<typeof setTimeout> | null = null // onended가 안 올 때의 상한
let speakText = '' // 재생 중인 발화 전문 — 중단 시 이걸로 revealed를 채운다

/** 답변 조각 하나를 숫자로. 못 재면 null — 그 답변만 빠지고 면접·리포트는 그대로다.
 *  파형도 받아쓴 텍스트도 여기서 끝난다. 나가는 건 숫자뿐이다(`docs/API.md`) */
async function measureClip(
  blob: Blob,
  answer: number,
  text: string,
  onWav?: (wav: ArrayBuffer) => void,
): Promise<DeliveryMetric | null> {
  const decoded = await decodeClip(blob)
  if (!decoded) return null
  // 같은 디코드 결과로 올릴 WAV까지 만든다 — 파형을 두 번 풀 이유가 없다
  onWav?.(toWav16k(decoded.samples, decoded.sampleRate))
  const stats = analyzeSpeech(decoded.samples, decoded.sampleRate)
  if (!stats) return null
  return { answer, ...stats, syllables: countSyllables(text), fillerLevel: fillerLevelOf(text) }
}

export const useInterviewStore = defineStore('interview', {
  state: () => ({
    phase: 'landing' as Phase,
    /** 트랙이 보는 칸만 쓴다. 유니온으로 가르면 화면 분기만 늘어난다 —
     *  어느 칸을 볼지는 canStartWith가 트랙별로 안다 */
    profile: {
      field: null as Field | null,
      job: '',
      /** 벤 + 회사에서만 쓰는 선택 입력. 있으면 서버가 웹을 뒤져 브리핑을 만든다 */
      companyName: '',
      /** 모집공고 링크(선택). 회사명과 따로 — 둘 중 하나만 있어도 조사가 돈다 */
      postingUrl: '',
      name: '',
      age: null as number | null,
      university: '',
      department: '',
    },
    /** 서버가 공고 링크를 퇴짜 놓았을 때의 안내. 그 칸 옆에만 붙는다 */
    postingError: null as string | null,
    /** 목소리 분석에 동의했나(2026-10-23). 기본 꺼짐 — 켜야 녹음이 서버로 간다 */
    voiceConsent: false,
    /** 서버가 실제로 분석할 수 있는가. `on`일 때만 올린다 */
    voiceAnalysis: 'off' as 'on' | 'off' | 'unavailable',
    /** 벤처럼 둘 다 보는 면접관에서만 쓴다. 다른 면접관은 자기 트랙이 이긴다 */
    chosenTrack: null as Track | null,
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
    /** 벤 회사 브리핑(첫 턴만). `researching`이면 조사 중, `failed`면 못 찾고 그냥 간다.
     *  성공하면 보여 줄 것이 없으므로 다시 null로 돌아간다 */
    briefing: null as 'researching' | 'failed' | null,
    reactPending: false,
    ended: false,
    tokenCount: 0,
    report: null as ReportItem[] | null,
    /** 벤 리포트 버전 2. 있으면 화면은 이것으로 그린다(없으면 report = 버전 1) */
    reportV2: null as ReportV2 | null,
    reportRaw: '',
    reportStatus: 'idle' as 'idle' | 'writing' | 'done' | 'error',
    startedAt: null as number | null,
    endedAt: null as number | null,
    /** 이 면접의 면접관 — start()에서 고정(spec 3.5) */
    interviewerId: null as InterviewerId | null,
    /** 들고 있는 녹음 조각 수. 화면·테스트가 보는 값 */
    recordingCount: 0,
    /** 지금 녹음 중인가. 화면이 "몰래 녹음하지 않는다"를 보여 주는 근거 */
    recordingOn: false,
    /** 상한에 걸렸을 때만 채운다 — 녹음이 없는 것과 못 하는 것은 다르다 */
    recordingWarning: null as string | null,
    /** 보관함에 남았나. 비로그인·저장 실패는 둘 다 false — 화면이 각각 다르게 말한다 */
    archiveSaved: false,
    /** 한도에 밀려 사라진 기록의 id. 말해 주지 않으면 사용자는 없어진 걸 모른다 */
    archiveEvicted: [] as string[],
  }),
  getters: {
    profileDone: (s) => s.profile.field !== null && s.profile.job.trim().length > 0,
    /** 고른 면접관이 정한다 — 스토어에 따로 들고 있지 않는다.
     *  선택이 없으면 기본 면접관으로 떨어진다. 칩·프롬프트가 이미 그렇게 하고 있어
     *  여기서만 null을 내면 "면접관은 데이빗인데 트랙은 없음"이 된다 */
    track(): Track | null {
      return trackOf(useInterviewerStore().id ?? DEFAULT_INTERVIEWER, this.chosenTrack)
    },
    resumeDone: (s) => s.resumeText.length >= RESUME_MIN,
    canStart(): boolean {
      return canStartWith({
        track: this.track,
        modelReady: useModelStore().ready,
        resumeDone: this.resumeDone,
        ...this.profile,
      })
    },
    startBlockReason(): string | null {
      if (this.canStart) return null
      const m = useModelStore()
      // 실패는 대기와 다르게 말한다(#41): 사용자가 위 진행 창의 '다시 시도'를 못 보고 "다 채웠는데 안 열린다"고 느끼기 쉽다
      if (m.status === 'error') return '면접관을 준비하지 못했습니다 — 위 진행 창에서 다시 시도'
      if (m.status !== 'ready') return '면접관이 자리에 앉으면 열립니다'
      // 목소리는 더 이상 시작을 막지 않는다 — 자막으로 가다가 준비되면 합류한다(`docs/download-time.md`)
      return '위 항목을 채우면 열립니다'
    },
    overLimit: (s) => s.tokenCount > TOKEN_LIMIT,
    /** 면접관 차례(생성·합성 대기·재생). 이 동안 지원자 입력과 답변 타이머는 멈춘다 */
    interviewerTurn: (s) => s.generating || s.speaking || s.stage === 'thinking',
    /** 진행 중·끝난 면접의 면접관. 시작 전이면 기본 면접관 */
    sessionInterviewer: (s): Interviewer =>
      interviewerById(s.interviewerId) ?? interviewerById(DEFAULT_INTERVIEWER)!,
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
    /** 벤 회사 브리핑용. 서버가 1~100자를 받으므로 여기서 자른다 */
    setCompanyName(name: string) {
      this.profile.companyName = name.slice(0, 100)
    },
    /** 목소리 분석 동의. 면접마다 다시 묻는다(기본 꺼짐) */
    setVoiceConsent(on: boolean) {
      this.voiceConsent = on
    },
    /** 모집공고 링크. 적힌 그대로 둔다 — 형식 검사와 인코딩은 보낼 때 한 번만 한다 */
    setPostingUrl(url: string) {
      this.profile.postingUrl = url.slice(0, 500)
      // 고쳐 넣는 중에 옛 안내가 남아 있으면 무엇을 고쳐야 하는지 알 수 없다
      this.postingError = null
    },
    /** 벤에서 고른 트랙. 다른 면접관으로 바꾸면 비운다 */
    setTrack(t: Track | null) {
      this.chosenTrack = t
    },
    /** 대입 입력 네 칸 */
    setAdmission(
      v: Partial<Pick<typeof this.profile, 'name' | 'age' | 'university' | 'department'>>,
    ) {
      Object.assign(this.profile, v)
    },
    setResume(name: string, rawText: string) {
      this.resumeName = name
      this.resumeText = truncateResume(rawText)
    },

    async start() {
      // canStart가 트랙별로 필요한 칸을 이미 다 본다. 여기서 회사 전용 칸(field)을
      // 또 보면 대입은 버튼만 켜지고 열리지 않는다
      if (
        !this.canStart ||
        starting ||
        this.generating ||
        this.speaking ||
        this.phase === 'interview'
      )
        return
      starting = true
      try {
        const model = useModelStore()
        const ivStore = useInterviewerStore()
        ivStore.stopPreview() // 미리 듣기가 면접관 목소리와 겹치지 않게
        const chosen = ivStore.current ?? interviewerById(DEFAULT_INTERVIEWER)!
        this.interviewerId = chosen.id
        const common = {
          resumeText: this.resumeText,
          fallbackQuestions: this.fallbackQuestions,
          override: model.manifest?.systemPromptOverride,
          persona: PERSONAS[this.sessionInterviewer.persona],
        }
        const p = this.profile
        const prompt =
          this.track === 'admission'
            ? buildSystemPrompt({
                ...common,
                track: 'admission',
                admission: {
                  name: p.name,
                  age: p.age ?? 0,
                  university: p.university,
                  department: p.department,
                },
              })
            : buildSystemPrompt({
                ...common,
                fieldLabel: FIELD_LABELS[p.field as Field],
                job: p.job,
              })
        if (session) await session.dispose().catch(() => undefined)
        systemPrompt = prompt
        benId = null
        if (chosen.premium) {
          // 벤은 서버가 Claude를 부른다. 티켓은 여기서 빠진다 — 실패하면 면접을 열지 않는다
          const account = useAccountStore()
          try {
            const started = await startInterview(this.benRequest())
            benId = started.interviewId
            // 옛 배포는 이 칸이 없다 — 없으면 올리지 않는다
            this.voiceAnalysis = started.voiceAnalysis ?? 'off'
            account.session = started.session
          } catch (e) {
            // 서버가 짚어 준 칸이 있으면 그 칸 옆에 붙인다 — 어디를 고쳐야 하는지 알 수 있게
            if (e instanceof BenError && e.field === 'postingUrl')
              this.postingError = '이 주소로는 공고를 열 수 없습니다 — 다시 확인해 주세요'
            this.genError = e instanceof Error ? e.message : String(e)
            return
          }
          session = null
        } else {
          session = await startSession(prompt)
        }
        this.messages = []
        this.ended = false
        this.genError = null
        this.report = null
        this.reportV2 = null
        this.reportRaw = ''
        this.reportStatus = 'idle'
        this.startedAt = Date.now()
        this.endedAt = null
        this.phase = 'interview'
        // 녹음은 프리미엄 면접에서만. 거절해도 null이 올 뿐 면접은 그대로 간다
        recorder = chosen.premium ? await startRecording() : null
        this.recordingOn = recorder !== null
        // 지난 면접의 조각을 물려받지 않는다 — 남의 기록에 올라간다
        clips = []
        measuring = []
        this.recordingCount = 0
        this.recordingWarning = null
        recordedBytes = 0
        await this.generate(KICKOFF)
      } finally {
        starting = false
      }
    },

    async send(text: string) {
      const t = text.trim()
      if (!t || this.interviewerTurn || this.ended) return
      this.messages.push({ role: 'user', text: t, at: Date.now() })
      // 녹음이 없으면 await를 끼우지 않는다 — generate 시작이 한 틱 밀리면
      // 진행 중 생성과 finish의 중단 순서가 어긋난다
      if (recorder) await this.keepClip()
      this.reactPending = isGoodAnswer(t)
      await this.generate(t)
    },

    /** 내부: user 턴을 보내고 응답을 스트리밍해 messages에 확정한다 */
    async generate(userText: string) {
      if (!session && !benId) return
      lastSent = userText
      const run = async () => {
        if (!session && !benId) return
        this.generating = true
        this.genError = null
        this.ttsWarning = null
        this.streaming = ''
        this.revealed = '' // 생성 중 말풍선은 "…" — 확정 텍스트를 음성과 함께 드러낸다
        this.stage = 'thinking'
        abortCtl = new AbortController()
        const filter = new ThoughtFilter()
        let text = ''
        let aborted = false // 중단된 생성의 부분 텍스트는 읽지 않는다(spec 4절: 기존대로 텍스트만)
        let serverEnded = false
        try {
          const onDelta = (delta: string) => {
            const shown = filter.push(delta)
            if (shown) this.streaming += shown
          }
          if (benId) {
            // 첫 턴은 답변 없이 — 서버가 첫 질문을 만든다
            const r = await turnStream(
              benId,
              userText === KICKOFF ? undefined : userText,
              onDelta,
              abortCtl.signal,
              (s) => {
                // 조사는 20~40초 걸린다 — 그동안 가만히 두면 멈춘 것처럼 보인다
                if (s.phase === 'researching') this.briefing = 'researching'
                else if (s.phase === 'briefing') this.briefing = s.ok === false ? 'failed' : null
              },
            )
            serverEnded = r.ended
          } else if (session) {
            await session.send(userText, onDelta, abortCtl.signal)
          }
          aborted = abortCtl.signal.aborted
          this.streaming += filter.flush()
          // 태그 쌍이 통째로 버퍼링되어 필터를 통과했을 수 있는 잔여 thought를 최종 텍스트에서 제거
          this.streaming = stripThoughts(this.streaming)
          // 공백만 남은 턴(thought만 오고 끝난 경우 등)은 기록하지 않는다 — 빈 말풍선 방지
          text = this.streaming.trim()
          if (text) this.messages.push({ role: 'model', text: this.streaming, at: Date.now() })
          // 벤은 서버가 끝을 안다. 무료 면접관만 종료 문장을 찾는다
          if (serverEnded || hasEndPhrase(text)) {
            this.ended = true
            if (this.endedAt === null) this.endedAt = Date.now()
          }
        } catch (e) {
          this.genError = e instanceof Error ? e.message : String(e)
        } finally {
          this.generating = false
          abortCtl = null
        }
        if (text && !aborted) {
          // playClip이 던져도(AudioContext 생성 실패 등) 면접이 thinking에 갇히지 않게 — 텍스트만 보이고 계속
          try {
            await this.speak(this.streaming)
          } catch {
            this.revealed = this.streaming
            this.ttsWarning = TTS_WARNING
          }
          // 답변 타이머 기준은 면접관 말이 끝난 시각 — 합성 실패·타임아웃으로 바로 보인 경우도 지금부터
          const last = this.messages.at(-1)
          if (last?.role === 'model') last.at = Date.now()
        } else if (text) this.revealed = this.streaming
        else
          this.revealed = [...this.messages].reverse().find((m) => m.role === 'model')?.text ?? ''
        this.stage = 'waiting'
        // 면접관이 말한 구간은 녹음에서 버린다 — 다음 조각이 지원자 답변만 담게
        if (recorder) await recorder.cut()
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
        new Promise<void>((r) => (graceTimer = setTimeout(r, clip.durationMs + PLAY_GRACE_MS))),
      ])
      this.stopSpeaking()
    },

    /** 내부: 재생·타이핑을 멈추고 텍스트를 전부 보인다. 재생이 끝난 시각을 마지막 질문의 at으로 (답변 타이머 기준) */
    stopSpeaking() {
      if (revealTimer) clearInterval(revealTimer)
      revealTimer = null
      if (graceTimer) clearTimeout(graceTimer)
      graceTimer = null
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
      if ((!session && !benId) || this.reportStatus === 'writing') return
      // 가드를 await 이전에 동기로 선점 — finish()가 겹쳐 불려도 리포트 요청은 한 번만 나간다
      this.reportStatus = 'writing'
      if (this.endedAt === null) this.endedAt = Date.now()
      this.phase = 'report'
      this.reportRaw = ''
      // 진행 중이던 generate의 정리를 기다린다(inflight가 없으면 즉시 통과) —
      // abort()가 항상 inflight를 기다리므로 generate()의 꼬리(refreshTokens 등)와
      // 리포트 send가 겹치지 않는다
      await this.abort()
      // 마지막 조각(면접관 인사말)은 버리고 마이크를 놓는다. 저장 전에 놓아야 hasRecording이 맞다
      await this.releaseMic()
      // 프롬프트 override(파인튜닝 모델)가 있으면 페르소나 미적용 — 리포트 말투도 뺀다(spec 5.1·7절)
      const override = useModelStore().manifest?.systemPromptOverride
      try {
        if (benId) {
          // 서버가 쓴다. 이미 받은 면접에 다시 불러도 보관한 원문을 그대로 준다
          // 걸어 둔 측정을 여기서 거둔다. 못 잰 답변은 빠진다(`docs/API.md`: 빼고 보낸다)
          const delivery = (await Promise.all(measuring)).filter((m) => m !== null)
          await reportStream(benId, (d) => (this.reportRaw += d), undefined, delivery, {
            // 서버가 다시 쓴다 — 쓰다 만 원문을 남겨 두면 로딩 글자가 뒤죽박죽이 된다
            onReset: () => {
              this.reportRaw = ''
              this.reportV2 = null
            },
            onReport: (r) => (this.reportV2 = r),
          })
        } else if (session) {
          this.reportRaw = await session.send(
            buildReportInstruction(override ? null : PERSONAS[this.sessionInterviewer.persona]),
            (d) => (this.reportRaw += d),
          )
        }
        // 버전 2가 왔으면 그것으로 그린다. 안 왔으면(플래그 꺼짐·로컬 면접관) 예전 파서로
        if (!this.reportV2) this.report = parseReport(this.reportRaw)
        this.reportStatus = 'done'
      } catch (e) {
        this.genError = e instanceof Error ? e.message : String(e)
        this.reportStatus = 'error'
      }
      // 보관·녹음은 리포트 **뒤의** 일이다. 여기서 실패해도 다 나온 리포트를 되돌리지 않는다
      if (this.reportStatus === 'done') await this.archiveNow()
    },

    /** 방금 답변 구간을 끊어 보관한다. 상한을 넘으면 마이크를 놓고 알린다 */
    async keepClip() {
      const clip = await recorder?.cut()
      if (!clip) return
      const { blob, durationSec } = clip
      recordedBytes += blob.size
      if (recordedBytes > RECORDING_MAX_BYTES) {
        this.recordingWarning = RECORDING_FULL
        await this.releaseMic()
      }
      // 지원자 답변 순번 — 조각이 비어 건너뛰어도 순번이 어긋나지 않게 메시지에서 센다
      const turn = this.messages.filter((m) => m.role === 'user').length - 1
      clips.push({ turn, blob, durationSec })
      this.recordingCount = clips.length
      // 전달력은 벤만 받는다. 기다리지 않는다 — 여기서 await하면 면접관 응답이 그만큼 늦는다
      if (benId) {
        const text = this.messages.at(-1)?.text ?? ''
        const id = benId
        const answer = turn + 1
        // 기다리지 않는다 — 분석이 안 되는 것과 면접이 끊기는 것은 무게가 다르다
        const onWav =
          this.voiceAnalysis === 'on'
            ? (wav: ArrayBuffer) => void uploadVoice(id, answer, wav)
            : undefined
        measuring.push(measureClip(blob, answer, text, onWav))
      }
    },

    async releaseMic() {
      const r = recorder
      recorder = null
      this.recordingOn = false
      await r?.stop()
    },

    /** 리포트가 **다 나온 뒤** 한 번만. 중간에 저장하면 반쪽짜리가 남는다.
     *  비로그인은 저장하지 않는다 — 기기에만 남기는 것이 이 서비스의 약속이다 */
    async archiveNow() {
      if (this.archiveSaved) return
      const account = useAccountStore()
      if (!account.signedIn) return
      const r = await account.saveArchive(this.archiveDraft())
      this.archiveSaved = r !== null
      this.archiveEvicted = r?.evicted ?? []
      if (r) await this.uploadClips(r.entry.id)
    },

    /** 들고 있던 녹음을 올린다. **기록을 만든 뒤**라야 서버가 받는다(기록 id가 필요하다).
     *  실패해도 리포트는 그대로 둔다 — 녹음은 덤이지 결과가 아니다 */
    async uploadClips(archiveId: string) {
      if (!clips.length) return
      const account = useAccountStore()
      let failed = 0
      for (const c of clips) {
        // 스토어가 오류를 담아 null을 준다 — 하나가 실패해도 나머지는 올린다
        try {
          if ((await account.uploadRecording(archiveId, c.turn, c.blob, c.durationSec)) === null)
            failed++
        } catch {
          failed++
        }
      }
      if (failed) this.recordingWarning = `녹음 ${failed}개를 올리지 못했습니다`
    },

    /** 서버에 넘길 면접 조건. 트랙이 보는 묶음 하나만 담는다 */
    benRequest(): StartRequest {
      const p = this.profile
      if (this.track === 'admission')
        return {
          ...(this.voiceConsent ? { voiceAnalysisConsent: true as const } : {}),
          track: 'admission',
          resumeText: this.resumeText,
          admission: {
            name: p.name,
            age: p.age ?? 0,
            university: p.university,
            department: p.department,
          },
        }
      const consent = this.voiceConsent ? { voiceAnalysisConsent: true as const } : {}
      const name = p.companyName.trim()
      // 형식이 틀리면 싣지 않는다 — 422를 받고 나면 티켓이 이미 빠진 뒤다
      const posting = normalizePostingUrl(p.postingUrl)
      const postingUrl = posting.ok ? posting.url : null
      return {
        ...consent,
        track: 'company',
        resumeText: this.resumeText,
        // 비었으면 아예 보내지 않는다 — 서버가 "없는 것"으로 친다
        company: {
          field: p.field ?? '',
          job: p.job,
          ...(name ? { name } : {}),
          ...(postingUrl ? { postingUrl } : {}),
        },
      }
    },

    /** 스토어가 이미 가진 값으로 보관할 한 건을 만든다. 트랙이 보는 칸만 담는다 */
    archiveDraft(): ArchiveDraft {
      const iv = this.sessionInterviewer
      const track = this.track ?? 'company'
      const p = this.profile
      return {
        interviewerId: iv.id,
        premium: iv.premium,
        track,
        startedAt: new Date(this.startedAt ?? Date.now()).toISOString(),
        endedAt: new Date(this.endedAt ?? Date.now()).toISOString(),
        questionCount: this.reportV2?.items.length ?? this.report?.length ?? 0,
        hasRecording: clips.length > 0,
        ...(track === 'company'
          ? { field: p.field ?? undefined, job: p.job }
          : {
              name: p.name,
              age: p.age ?? undefined,
              university: p.university,
              department: p.department,
            }),
        messages: this.messages.map((m) => ({ role: m.role, text: m.text, at: m.at })),
        report: this.report ?? [],
        reportRaw: this.reportRaw,
        // 버전 2는 받은 그대로 보관한다 — 보관함 상세가 같은 화면을 다시 그린다
        ...(this.reportV2 ? { reportV2: this.reportV2 } : {}),
        // 녹음은 기록을 만든 뒤에 따로 올린다 — 서버가 이 칸을 무시한다
        recordings: [],
        // 프리미엄 기록은 어느 벤 면접인지 서버에 증명해야 한다
        ...(benId ? { premiumInterviewId: benId } : {}),
      }
    },

    async reset() {
      await this.abort() // 재생·생성을 멈추고 generate의 꼬리까지 끝낸 뒤 비운다 — 안 그러면 꼬리가 stage를 waiting으로 되돌린다
      if (session) await session.dispose().catch(() => undefined)
      session = null
      benId = null
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
      this.reportV2 = null
      this.reportRaw = ''
      this.reportStatus = 'idle'
      this.profile = {
        field: null,
        job: '',
        companyName: '',
        postingUrl: '',
        name: '',
        age: null,
        university: '',
        department: '',
      }
      this.postingError = null
      this.briefing = null
      this.chosenTrack = null
      this.resumeText = ''
      this.resumeName = null
      this.fallbackQuestions = []
      this.startedAt = null
      this.endedAt = null
      this.interviewerId = null
      this.archiveSaved = false
      this.archiveEvicted = []
      await this.releaseMic()
      recordedBytes = 0
      clips = []
      measuring = []
      this.recordingCount = 0
      this.recordingWarning = null
      this.phase = 'prepare'
    },
  },
})
