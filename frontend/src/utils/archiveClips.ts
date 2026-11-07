/** 녹음을 리포트 카드에 나눠 붙인다 (2026-11-07).
 *
 * 녹음은 **답변 순번**(`turn`)으로 저장되고, 리포트 카드는 꼬리질문을 한 장에 합친다.
 * 그래서 카드 번호로는 바로 못 찾는다 — 카드가 차지하는 답변 구간을 구해 그 안의 녹음을 모은다.
 * 짝짓는 방법은 `answersForReport`와 **같은 것**(`matchQuestions`)을 쓴다. 둘이 다른 규칙을
 * 쓰면 답변 글과 그 답변의 녹음이 서로 다른 카드에 앉는다.
 */
import { matchQuestions } from './reportAnswers'

export interface Clip {
  turn: number
  url: string
  durationSec?: number | null
}
type Msg = { role: 'user' | 'model'; text: string }

export function clipsByCard(
  report: { question: string }[],
  messages: Msg[],
  recordings: Clip[],
): Clip[][] {
  const qIdx = messages.flatMap((m, i) => (m.role === 'model' ? [i] : []))
  const starts = matchQuestions(
    report,
    qIdx.map((i) => messages[i].text),
  )
  /** 메시지 자리 → 몇 번째 답변인가 */
  const answerAt = new Map<number, number>()
  let n = 0
  messages.forEach((m, i) => {
    if (m.role === 'user') answerAt.set(i, n++)
  })

  return report.map((_, i) => {
    const s = starts[i]
    if (s < 0) return []
    const next = starts.slice(i + 1).find((v) => v >= 0)
    const from = qIdx[s]
    const to = next === undefined ? messages.length : qIdx[next]
    const turns = new Set<number>()
    for (let k = from; k < to; k++) {
      const a = answerAt.get(k)
      if (a !== undefined) turns.add(a)
    }
    return recordings.filter((r) => turns.has(r.turn))
  })
}
