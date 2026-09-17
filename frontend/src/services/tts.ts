import { cacheKey, downloadModel, hasModel } from '@/services/modelCache'
import type { TtsManifest } from '@/types/api'
import type { MainToWorker, TtsLoadFile, WorkerToMain } from '@/workers/ttsProtocol'

export type { TtsManifest } from '@/types/api'
export interface AudioClip {
  samples: Float32Array
  sampleRate: number
  durationMs: number
}

const WASM_PATHS = '/ort-wasm/'
type Pending = { resolve: (c: AudioClip) => void; reject: (e: unknown) => void }

let worker: Worker | null = null
let loaded = false
let nextId = 1
const pending = new Map<number, Pending>()
/** 동시에 initTts가 여러 번 호출될 때, 가장 최근 호출만 워커를 스폰·확정하게 하는 세대 카운터 */
let gen = 0
/** 진행 중인 initTts의 reject. 밀려나거나(superseded) dispose되면 즉시 이걸로 거부해 무한 대기를 막는다 */
let initReject: ((e: unknown) => void) | null = null

/** 테스트에서 가짜 워커를 꽂는다. null이면 실제 워커 */
let factory: (() => Worker) | null = null
export function __setWorkerFactory(f: (() => Worker) | null) {
  factory = f
}
const spawn = () =>
  factory
    ? factory()
    : new Worker(new URL('../workers/tts.worker.ts', import.meta.url), { type: 'module' })

function fail(e: unknown) {
  for (const p of pending.values()) p.reject(e)
  pending.clear()
}

/** 파일을 순서대로 내려받아 캐시에 넣고(있으면 건너뜀) 워커를 띄워 세션을 만든다 */
export function initTts(
  cfg: TtsManifest,
  onProgress?: (received: number, total: number) => void,
): Promise<void> {
  // 이전 init이 아직 진행 중이면(다운로드 중이든 워커 응답 대기 중이든) 무한 대기하지 않도록 먼저 거부한다
  initReject?.(new Error('TTS init superseded'))
  initReject = null
  disposeTts()
  const my = ++gen

  return new Promise<void>((resolve, reject) => {
    initReject = reject
    void (async () => {
      try {
        const total = cfg.files.reduce((n, f) => n + f.size, 0)
        let done = 0
        const files: TtsLoadFile[] = []
        for (const f of cfg.files) {
          const url = cfg.baseUrl + f.path
          files.push({ path: f.path, size: f.size, url, cacheKey: cacheKey(cfg.id, url) })
          if (!(await hasModel(cfg.id, url))) {
            await downloadModel(cfg.id, url, f.size, (r) => onProgress?.(done + r, total))
          }
          done += f.size
          onProgress?.(done, total)
        }
        if (my !== gen) {
          reject(new Error('TTS init superseded')) // 다운로드 중 더 새로운 initTts/dispose가 있었음 — 이 워커는 스폰하지 않는다
          return
        }
        const w = spawn()
        worker = w
        const stale = () => my !== gen
        w.onmessage = (e: MessageEvent<WorkerToMain>) => {
          if (stale()) {
            w.terminate() // 이미 다음 세대로 넘어간 워커 — 응답은 버리고 정리만 한다
            return
          }
          const m = e.data
          if (m.type === 'loaded') {
            loaded = true
            resolve()
          } else if (m.type === 'error' && m.id === undefined) {
            w.terminate()
            worker = null
            reject(new Error(m.message))
          } else if (m.type === 'error') {
            pending.get(m.id!)?.reject(new Error(m.message))
            pending.delete(m.id!)
          } else if (m.type === 'audio') {
            const p = pending.get(m.id)
            pending.delete(m.id)
            p?.resolve({
              samples: m.samples,
              sampleRate: m.sampleRate,
              durationMs: Math.round((m.samples.length / m.sampleRate) * 1000),
            })
          }
        }
        w.onerror = (e) => {
          if (stale()) {
            w.terminate()
            return
          }
          const err = new Error(e.message || 'tts worker error')
          reject(err)
          fail(err)
          loaded = false
          worker = null
        }
        const msg: MainToWorker = {
          type: 'load',
          baseUrl: cfg.baseUrl,
          files,
          voice: cfg.voice,
          lang: cfg.lang,
          wasmPaths: WASM_PATHS,
        }
        w.postMessage(msg)
      } catch (e) {
        reject(e)
      }
    })()
  })
}

export function synthesize(text: string, signal?: AbortSignal): Promise<AudioClip> {
  if (!worker || !loaded)
    return Promise.reject(new Error('TTS가 초기화되지 않았습니다 (not loaded)'))
  const w = worker
  const id = nextId++
  return new Promise<AudioClip>((resolve, reject) => {
    if (signal?.aborted) {
      // 아직 워커에 synthesize를 보내지 않았으니 취소할 것도 없다 — cancel을 보내지 않는다
      reject(new DOMException('synthesize aborted', 'AbortError'))
      return
    }
    const abort = () => {
      pending.delete(id)
      w.postMessage({ type: 'cancel', id } satisfies MainToWorker)
      reject(new DOMException('synthesize aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    pending.set(id, {
      resolve: (c) => {
        signal?.removeEventListener('abort', abort)
        resolve(c)
      },
      reject: (e) => {
        signal?.removeEventListener('abort', abort)
        reject(e)
      },
    })
    w.postMessage({ type: 'synthesize', id, text } satisfies MainToWorker)
  })
}

export function disposeTts(): void {
  gen++ // 다운로드 단계에서 대기 중인 init이 있다면 다음 세대 검사에서 스스로 멈추게 한다
  worker?.terminate()
  worker = null
  loaded = false
  fail(new Error('TTS disposed'))
  initReject?.(new Error('TTS disposed')) // 워커 응답을 영영 못 받을 init이 있다면 지금 거부한다
  initReject = null
}
