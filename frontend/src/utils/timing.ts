/** 면접 시간 계산·표기. 브라우저 API·스토어 없음 */

export type TurnDuration = { question: string; ms: number }
type Msg = { role: 'user' | 'model'; text: string; at?: number }

const pad = (n: number) => String(n).padStart(2, '0')

function parts(ms: number) {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
  return { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 }
}

/** 면접 중 시계: mm:ss, 1시간 넘으면 h:mm:ss */
export function formatClock(ms: number): string {
  const { h, m, s } = parts(ms)
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** 리포트 표기: 12분 34초 / 34초 / 1시간 2분 3초 */
export function formatDuration(ms: number): string {
  const { h, m, s } = parts(ms)
  if (h) return `${h}시간 ${m}분 ${s}초`
  if (m) return `${m}분 ${s}초`
  return `${s}초`
}

/**
 * 면접관 턴마다 답하는 데 쓴 시간: 질문이 끝난 시각(at)부터 그 다음 지원자 턴의 at까지.
 * 답변 없이 끝났으면 endAt까지, endAt도 없으면 그 턴은 제외. at 없는 메시지는 건너뛴다.
 */
export function turnDurations(messages: Msg[], endAt: number | null): TurnDuration[] {
  const out: TurnDuration[] = []
  for (let i = 0; i < messages.length; i++) {
    const q = messages[i]
    if (q.role !== 'model' || q.at === undefined) continue
    const a = messages.slice(i + 1).find((m) => m.role === 'user' && m.at !== undefined)
    const end = a?.at ?? endAt
    if (end === null || end === undefined) continue
    out.push({ question: q.text, ms: Math.max(0, end - q.at) })
  }
  return out
}

export function totalDuration(startedAt: number | null, endedAt: number | null): number {
  return startedAt !== null && endedAt !== null ? Math.max(0, endedAt - startedAt) : 0
}
