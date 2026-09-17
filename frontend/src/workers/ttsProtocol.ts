/** 메인 스레드 ↔ TTS 워커 메시지 계약. 런타임 의존 없음(onnxruntime-web은 워커 안에서만) */
export interface TtsLoadFile {
  path: string
  size: number
  url: string
  cacheKey: string
}

export type MainToWorker =
  | {
      type: 'load'
      baseUrl: string
      files: TtsLoadFile[]
      voice: string
      lang: string
      wasmPaths: string
    }
  | { type: 'synthesize'; id: number; text: string }
  | { type: 'cancel'; id: number }

export type WorkerToMain =
  | { type: 'loaded' }
  | { type: 'progress'; stage: string }
  | { type: 'audio'; id: number; samples: Float32Array; sampleRate: number }
  | { type: 'error'; id?: number; message: string }

/** Supertonic 기본값(helper.js: totalStep, speed=1.05, silenceDuration=0.3) */
export const TOTAL_STEP = 4
export const SPEED = 1.05
export const SILENCE_SEC = 0.3
