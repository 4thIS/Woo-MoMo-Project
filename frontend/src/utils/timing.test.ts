import { describe, expect, it } from 'vitest'
import { formatClock, formatDuration, totalDuration, turnDurations } from './timing'

describe('formatClock', () => {
  it('mm:ss', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(754_000)).toBe('12:34')
  })
  it('1시간 넘으면 h:mm:ss', () => expect(formatClock(3_723_000)).toBe('1:02:03'))
  it('음수·NaN은 00:00', () => {
    expect(formatClock(-5)).toBe('00:00')
    expect(formatClock(NaN)).toBe('00:00')
  })
})

describe('formatDuration', () => {
  it('분·초', () => expect(formatDuration(754_000)).toBe('12분 34초'))
  it('60초 미만은 초만', () => expect(formatDuration(34_000)).toBe('34초'))
  it('시간 포함', () => expect(formatDuration(3_723_000)).toBe('1시간 2분 3초'))
  it('0은 0초', () => expect(formatDuration(0)).toBe('0초'))
})

describe('turnDurations', () => {
  const t0 = 1_000_000
  it('면접관 질문이 끝난 시각부터 다음 지원자 전송 시각까지', () => {
    const msgs = [
      { role: 'model' as const, text: '자기소개 해주세요', at: t0 },
      { role: 'user' as const, text: '저는…', at: t0 + 90_000 },
      { role: 'model' as const, text: '어려웠던 문제는?', at: t0 + 100_000 },
      { role: 'user' as const, text: 'N+1…', at: t0 + 160_000 },
    ]
    expect(turnDurations(msgs, null)).toEqual([
      { question: '자기소개 해주세요', ms: 90_000 },
      { question: '어려웠던 문제는?', ms: 60_000 },
    ])
  })
  it('답변 없이 끝난 마지막 질문은 endAt까지', () => {
    const msgs = [{ role: 'model' as const, text: '마지막', at: t0 }]
    expect(turnDurations(msgs, t0 + 5_000)).toEqual([{ question: '마지막', ms: 5_000 }])
  })
  it('endAt도 없으면 마지막 질문은 제외', () => {
    const msgs = [{ role: 'model' as const, text: '마지막', at: t0 }]
    expect(turnDurations(msgs, null)).toEqual([])
  })
  it('at 없는 메시지는 건너뛰고 던지지 않는다', () => {
    const msgs = [
      { role: 'model' as const, text: '옛 메시지' },
      { role: 'user' as const, text: '답' },
      { role: 'model' as const, text: '새 질문', at: t0 },
      { role: 'user' as const, text: '답', at: t0 + 1_000 },
    ]
    expect(turnDurations(msgs, null)).toEqual([{ question: '새 질문', ms: 1_000 }])
  })
})

describe('totalDuration', () => {
  it('둘 다 있으면 차이, 하나라도 없으면 0', () => {
    expect(totalDuration(10, 25)).toBe(15)
    expect(totalDuration(null, 25)).toBe(0)
    expect(totalDuration(10, null)).toBe(0)
  })
})
