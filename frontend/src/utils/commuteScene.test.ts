import { describe, expect, it } from 'vitest'
import {
  COMMUTE,
  IDLE_GAP,
  advanceStages,
  captionAt,
  nextIdleAt,
  pickIdle,
  stageAt,
  type StageState,
} from './commuteScene'

describe('구간', () => {
  it('진행률 경계가 스펙과 같다', () => {
    expect(COMMUTE.map((s) => s.at)).toEqual([0, 15, 30, 45, 60, 75, 88, 100])
  })
  it('45% 전은 실내, 45%부터 실외다', () => {
    for (const s of COMMUTE) expect(s.kind).toBe(s.at < 45 ? 'indoor' : 'outdoor')
  })
  it('이정표는 30·45·100 셋이다', () => {
    expect(COMMUTE.filter((s) => s.once).map((s) => s.at)).toEqual([30, 45, 100])
  })
  it('stageAt은 경계를 포함한다', () => {
    expect(stageAt(0)).toBe(0)
    expect(stageAt(29.9)).toBe(1)
    expect(stageAt(30)).toBe(2)
    expect(stageAt(100)).toBe(COMMUTE.length - 1)
  })
  it('진행률이 점프해도 밀린 전환이 순서대로 큐에 쌓인다', () => {
    const s = advanceStages({ stage: 0, queue: [] }, 100)
    expect(s.stage).toBe(COMMUTE.length - 1)
    expect(s.queue).toEqual(['dress', 'bag', 'arrive'])
  })
  it('진행률이 뒤로 가도 구간은 내려가지 않는다 — 되감기는 호출 쪽이 장면을 다시 세운다', () => {
    const s = advanceStages({ stage: 3, queue: [] }, 10)
    expect(s.stage).toBe(3)
    expect(s.queue).toEqual([])
  })
  it('같은 진행률로 여러 번 불러도 전환이 중복되지 않는다', () => {
    let s: StageState = { stage: 0, queue: [] }
    for (let i = 0; i < 5; i++) s = advanceStages(s, 50)
    expect(s.queue).toEqual(['dress', 'bag'])
  })
  it('문구는 구간을 따른다', () => {
    expect(captionAt(0)).toContain('일어났')
    expect(captionAt(100)).toContain('자리에')
  })
})

describe('잔동작', () => {
  it('다음 예정 시각은 15~25초 뒤다', () => {
    expect(nextIdleAt(1000, () => 0)).toBe(1000 + IDLE_GAP[0])
    expect(nextIdleAt(1000, () => 1)).toBe(1000 + IDLE_GAP[1])
    expect(nextIdleAt(1000, () => 0.5)).toBe(1000 + (IDLE_GAP[0] + IDLE_GAP[1]) / 2)
  })
  it('그 구간에 정의된 잔동작만 고른다', () => {
    const bedroom = COMMUTE[0]
    expect(bedroom.idles).toContain(pickIdle(bedroom, () => 0) as string)
  })
  it('잔동작이 없는 구간은 null을 준다', () => {
    const last = COMMUTE[COMMUTE.length - 1]
    expect(pickIdle(last, () => 0)).toBeNull()
  })
  it('진행률이 멈춰 있어도 잔동작 일정은 시간으로만 돈다', () => {
    const t = nextIdleAt(0, () => 0)
    expect(t).toBeGreaterThan(0)
    expect(t).toBeLessThanOrEqual(IDLE_GAP[1])
  })
})
