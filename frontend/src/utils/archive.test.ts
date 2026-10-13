import { describe, it, expect } from 'vitest'
import { ARCHIVE_LIMIT, freeEntries, premiumEntries, willEvict, isFull } from './archive'
import type { ArchiveEntry } from '@/services/account'

/** 최신순 목록을 만든다 — 서버가 최신순으로 준다 */
const make = (n: number, premium = false): ArchiveEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${premium ? 'p' : 'f'}${i}`,
    interviewerId: 'm1',
    premium,
    track: 'company' as const,
    startedAt: `2026-10-${String(20 - i).padStart(2, '0')}T00:00:00Z`,
    endedAt: `2026-10-${String(20 - i).padStart(2, '0')}T00:20:00Z`,
    questionCount: 5,
    hasRecording: false,
  }))

describe('보관함 — 갈라 세기', () => {
  it('일반과 프리미엄을 갈라 센다', () => {
    const list = [...make(2), ...make(3, true)]
    expect(freeEntries(list)).toHaveLength(2)
    expect(premiumEntries(list)).toHaveLength(3)
  })

  it('빈 목록도 던지지 않는다', () => {
    expect(freeEntries([])).toEqual([])
    expect(premiumEntries([])).toEqual([])
    expect(isFull([])).toBe(false)
  })
})

describe('보관함 — 한도는 일반에만', () => {
  it(`일반이 ${ARCHIVE_LIMIT}개면 찼다`, () => {
    expect(isFull(make(ARCHIVE_LIMIT))).toBe(true)
  })

  it('하나 모자라면 아직 아니다', () => {
    expect(isFull(make(ARCHIVE_LIMIT - 1))).toBe(false)
  })

  it('프리미엄이 아무리 많아도 한도와 무관하다', () => {
    expect(isFull([...make(2), ...make(99, true)])).toBe(false)
  })
})

describe('willEvict — 다음에 무엇이 밀려나나', () => {
  it('차 있으면 가장 오래된 일반 하나다', () => {
    expect(willEvict(make(ARCHIVE_LIMIT))?.id).toBe(`f${ARCHIVE_LIMIT - 1}`)
  })

  it('자리가 남으면 아무것도 안 밀려난다', () => {
    expect(willEvict(make(ARCHIVE_LIMIT - 1))).toBeNull()
  })

  it('프리미엄은 밀려나지 않는다 — 가장 오래된 게 프리미엄이어도', () => {
    const old = make(1, true).map((e) => ({ ...e, startedAt: '2020-01-01T00:00:00Z' }))
    expect(willEvict([...make(ARCHIVE_LIMIT), ...old])?.premium).toBe(false)
  })

  it('저장할 기록이 프리미엄이면 아무것도 안 밀려난다', () => {
    expect(willEvict(make(ARCHIVE_LIMIT), { premium: true })).toBeNull()
  })

  it('목록이 최신순이 아니어도 가장 오래된 것을 고른다', () => {
    const shuffled = [...make(ARCHIVE_LIMIT)].reverse()
    expect(willEvict(shuffled)?.id).toBe(`f${ARCHIVE_LIMIT - 1}`)
  })
})
