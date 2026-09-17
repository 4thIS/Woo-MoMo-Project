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

/** /api/manifest의 tts (docs/API.md). null이면 음성 단계 없음 */
export interface TtsManifest {
  id: string
  baseUrl: string
  files: TtsFile[]
  voice: string
  lang: string
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
