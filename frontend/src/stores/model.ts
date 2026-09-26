import { defineStore } from 'pinia'
import { getManifest } from '@/services/api'
import {
  cacheKey,
  clearModels,
  downloadModel,
  getModelBlob,
  hasModel,
  pruneModels,
} from '@/services/modelCache'
import { disposeEngine, initEngine } from '@/services/llm'
import { disposeTts, initTts, setTtsVoice, synthesize } from '@/services/tts'
import type { Manifest, ModelRef, TtsManifest } from '@/types/api'
import { overallFraction } from '@/utils/progressStages'
import { pickVoice, resolveTts, voiceFiles } from '@/utils/ttsVoices'
import { DEFAULT_INTERVIEWER, INTERVIEWERS, type InterviewerId } from '@/interviewers'
import { useInterviewerStore } from './interviewer'

export const MAX_NUM_TOKENS = 8192

export type ModelStatus =
  'idle' | 'loading-manifest' | 'downloading' | 'downloaded' | 'initializing' | 'ready' | 'error'

export type TtsStatus = 'idle' | 'downloading' | 'initializing' | 'ready' | 'error'
/** 준비 단계에서 한 번 미리 합성해 두는 문장 — 첫 질문의 합성이 워밍업 비용을 물지 않게 (spec 6절) */
export const TTS_WARMUP_TEXT = '안녕하세요.'
export const TTS_WARMUP_TIMEOUT_MS = 15_000
/** 엔진·TTS 워커 초기화 상한(#41). GPU가 멈추면 영원히 initializing에 갇히므로 넘기면 error로 보내 다시 시도·폴백·목소리 없이 시작이 열리게 */
export const INIT_TIMEOUT_MS = 90_000
/** Gemma는 됐는데 목소리가 이만큼 넘게 준비 중이면 준비 화면이 "목소리 없이 시작"을 내민다 */
export const TTS_STUCK_MS = 60_000
/** 면접관 목소리 교체(목소리 파일 다운로드 + 워커 교체) 상한. 멈추면 voiceSwitching에 갇혀 시작할 길이 없다 */
export const VOICE_SWITCH_TIMEOUT_MS = 30_000

let armLoadTimeout: (() => void) | null = null // loadTts의 워커 로드 타이머를 다운로드 완료 시점에 켜는 훅

/** p가 ms 안에 끝나지 않으면 message로 거부한다. 거부 직전에 onTimeout을 부른다 */
function withDeadline<T>(
  p: Promise<T>,
  ms: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  let t: ReturnType<typeof setTimeout>
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      t = setTimeout(() => {
        onTimeout?.()
        reject(new Error(message))
      }, ms)
    }),
  ]).finally(() => clearTimeout(t))
}

/** p가 ms 안에 끝나지 않으면 label 초기화 시간 초과로 거부한다 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return withDeadline(p, ms, `${label} 초기화가 ${Math.round(ms / 1000)}초 안에 끝나지 않았습니다`)
}

/** spec 7절: tts.voices가 없거나 면접관 목소리가 목록에 없으면 기본 목소리로 합성한다(페르소나는 그대로) — 빠진 것을 한 번에 알린다 */
function warnMissingVoices(t: TtsManifest | null | undefined): void {
  if (!t) return
  if (!t.voices?.length) {
    console.warn(`tts.voices가 없어 모든 면접관을 기본 목소리 ${t.voice}로 합성합니다`)
    return
  }
  const missing = [...new Set(INTERVIEWERS.map((iv) => iv.voiceId))].filter(
    (id) => !t.voices!.some((v) => v.id === id),
  )
  if (missing.length)
    console.warn(
      `tts.voices에 면접관 목소리 ${missing.join(', ')}가 없어 기본 목소리 ${t.voice}로 합성합니다`,
    )
}

/** 현재 매니페스트가 가리키는 파일들의 캐시 키(모델·폴백·TTS 파일·목소리 전부). 한 번 받은 목소리는 남긴다 */
function currentCacheKeys(m: Manifest): string[] {
  const keys = [cacheKey(m.id, m.url)]
  if (m.fallback) keys.push(cacheKey(m.fallback.id, m.fallback.url))
  if (m.tts)
    for (const f of [...m.tts.files, ...voiceFiles(m.tts)])
      keys.push(cacheKey(m.tts.id, m.tts.baseUrl + f.path))
  return [...new Set(keys)]
}

