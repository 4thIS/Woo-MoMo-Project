import { describe, expect, it } from 'vitest'
import {
  SCROLL_MAX,
  TRACK,
  advance,
  captionFor,
  followScroll,
  overallFraction,
  scrollProgress,
  targetScroll,
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

describe('장면 스크롤 (#25)', () => {
  it('목표 거리는 진행률에 비례하고 100%(회사 앞)에서 멈춘다', () => {
    expect(targetScroll(0)).toBe(0)
    expect(targetScroll(45)).toBe(TRACK * 0.45)
    expect(targetScroll(100)).toBe(TRACK)
    expect(targetScroll(120)).toBe(TRACK)
  })
  it('한 프레임에 최대 속도 이상 움직이지 않는다 — 진행률이 튀어도 화면은 일정 속도', () => {
    expect(followScroll(0, 800, 0.1)).toBe(SCROLL_MAX * 0.1)
    expect(followScroll(0, 800, 1)).toBe(SCROLL_MAX)
  })
  it('목표에 가까우면 딱 목표에서 멈추고 뒤로는 가지 않는다', () => {
    expect(followScroll(798, 800, 1)).toBe(800)
    expect(followScroll(800, 800, 1)).toBe(800)
    expect(followScroll(500, 300, 1)).toBe(500)
  })
  it('스크롤을 진행률로 되돌려 물건 줍기 시점을 위치와 맞춘다', () => {
    expect(scrollProgress(TRACK * 0.3)).toBe(30)
    expect(scrollProgress(0)).toBe(0)
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
