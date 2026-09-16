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

export function parseReport(raw: string): ReportItem[] | null {
  let s = raw.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '')
  const start = s.indexOf('[')
  const end = s.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  s = s.slice(start, end + 1)
  try {
    const v: unknown = JSON.parse(s)
    if (!Array.isArray(v) || v.length === 0 || !v.every(isItem)) return null
    return v
  } catch {
    return null
  }
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

export function reportToText(items: ReportItem[], fieldLabel: string, job: string): string {
  const strip = (s: string) => s.replace(/\*\*/g, '')
  const body = items
    .map(
      (it, i) =>
        `Q${i + 1}. ${strip(it.question)}\n답변 요약: ${strip(it.answerSummary)}\n피드백: ${strip(it.feedback)}`,
    )
    .join('\n\n')
  return `모두의 모의면접 리포트 · ${fieldLabel} · ${job}\n\n${body}`
}