/** 진행률을 스토어에 반영하는 최소 간격(ms). 네트워크 청크마다(초당 수백~수천 번) 재렌더하면 준비 장면이 끊긴다 */
export const PROGRESS_TICK_MS = 100
/** onProgress를 간격으로 묶는다. 마지막 값(done)은 항상 통과시켜야 하므로 호출 쪽이 total을 알려준다 */
function throttled(total: number, set: (r: number) => void): (r: number) => void {
  let last = 0
  return (r) => {
    const now = Date.now()
    if (r >= total || now - last >= PROGRESS_TICK_MS) {
      last = now
      set(r)
    }
  }
}

/** 목소리(TTS) 다운로드 선택(#36). 기본 켬. 기존 momo.muted와 같은 방식으로 기억한다 */
const VOICE_KEY = 'momo.voice'
function loadVoiceWanted(): boolean {
  try {
    return localStorage.getItem(VOICE_KEY) !== '0'
  } catch {
    return true
  }
}

export const useModelStore = defineStore('model', {
  state: () => ({
    status: 'idle' as ModelStatus,
    manifest: null as Manifest | null,
    active: null as ModelRef | null,
    received: 0,
    total: 0,
    error: null as string | null,
    manifestError: null as string | null,
    initFailed: false,
    ttsStatus: 'idle' as TtsStatus,
    ttsReceived: 0,
    ttsTotal: 0,
    ttsError: null as string | null,
    voiceWanted: loadVoiceWanted(),
    /** 재방문 판정(#33): 선택한 파일(모델 + 목소리)이 전부 캐시에 있는지. null = 아직 조회 전 */
    cached: null as boolean | null,
    /** 모델 파일만 따로: download()가 캐시 조회를 기다리는 동안 준비 화면이 0%로 시작하지 않게 미리 채우는 데 쓴다 */
    modelCached: null as boolean | null,
    /** 고른 목소리 파일이 캐시에 있는지 — 재방문 판정(cached)과 별개. 진행률 미리 채우기에만 쓴다 */
    voiceCached: null as boolean | null,
    /** 워커가 지금 쓰는 목소리 id */
    loadedVoice: null as string | null,
    /** 그 목소리를 고른 면접관 — 교체 실패 때 선택을 이 면접관으로 되돌린다 */
    loadedInterviewerId: null as InterviewerId | null,
    /** 면접관을 바꿔 목소리를 교체하는 중 — 이 동안은 면접을 시작하지 않는다 */
    voiceSwitching: false,
    voiceError: null as string | null,
  }),
  getters: {
    progress: (s) => (s.total ? Math.min(100, Math.round((s.received / s.total) * 100)) : 0),
    /** 매니페스트에 TTS가 있고 사용자가 목소리를 선택했을 때만. 해제하면 텍스트 전용 경로(tts null)와 같다 */
    ttsEnabled: (s) => !!s.manifest?.tts && s.voiceWanted,
    /** 고른 면접관의 목소리 id. 선택이 없으면 null → 매니페스트 기본 목소리 */
    wantedVoiceId(): string | null {
      return useInterviewerStore().current?.voiceId ?? null
    },
    /** 받을 TTS 설정(엔진 + 고른 목소리). 목소리 체크(voiceWanted)와 무관 — 동의 창 행 표시에도 쓴다 */
    ttsSelection(): TtsManifest | null {
      const t = this.manifest?.tts
      return t ? resolveTts(t, this.wantedVoiceId) : null
    },
    ttsSelectionSize(): number {
      return this.ttsSelection?.files.reduce((n, f) => n + f.size, 0) ?? 0
    },
    /** 고른 목소리 파일 크기. voices가 없으면 0(목소리 파일이 엔진 목록에 들어 있다) */
    ttsVoiceSize(): number {
      const t = this.manifest?.tts
      return t ? (pickVoice(t, this.wantedVoiceId)?.size ?? 0) : 0
    },
    /** 받을 TTS 합계(바이트). 목소리 해제면 0 — 동의 창·전체 진행률용 */
    ttsSize(): number {
      return this.ttsEnabled ? this.ttsSelectionSize : 0
    },
    /** 동의·저장 공간 판정 기준: 현재 모델 + TTS */
    downloadSize(): number {
      return (this.active?.size ?? 0) + this.ttsSize
    },
    /* 준비 화면 진행 바·장면 기준(#26): 모델 + TTS 합산 바이트. 목소리 단계에서 0으로 되돌아가지 않는다 */
    overallTotal(): number {
      return this.downloadSize
    },
    overallReceived(): number {
      return Math.min(this.received, this.total) + Math.min(this.ttsReceived, this.ttsSize)
    },
    /** 0~100, 반올림하지 않은 값 — 장면은 소수 진행률로 부드럽게, 표시는 쓰는 쪽에서 반올림 */
    overallProgress(): number {
      return (
        overallFraction({
          modelSize: this.total,
          modelReceived: this.received,
          ttsSize: this.ttsSize,
          ttsReceived: this.ttsReceived,
        }) * 100
      )
    },
    ttsProgress: (s) =>
      s.ttsTotal ? Math.min(100, Math.round((s.ttsReceived / s.ttsTotal) * 100)) : 0,
    /** 면접을 시작할 수 있는 상태: Gemma ready + (TTS가 있으면) TTS ready + 목소리 교체 중이 아님.
     *  목소리를 해제하면 교체 중이어도 열린다 — "목소리 없이 시작"이 교체에 막히지 않게 */
    ready(): boolean {
      return (
        this.status === 'ready' &&
        (!this.ttsEnabled || (this.ttsStatus === 'ready' && !this.voiceSwitching))
      )
    },
  },
  actions: {
    async loadManifest() {
      this.status = 'loading-manifest'
      this.manifestError = null
      try {
        this.manifest = await getManifest()
        warnMissingVoices(this.manifest.tts)
        this.setActive(this.manifest)
        // 주소·id가 바뀐 옛 모델 항목 정리 — 실패해도 매니페스트 로드는 성공으로 둔다
        await pruneModels(currentCacheKeys(this.manifest)).catch(() => undefined)
        await this.checkCached()
        // 이 기능 배포 전에 모델을 받아 둔 사용자: 선택 저장값이 없으면 기본 면접관(M2 — 이미 캐시에 있다) (spec 3.3)
        const iv = useInterviewerStore()
        if (this.cached && !iv.id) {
          iv.select(DEFAULT_INTERVIEWER)
          await this.checkVoiceCached()
        }
      } catch (e) {
        this.manifestError = e instanceof Error ? e.message : String(e)
      } finally {
        this.status = 'idle'
      }
    },
    setActive(ref: ModelRef) {
      this.active = { id: ref.id, url: ref.url, size: ref.size }
      this.total = ref.size
      this.received = 0
      this.modelCached = null // 다른 모델 — 캐시 여부는 다시 봐야 안다
      this.cached = null
    },
    async download() {
      if (!this.active) {
        this.status = 'error'
        this.error = 'manifest not loaded'
        return
      }
      const { id, url, size } = this.active
      this.error = null
      this.initFailed = false
      // 캐시 조회 동안에도 준비 화면이 look_up(초기화) 장면을 보이도록 먼저 initializing으로 둔다.
      // 캐시 미스면 downloading으로 내려간다 (spec 4.2: 캐시 히트면 downloading을 건너뛴다)
      this.status = 'initializing'
      // 매니페스트 때 캐시를 이미 확인했다면 조회를 기다리지 않고 채워 둔다 — 준비 장면이 0%에서 다시 걸어오지 않게
      if (this.modelCached) this.received = size
      // TTS는 실제로 캐시에 있는 만큼만 미리 채운다 — 고른 목소리가 없으면 그 몫은 실제 수신으로(spec 4.3)
      if (this.cached)
        this.ttsReceived = this.ttsEnabled
          ? this.ttsSize - (this.voiceCached ? 0 : this.ttsVoiceSize)
          : 0
      try {
        if (await hasModel(id, url)) {
          this.received = size
        } else {
          this.status = 'downloading'
          this.received = 0
          await downloadModel(
            id,
            url,
            size,
            throttled(size, (r) => (this.received = r)),
            undefined,
          )
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
        await withTimeout(
          initEngine(blob, { maxNumTokens: MAX_NUM_TOKENS }),
          INIT_TIMEOUT_MS,
          '면접관',
        )
        this.status = 'ready'
        await this.loadTts()
      } catch (e) {
        this.status = 'error'
        this.initFailed = true
        this.error = e instanceof Error ? e.message : String(e)
      }
    },
    /** Gemma ready 뒤 TTS 파일을 받아 워커를 올리고 워밍업 한 문장을 돌린다. manifest.tts가 없으면 텍스트 전용으로 바로 ready */
    async loadTts() {
      const cfg = this.ttsEnabled ? this.ttsSelection : null
      // 로딩 중에 선택이 바뀔 수 있으니 cfg와 같은 순간의 선택을 잡아 둔다(선택이 없으면 기본 목소리 = 기본 면접관)
      const cfgInterviewer = useInterviewerStore().id ?? DEFAULT_INTERVIEWER
      if (!cfg) {
        this.ttsStatus = 'ready'
        return
      }
      // ready: 경량 모델 전환 등으로 Gemma만 다시 올릴 때 TTS는 그대로 둔다.
      // downloading/initializing: 다시 시도 연타 — 겹쳐 부르면 앞선 initTts가 superseded로 거부되며 error를 잠깐 덮어쓴다
      if (
        this.ttsStatus === 'ready' ||
        this.ttsStatus === 'downloading' ||
        this.ttsStatus === 'initializing'
      )
        return
      this.ttsStatus = 'initializing' // 캐시 조회 중에도 진행 창이 look_up을 유지하도록
      this.ttsError = null
      this.ttsTotal = cfg.files.reduce((n, f) => n + f.size, 0)
      if (!this.cached) this.ttsReceived = 0 // 전부 캐시면 download()가 미리 채운 값을 유지한다
      try {
        // 미리 채운 값에서 뒤로 가지 않는다(캐시 히트 파일도 initTts가 0부터 누적 보고한다)
        const tick = throttled(
          this.ttsTotal,
          (r) => (this.ttsReceived = Math.max(this.ttsReceived, r)),
        )
        // 상한은 워커 로드 구간에만 건다 — 다운로드는 진행률로 살아 있음을 알 수 있고 크기가 커서 시간을 정할 수 없다.
        // 다운로드가 끝난 시점부터 INIT_TIMEOUT_MS 안에 loaded가 안 오면 워커를 버리고 error로
        let loadTimer: ReturnType<typeof setTimeout> | null = null
        const loadTimeout = new Promise<never>((_, reject) => {
          const arm = () => {
            if (loadTimer) return
            loadTimer = setTimeout(
              () =>
                reject(
                  new Error(
                    `목소리 초기화가 ${Math.round(INIT_TIMEOUT_MS / 1000)}초 안에 끝나지 않았습니다`,
                  ),
                ),
              INIT_TIMEOUT_MS,
            )
          }
          armLoadTimeout = arm
        })
        try {
          await Promise.race([
            initTts(cfg, (r, t) => {
              tick(r)
              this.ttsTotal = t
              this.ttsStatus = r < t ? 'downloading' : 'initializing'
              if (r >= t) armLoadTimeout?.()
            }),
            loadTimeout,
          ])
        } finally {
          if (loadTimer) clearTimeout(loadTimer)
          armLoadTimeout = null
        }
        // 워밍업 실패·지연은 무시 — 실제 턴에서 다시 시도된다. 상한을 두어 첫 WebGPU 실행이 멈춰도 준비 화면이 갇히지 않게
        const warm = new AbortController()
        const t = setTimeout(() => warm.abort(), TTS_WARMUP_TIMEOUT_MS)
        await synthesize(TTS_WARMUP_TEXT, warm.signal)
          .catch(() => undefined)
          .finally(() => clearTimeout(t))
        this.loadedVoice = cfg.voice
        this.loadedInterviewerId = cfgInterviewer
        this.ttsStatus = 'ready'
        await this.syncVoice() // 로딩 중에 면접관이 바뀌었으면 새 목소리로 맞춘다
      } catch (e) {
        disposeTts() // 시간 초과로 버린 워커가 세션(약 400MB)을 붙들고 있지 않게
        this.ttsStatus = 'error'
        this.ttsError = e instanceof Error ? e.message : String(e)
      }
    },
    /** 재방문 판정: 모델 + TTS 엔진(목소리 해제면 모델만). 고른 목소리 파일은 따로 voiceCached로 본다 */
    async checkCached() {
      const m = this.manifest
      if (!m || !this.active) {
        this.cached = false
        this.modelCached = false
        this.voiceCached = false
        return
      }
      const sel = this.ttsEnabled ? this.ttsSelection : null
      const voicePath = m.tts ? pickVoice(m.tts, this.wantedVoiceId)?.path : undefined
      const wanted: [string, string][] = [[this.active.id, this.active.url]]
      if (sel)
        for (const f of sel.files)
          if (f.path !== voicePath) wanted.push([sel.id, sel.baseUrl + f.path])
      try {
        const hits = await Promise.all(wanted.map(([id, url]) => hasModel(id, url)))
        this.modelCached = hits[0]
        this.cached = hits.every(Boolean)
      } catch {
        this.modelCached = false
        this.cached = false
      }
      await this.checkVoiceCached()
    },
    /** 고른 목소리 파일이 캐시에 있는지. voices가 없으면(엔진에 포함) true */
    async checkVoiceCached() {
      const t = this.manifest?.tts
      const v = t ? pickVoice(t, this.wantedVoiceId) : null
      if (!t || !v) {
        this.voiceCached = true
        return
      }
      try {
        this.voiceCached = await hasModel(t.id, t.baseUrl + v.path)
      } catch {
        this.voiceCached = false
      }
    },
    /** 준비된 워커의 목소리를 고른 면접관 목소리로 맞춘다. 실패하면 false(이전 목소리 유지 + 선택도 되돌림) */
    async syncVoice(): Promise<boolean> {
      const sel = this.ttsEnabled ? this.ttsSelection : null
      if (
        !sel ||
        this.ttsStatus !== 'ready' ||
        this.voiceSwitching ||
        // ttsStatus가 ready인데 로드된 목소리가 없으면 워커가 없는 상태(텍스트 전용으로 준비됨 등) — 바꿀 대상이 없다
        this.loadedVoice === null
      )
        return true
      const selInterviewer = useInterviewerStore().id ?? DEFAULT_INTERVIEWER
      if (sel.voice === this.loadedVoice) {
        // 목소리는 그대로라 워커를 건드릴 필요는 없지만, 같은 목소리를 공유하는 면접관으로 바뀐 것도
        // "로드됨"으로 기억해 둔다(spec 7절 저하 경우) — 안 그러면 다음 교체 실패가 이 면접관이 아니라 이전 면접관으로 되돌아간다
        this.loadedInterviewerId = selInterviewer
        return true
      }
      const file = sel.files[sel.files.length - 1] // resolveTts가 목소리 파일을 맨 뒤에 둔다
      const url = sel.baseUrl + file.path
      this.voiceSwitching = true
      this.voiceError = null
      let failed = false
      // 다운로드 + 워커 교체 전체에 상한 — 넘기면 다운로드는 중단하고, 어느 단계에서 멈췄는지(stage)로 뒷정리를 가른다
      const ac = new AbortController()
      let stage = 'download' as 'download' | 'voice' // 아래 async 안에서 바뀐다 — 좁혀지지 않게 단언
      let timedOut = false
      try {
        await withDeadline(
          (async () => {
            if (!(await hasModel(sel.id, url)))
              await downloadModel(sel.id, url, file.size, () => {}, ac.signal)
            if (ac.signal.aborted) return // 상한을 넘겨 포기한 교체 — 뒤늦게 워커를 건드리지 않는다
            stage = 'voice'
            await setTtsVoice(sel.voice, {
              path: file.path,
              size: file.size,
              url,
              cacheKey: cacheKey(sel.id, url),
            })
          })(),
          VOICE_SWITCH_TIMEOUT_MS,
          `목소리 교체가 ${Math.round(VOICE_SWITCH_TIMEOUT_MS / 1000)}초 안에 끝나지 않았습니다`,
          () => {
            timedOut = true
            ac.abort()
          },
        )
        this.loadedVoice = sel.voice
        this.loadedInterviewerId = selInterviewer
        this.voiceCached = true
        // 새 목소리만큼 ttsSize가 늘어도 그 다운로드는 진행률에 반영되지 않았다(no-op 콜백) — 전체 진행률이 100 밑으로 처지지 않게 맞춘다
        this.ttsReceived = Math.max(this.ttsReceived, this.ttsSize)
      } catch (e) {
        failed = true
        const msg = e instanceof Error ? e.message : String(e)
        if (timedOut && stage === 'voice') {
          // 워커가 교체에 응답하지 않는다 — 믿을 수 없으니 버리고 목소리 실패로(준비 화면의 다시 시도·목소리 없이 시작).
          // 되돌릴 로드된 목소리가 없으니 선택은 그대로 — retryTts가 고른 목소리로 새로 올린다
          disposeTts()
          this.ttsStatus = 'error'
          this.ttsError = msg
          this.loadedVoice = null
          this.loadedInterviewerId = null
          return false
        }
        this.voiceError = `목소리를 바꾸지 못했습니다: ${msg}`
        // 선택도 실제로 로드된 목소리의 면접관으로 되돌린다(spec 7절) — 다른 선택이 끼어들어도 "실제 로드된 것"을 기준으로 삼는다
        if (this.loadedInterviewerId) {
          useInterviewerStore().select(this.loadedInterviewerId)
          await this.checkVoiceCached()
        }
      } finally {
        this.voiceSwitching = false
      }
      if (!failed) return this.syncVoice() // 바꾸는 동안 또 다른 면접관을 골랐으면 이어서 맞춘다
      // 되돌리는 사이(캐시 확인 대기)에 고른 면접관은 syncVoice가 조기 반환해 버려졌다 — 되돌린 면접관과 다르면 이어서 맞춘다
      if (
        this.loadedInterviewerId &&
        (useInterviewerStore().id ?? DEFAULT_INTERVIEWER) !== this.loadedInterviewerId
      )
        await this.syncVoice()
      return false
    },
    /** 면접관 고르기(랜딩·준비 화면 공용): 선택 → 목소리 캐시 확인 → 준비된 워커면 목소리 교체(실패 시 되돌림은 syncVoice가 한다) */
    async chooseInterviewer(id: InterviewerId) {
      const iv = useInterviewerStore()
      this.voiceError = null // 지난 교체 실패 안내 — 로드된 면접관을 다시 고르면 syncVoice가 조기 반환해 남는다
      iv.select(id)
      await this.checkVoiceCached()
      await this.syncVoice()
    },
    setVoiceWanted(on: boolean) {
      this.voiceWanted = on
      if (this.manifest) void this.checkCached() // 목소리 선택이 바뀌면 재방문 여부도 달라진다
      try {
        localStorage.setItem(VOICE_KEY, on ? '1' : '0')
      } catch {
        /* 사생활 모드 등 — 이번 세션만 유지 */
      }
    },
    retryTts() {
      return this.loadTts()
    },
    retry() {
      return this.download()
    },
    async useFallback() {
      if (!this.manifest?.fallback) return
      await disposeEngine()
      this.setActive(this.manifest.fallback)
      await this.checkCached()
      await this.download()
    },
    async clearCache() {
      await disposeEngine()
      disposeTts()
      await clearModels()
      this.received = 0
      this.status = 'idle'
      this.error = null
      this.initFailed = false
      this.ttsStatus = 'idle'
      this.ttsReceived = 0
      this.ttsError = null
      this.cached = false
      this.modelCached = false
      this.voiceCached = false
      this.loadedVoice = null
      this.loadedInterviewerId = null
      this.voiceSwitching = false
      this.voiceError = null
    },
  },
})
