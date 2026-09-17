/**
 * 리포트 카드에 지원자가 실제로 입력한 답변을 붙인다.
 * 리포트(JSON)는 모델이 쓴 것이라 답변을 요약·의역하므로, 답변 원문은 대화 기록(messages)에서 가져온다.
 * 카드의 question을 대화의 면접관 턴과 짝지어(순서 유지) 그 질문부터 다음 카드 질문 전까지의
 * 지원자 턴을 모두 그 카드의 답변으로 본다 — 리포트가 꼬리질문을 원래 질문에 합치는 규칙과 맞물린다.
 */
export interface Turn {
  role: 'user' | 'model'
  text: string
}

/** 이 점수보다 낮으면 모델이 질문을 다르게 옮겨 적은 것으로 보고 순서대로 짝짓는다 */
const MATCH_MIN = 0.3

const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}]/gu, '')
function bigrams(s: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}
/** 문자 바이그램 Dice 계수 (0~1). 짧은 한국어 문장의 의역·공백 차이에 무난하다 */
export function similarity(a: string, b: string): number {
  const A = bigrams(norm(a))
  const B = bigrams(norm(b))
  if (!A.size || !B.size) return 0
  let n = 0
  for (const g of A) if (B.has(g)) n++
  return (2 * n) / (A.size + B.size)
}

export function answersForReport(report: { question: string }[], messages: Turn[]): string[][] {
  const qIdx = messages.flatMap((m, i) => (m.role === 'model' ? [i] : []))
  // 카드 i가 대응하는 면접관 턴(qIdx의 위치). 카드 순서 = 질문 순서이므로 앞으로만 나아간다
  const starts: number[] = []
  let cursor = 0
  for (const it of report) {
    let best = -1
    let bestScore = 0
    for (let k = cursor; k < qIdx.length; k++) {
      const s = similarity(it.question, messages[qIdx[k]].text)
      if (s > bestScore) {
        bestScore = s
        best = k
      }
    }
    if (best < 0 || bestScore < MATCH_MIN) best = cursor < qIdx.length ? cursor : -1
    starts.push(best)
    if (best >= 0) cursor = best + 1
  }
  return report.map((_, i) => {
    const s = starts[i]
    if (s < 0) return []
    const next = starts.slice(i + 1).find((v) => v >= 0)
    const from = qIdx[s]
    const to = next === undefined ? messages.length : qIdx[next]
    return messages
      .slice(from, to)
      .filter((m) => m.role === 'user')
      .map((m) => m.text)
  })
}
