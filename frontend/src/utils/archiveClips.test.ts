import { describe, expect, it } from 'vitest'
import { clipsByCard } from './archiveClips'

const report = [{ question: 'q1' }, { question: 'q2' }]
const messages = [
  { role: 'model' as const, text: 'q1' },
  { role: 'user' as const, text: 'a1' },
  { role: 'model' as const, text: 'q1 꼬리' },
  { role: 'user' as const, text: 'a2' },
  { role: 'model' as const, text: 'q2' },
  { role: 'user' as const, text: 'a3' },
]
const recordings = [
  { turn: 0, url: 'u0', durationSec: 10 },
  { turn: 1, url: 'u1', durationSec: 20 },
  { turn: 2, url: 'u2', durationSec: 30 },
]

describe('clipsByCard', () => {
  it('꼬리질문 답변은 제 카드에 함께 붙는다 — 리포트가 둘을 한 장에 합치기 때문이다', () => {
    const out = clipsByCard(report, messages, recordings)
    expect(out[0].map((c) => c.url)).toEqual(['u0', 'u1'])
    expect(out[1].map((c) => c.url)).toEqual(['u2'])
  })

  it('녹음이 없으면 빈 배열이다 — 빈 플레이어는 고장처럼 보인다', () => {
    expect(clipsByCard(report, messages, [])).toEqual([[], []])
  })

  it('녹음이 답변보다 적어도 던지지 않는다 — 중간에 끊긴 기록이 있다', () => {
    const out = clipsByCard(report, messages, [{ turn: 2, url: 'u2', durationSec: 1 }])
    expect(out[0]).toEqual([])
    expect(out[1].map((c) => c.url)).toEqual(['u2'])
  })

  it('카드가 대화와 짝지어지지 않아도 던지지 않는다', () => {
    expect(clipsByCard([{ question: 'x' }], [], recordings)).toEqual([[]])
  })

  it('카드가 없으면 빈 목록이다', () => {
    expect(clipsByCard([], messages, recordings)).toEqual([])
  })
})
