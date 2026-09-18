import { describe, expect, it } from 'vitest'
import {
  SCROLL,
  advance,
  approach,
  captionFor,
  distanceAhead,
  overallFraction,
  progressRate,
} from './progressStages'

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
  it('100%(모델+TTS 완료)에서 look_up', () => {
    expect(advance({ stage: 2, queue: [] }, 99).queue).toEqual([])
    expect(advance({ stage: 2, queue: [] }, 100).queue).toEqual(['look_up'])
  })
  it('문구', () => {
    expect(captionFor(10)).toBe('출근 준비 중…')
    expect(captionFor(41)).toBe('양복은 챙겼습니다. 가방을 찾는 중…')
    expect(captionFor(95)).toBe('가방도 챙겼습니다. 회사가 보이기 시작했어요.')
    expect(captionFor(100)).toBe('회사 앞입니다')
  })
})

describe('장면 (#25): 트레드밀 + 도착 예정 거리', () => {
  it('진행 속도: 창 안의 첫·끝 표본으로 %/s, 표본이 모자라거나 안 변했으면 0', () => {
    expect(progressRate([], 0)).toBe(0)
    expect(progressRate([{ t: 0, p: 10 }], 100)).toBe(0)
    expect(
      progressRate(
        [
          { t: 0, p: 10 },
          { t: 1000, p: 10.5 },
          { t: 2000, p: 11 },
        ],
        2000,
      ),
    ).toBe(0.5)
    // 4초 넘게 멈춤 → 창 밖 표본은 버려져 0
    expect(
      progressRate(
        [
          { t: 0, p: 10 },
          { t: 1000, p: 11 },
          { t: 6000, p: 11 },
          { t: 7000, p: 11 },
        ],
        7000,
      ),
    ).toBe(0)
  })
  it('남은 거리 = 도착까지 걸릴 초 × 걷는 속도. 지났으면 0, 속도 모르면 null', () => {
    expect(distanceAhead(30, 20, 0.5)).toBe((10 / 0.5) * SCROLL) // 20초 뒤 → 800px
    expect(distanceAhead(30, 30, 0.5)).toBe(0)
    expect(distanceAhead(30, 45, 0.5)).toBe(0)
    expect(distanceAhead(30, 20, 0)).toBeNull()
  })
  it('물건은 바닥과 같은 속도로 다가오고, 예상 위치가 맞으면 정확히 그 속도만 움직인다', () => {
    // 목표가 base와 같으면 오차 0 → 딱 speed·dt만 이동
    expect(approach(500, 500 - SCROLL * 0.1, 0.1)).toBeCloseTo(500 - SCROLL * 0.1)
    // 속도를 모르면 바닥과 함께만
    expect(approach(500, null, 0.1)).toBeCloseTo(500 - SCROLL * 0.1)
  })
  it('오차 보정은 점프하지 않는다: 가까워질 땐 최대 3배 속도, 멀어질 땐 절반 속도 이하', () => {
    const dt = 0.1
    const near = approach(500, 100, dt) // 400px 당겨야 함
    expect(500 - near).toBeLessThanOrEqual(SCROLL * dt * 4 + 1e-9) // 바닥 1배 + 보정 3배
    expect(500 - near).toBeGreaterThan(SCROLL * dt)
    const far = approach(500, 900, dt) // 400px 밀려나야 함
    expect(far).toBeLessThanOrEqual(500) // 뒤로 밀리는 속도(0.5배) < 바닥 속도(1배) → 그래도 다가온다
    expect(far).toBeGreaterThan(500 - SCROLL * dt)
  })
})

describe('전체 진행률 (#26)', () => {
  it('모델 + TTS 합산 바이트 기준', () => {
    expect(
      overallFraction({ modelSize: 800, modelReceived: 800, ttsSize: 200, ttsReceived: 0 }),
    ).toBe(0.8)
    expect(
      overallFraction({ modelSize: 800, modelReceived: 800, ttsSize: 200, ttsReceived: 100 }),
    ).toBe(0.9)
  })
  it('tts가 없으면 모델만', () => {
    expect(
      overallFraction({ modelSize: 800, modelReceived: 400, ttsSize: 0, ttsReceived: 0 }),
    ).toBe(0.5)
  })
  it('모델 캐시 히트(received = size)면 모델 몫은 꽉 찬 채 시작한다', () => {
    expect(
      overallFraction({ modelSize: 800, modelReceived: 800, ttsSize: 200, ttsReceived: 50 }),
    ).toBe(0.85)
  })
  it('총량 0이면 0, 초과 수신은 1로 자른다', () => {
    expect(overallFraction({ modelSize: 0, modelReceived: 0, ttsSize: 0, ttsReceived: 0 })).toBe(0)
    expect(overallFraction({ modelSize: 10, modelReceived: 99, ttsSize: 0, ttsReceived: 0 })).toBe(
      1,
    )
  })
})
