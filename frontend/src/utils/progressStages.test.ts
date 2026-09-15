import { describe, expect, it } from 'vitest'
import { advance, captionFor } from './progressStages'

describe('progressStages', () => {
  it('구간을 건너뛰어도 전환 애니를 순서대로 큐에 넣는다', () => {
    const s = advance({ stage: 0, queue: [] }, 75)
    expect(s.stage).toBe(2)
    expect(s.queue).toEqual(['pickup_suit', 'pickup_bag'])
  })
  it('같은 구간 안에서는 아무것도 추가하지 않는다', () => {
    const s = advance({ stage: 1, queue: [] }, 45)
    expect(s).toEqual({ stage: 1, queue: [] })
  })
  it('90%에서 look_up', () => {
    expect(advance({ stage: 2, queue: [] }, 90).queue).toEqual(['look_up'])
  })
  it('문구', () => {
    expect(captionFor(10)).toBe('출근 준비 중…')
    expect(captionFor(41)).toBe('양복은 챙겼습니다. 가방을 찾는 중…')
    expect(captionFor(95)).toBe('회사 앞입니다')
  })
})
