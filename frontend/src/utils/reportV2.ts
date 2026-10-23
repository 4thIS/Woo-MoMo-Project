/** 벤 리포트 버전 2 (`docs/API.md` 벤 3) `event: report`).
 *
 * 서버가 이미 형식을 검증하고 보내므로 여기서는 **화면이 그릴 수 있는 모양인지**만 본다.
 * 등급 문자열(`느림`·`보통`…)은 좁히지 않는다 — 서버가 값을 늘리면 화면만 조용히 비게 된다.
 */

export interface VoiceLevel {
  level: string
  reason: string
}
export interface VoiceFlag {
  present: boolean
  reason: string
}
export interface Voice {
  confidence: VoiceLevel
  tone: VoiceLevel
  tremor: VoiceFlag
  trailingOff: VoiceFlag
  clarity: VoiceLevel
}
export interface Filler {
  level: string
  /** 브라우저 판정만 있으면 센 적이 없다 */
  count: number | null
  examples: string[]
}
export interface Measurements {
  syllablesPerMin: number | null
  speed: string | null
  longPauses: number | null
  pausesPerMin: number | null
  pause: string | null
  longestPauseSec: number | null
  firstWordSec: number | null
  firstWord: string | null
  filler: Filler | null
  voice: Voice | null
  /** 말한 시간 5초 미만·음절 0. 이러면 나머지 값은 전부 null이다 */
  insufficient: boolean
}
export interface ReportV2Item {
  id: string
  parent: string | null
  answer: number
  kind: 'main' | 'follow'
  question: string
  answerSummary: string
  feedback: string
  delivery: string | null
  measurements: Measurements | null
}
export interface SummaryPoint {
  point: string
  /** 근거가 된 항목 id. 화면은 그 항목으로 가는 링크로 쓴다 */
  refs: string[]
}
export interface ReportV2Summary {
  strengths: SummaryPoint[]
  improvements: SummaryPoint[]
  delivery: string | null
  postingFit: { met: string[]; gaps: string[] } | null
}
export interface ReportV2 {
  version: 2
  items: ReportV2Item[]
  summary: ReportV2Summary
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

const str = (v: unknown): v is string => typeof v === 'string'

function points(v: unknown): SummaryPoint[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((raw) => {
    const o = obj(raw)
    if (!o || !str(o.point)) return []
    const refs = Array.isArray(o.refs) ? o.refs.filter(str) : []
    return [{ point: o.point, refs }]
  })
}

function item(raw: unknown): ReportV2Item | null {
  const o = obj(raw)
  if (!o) return null
  // 글 세 개가 화면의 뼈대다. 하나라도 없으면 반쪽을 그리느니 버전 1로 떨어지는 편이 낫다
  if (!str(o.id) || !str(o.question) || !str(o.answerSummary) || !str(o.feedback)) return null
  return {
    id: o.id,
    parent: str(o.parent) ? o.parent : null,
    answer: typeof o.answer === 'number' ? o.answer : 0,
    kind: o.kind === 'follow' ? 'follow' : 'main',
    question: o.question,
    answerSummary: o.answerSummary,
    feedback: o.feedback,
    delivery: str(o.delivery) ? o.delivery : null,
    measurements: (obj(o.measurements) as Measurements | null) ?? null,
  }
}

/** 버전 2 리포트로 쓸 수 있으면 다듬어 돌려주고, 아니면 null(= 버전 1로 간다) */
export function asReportV2(raw: unknown): ReportV2 | null {
  const o = obj(raw)
  if (!o || o.version !== 2 || !Array.isArray(o.items)) return null
  const s = obj(o.summary)
  if (!s) return null

  const items: ReportV2Item[] = []
  for (const r of o.items) {
    const it = item(r)
    if (!it) return null
    items.push(it)
  }
  const fit = obj(s.postingFit)
  return {
    version: 2,
    items,
    summary: {
      strengths: points(s.strengths),
      improvements: points(s.improvements),
      delivery: str(s.delivery) ? s.delivery : null,
      postingFit: fit
        ? {
            met: Array.isArray(fit.met) ? fit.met.filter(str) : [],
            gaps: Array.isArray(fit.gaps) ? fit.gaps.filter(str) : [],
          }
        : null,
    },
  }
}

/** 복사해 붙여 넣는 곳은 굵게를 모른다 — 별표는 떼고 글자만 남긴다 */
const strip = (s: string) => s.replace(/\*\*/g, '')

/** 리포트 복사·PDF용 텍스트. 화면과 같은 차례로 담는다 */
export function reportV2ToText(report: ReportV2, fieldLabel: string, job: string): string {
  const s = report.summary
  const head: string[] = []
  const pts = (list: SummaryPoint[]) =>
    list.map((p) => `- ${strip(p.point)}${p.refs.length ? ` (${p.refs.join(', ')})` : ''}`)
  if (s.strengths.length) head.push('강점\n' + pts(s.strengths).join('\n'))
  if (s.improvements.length) head.push('개선점\n' + pts(s.improvements).join('\n'))
  if (s.delivery) head.push(`전달력: ${strip(s.delivery)}`)
  if (s.postingFit) {
    const f = s.postingFit
    const lines = []
    if (f.met.length) lines.push(`- 갖춤: ${f.met.join(' · ')}`)
    if (f.gaps.length) lines.push(`- 모자람: ${f.gaps.join(' · ')}`)
    if (lines.length) head.push('공고 적합도\n' + lines.join('\n'))
  }

  const body = itemsInOrder(report.items)
    .map(
      (it) =>
        `${it.id}. ${strip(it.question)}\n내 답변: ${strip(it.answerSummary)}\n피드백: ${strip(it.feedback)}` +
        (it.delivery ? `\n전달력: ${strip(it.delivery)}` : ''),
    )
    .join('\n\n')

  const top = head.length ? `${head.join('\n\n')}\n\n` : ''
  return `모두의 모의면접 리포트 · ${fieldLabel} · ${job}\n\n${top}${body}`
}

/**
 * 화면에 그릴 차례로 세운다 — 꼬리질문은 제 부모 바로 뒤에, 같은 부모끼리는 답변 순서대로.
 * 부모를 찾지 못한 꼬리질문도 버리지 않는다(서버가 보낸 것은 다 보여 준다).
 */
export function itemsInOrder(items: readonly ReportV2Item[]): ReportV2Item[] {
  const mains = items.filter((i) => i.kind === 'main')
  const follows = items.filter((i) => i.kind === 'follow')
  const used = new Set<string>()
  const out: ReportV2Item[] = []
  for (const m of mains) {
    out.push(m)
    for (const f of follows.filter((f) => f.parent === m.id).sort((a, b) => a.answer - b.answer)) {
      used.add(f.id)
      out.push(f)
    }
  }
  return [...out, ...follows.filter((f) => !used.has(f.id))]
}
