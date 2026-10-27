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
  /** 면접관을 바꿀 때: 목소리 JSON만 다시 읽어 스타일을 교체한다. ONNX 세션은 그대로 둔다 */
  | { type: 'setVoice'; voice: string; file: TtsLoadFile }

export type WorkerToMain =
  | { type: 'loaded' }
  | { type: 'progress'; stage: string }
  | { type: 'audio'; id: number; samples: Float32Array; sampleRate: number }
  | { type: 'error'; id?: number; message: string }
  | { type: 'voiceSet'; voice: string }
  | { type: 'voiceError'; voice: string; message: string }

/** Supertonic 기본값(helper.js: totalStep, speed=1.05, silenceDuration=0.3) */
export const TOTAL_STEP = 4
export const SPEED = 1.05
export const SILENCE_SEC = 0.3
