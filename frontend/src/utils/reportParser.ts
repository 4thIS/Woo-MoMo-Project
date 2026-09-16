import { formatDuration, type TurnDuration } from './timing'

const QUESTION_MAX = 41

export interface ReportItem {
  question: string
  answerSummary: string
  feedback: string
}

function isItem(v: unknown): v is ReportItem {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.question === 'string' &&
    typeof o.answerSummary === 'string' &&
    typeof o.feedback === 'string'
  )
}

function tryParseItems(s: string): ReportItem[] | null {
  try {
    const v: unknown = JSON.parse(s)
    return Array.isArray(v) && v.length > 0 && v.every(isItem) ? v : null
  } catch {
    return null
  }
}

/**
 * 모델 출력에서 리포트 배열을 찾는다. 앞뒤 잡담에 `[`·`]`가 섞여 있어도(예: "참고 [1]")
 * 각 `[` 후보에서 시작해 뒤쪽 `]` 후보를 차례로 시도하므로 첫 번째로 파싱되는 배열을 얻는다.
 */
export function parseReport(raw: string): ReportItem[] | null {
  const s = raw.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '')
  const opens: number[] = []
  const closes: number[] = []
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '[') opens.push(i)
    else if (s[i] === ']') closes.push(i)
  }
  for (const start of opens) {
    for (let j = closes.length - 1; j >= 0; j--) {
      const end = closes[j]
      if (end <= start) break
      const found = tryParseItems(s.slice(start, end + 1))
      if (found) return found
    }
  }
  return null
}

export function splitEmphasis(text: string): { text: string; strong: boolean }[] {
  const parts: { text: string; strong: boolean }[] = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0
    if (i > last) parts.push({ text: text.slice(last, i), strong: false })
    parts.push({ text: m[1], strong: true })
    last = i + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), strong: false })
  return parts.length ? parts : [{ text, strong: false }]
}

/** 리포트 복사 텍스트의 공용 헤더. 파싱된 리포트와 원문 폴백 복사가 같은 헤더를 쓴다. */
export function reportHeader(fieldLabel: string, job: string): string {
  return `모두의 모의면접 리포트 · ${fieldLabel} · ${job}`
}

export function reportToText(
  items: ReportItem[],
  fieldLabel: string,
  job: string,
  timing?: { total: number; turns: TurnDuration[] },
): string {
  const strip = (s: string) => s.replace(/\*\*/g, '')
  const body = items
    .map(
      (it, i) =>
        `Q${i + 1}. ${strip(it.question)}\n답변 요약: ${strip(it.answerSummary)}\n피드백: ${strip(it.feedback)}`,
    )
    .join('\n\n')
  const time = timing
    ? `\n\n소요 시간: 총 ${formatDuration(timing.total)}\n` +
      timing.turns.map((t) => `- ${formatDuration(t.ms)} · ${clip(t.question)}`).join('\n')
    : ''
  return `${reportHeader(fieldLabel, job)}\n\n${body}${time}`
}

/** 질문 앞 {@link QUESTION_MAX}자 + … (리포트 시간 표와 복사 텍스트 공용) */
export function clip(s: string, max = QUESTION_MAX): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}
