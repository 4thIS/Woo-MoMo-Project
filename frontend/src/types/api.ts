export interface ModelRef {
  id: string
  url: string
  size: number
}

export interface ChatTemplate {
  turnStart: string
  turnEnd: string
  roles: Record<string, string>
}

export interface TtsFile {
  path: string
  size: number
}

/** 받을 수 있는 목소리 하나(docs/API.md tts.voices, 2026-09-26). 파일 URL = baseUrl + path */
export interface TtsVoice {
  id: string
  path: string
  size: number
}

/** /api/manifest의 tts (docs/API.md). null이면 음성 단계 없음 */
export interface TtsManifest {
  id: string
  baseUrl: string
  files: TtsFile[]
  voice: string
  lang: string
  /** 없으면(옛 매니페스트) 기본 voice만 쓴다. 엔진 = files − voices 경로 */
  voices?: TtsVoice[] | null
}

export interface Manifest extends ModelRef {
  template: ChatTemplate
  systemPromptOverride: string | null
  fallback: ModelRef | null
  tts?: TtsManifest | null
}

export interface QuestionSet {
  field: string
  questions: string[]
}
