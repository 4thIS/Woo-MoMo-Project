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

export interface Manifest extends ModelRef {
  template: ChatTemplate
  systemPromptOverride: string | null
  fallback: ModelRef | null
}

export interface QuestionSet {
  field: string
  questions: string[]
}
