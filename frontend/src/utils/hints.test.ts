import { describe, it, expect } from 'vitest'
import { hintFor, HINTS, POINTER, pointerSpot, needsScroll, type HintContext } from './hints'

/** 아무 힌트도 안 뜨는 바닥 상태 — 테스트마다 필요한 조건만 켠다 */
const base: HintContext = {
  phase: 'landing',
  interviewerPicked: true,
  profileDone: true,
  resumeDone: true,
  canStart: false,
  stage: 'idle',
  answered: false,
  seen: [],
  enabled: true,
}
const ctx = (p: Partial<HintContext>): HintContext => ({ ...base, ...p })
const key = (p: Partial<HintContext>) => hintFor(ctx(p))?.key ?? null

describe('hintFor — 화면별 조건', () => {
  it('면접관을 안 골랐으면 고르라고 한다', () => {
    expect(key({ interviewerPicked: false })).toBe('pick-interviewer')
  })

  it('면접관을 골랐으면 그다음 할 일을 알려 준다', () => {
    expect(key({})).toBe('go-prepare')
  })

  it('준비 화면에서 직군·직무가 비었으면 그것부터', () => {
    expect(key({ phase: 'prepare', profileDone: false, resumeDone: false })).toBe('prepare-profile')
  })

  it('프로필을 채웠으면 이력서를 가리킨다', () => {
    expect(key({ phase: 'prepare', resumeDone: false })).toBe('prepare-resume')
  })

  it('시작할 수 있으면 시작 버튼을 가리킨다', () => {
    expect(key({ phase: 'prepare', canStart: true })).toBe('prepare-start')
  })

  it('면접에서 처음 답할 차례면 답하는 법을 알려 준다', () => {
    expect(key({ phase: 'interview', stage: 'waiting' })).toBe('interview-answer')
  })

  it('한 번 답했으면 끝내는 법을 알려 준다', () => {
    expect(key({ phase: 'interview', stage: 'waiting', answered: true })).toBe('interview-end')
  })

  it('리포트 화면에서는 읽는 법을 알려 준다', () => {
    expect(key({ phase: 'report' })).toBe('report-read')
  })
})

describe('hintFor — 한 번에 하나', () => {
  it('조건이 둘 다 맞아도 우선순위 위의 것만 나온다', () => {
    // 미선택이면 둘 다 조건이 맞지만 위의 것만 나온다
    expect(key({ interviewerPicked: false })).toBe('pick-interviewer')
  })

  it('본 키는 건너뛰고 다음 순위가 나온다', () => {
    expect(key({ interviewerPicked: false, seen: ['pick-interviewer'] })).toBe('go-prepare')
  })

  it('그 화면 것을 전부 봤으면 아무것도 안 뜬다', () => {
    expect(key({ interviewerPicked: false, seen: ['pick-interviewer', 'go-prepare'] })).toBeNull()
  })

  it('끄면 조건과 무관하게 아무것도 안 뜬다', () => {
    expect(key({ interviewerPicked: false, enabled: false })).toBeNull()
  })

  it('다른 화면의 힌트는 넘어오지 않는다', () => {
    // 준비 화면 조건을 전부 켜 두어도 면접 화면에서는 안 뜬다
    expect(
      key({ phase: 'interview', profileDone: false, canStart: true, stage: 'thinking' }),
    ).toBeNull()
  })
})

describe('hintFor — 방해하지 않는다', () => {
  it.each(['idle', 'thinking', 'speaking', 'listening'] as const)(
    '%s 중에는 면접 힌트가 안 뜬다',
    (stage) => {
      expect(key({ phase: 'interview', stage })).toBeNull()
      expect(key({ phase: 'interview', stage, answered: true })).toBeNull()
    },
  )
})

describe('HINTS', () => {
  it('키가 겹치지 않는다', () => {
    expect(new Set(HINTS.map((h) => h.key)).size).toBe(HINTS.length)
  })

  it('문구가 비어 있지 않다', () => {
    for (const h of HINTS) expect(h.text.length).toBeGreaterThan(0)
  })
})

describe('HINTS — 가리킬 대상', () => {
  it('모든 힌트가 누를 곳이나 쓸 곳을 가리킨다', () => {
    for (const h of HINTS) {
      expect(h.target, h.key).toBeTruthy()
      expect(['click', 'type'], h.key).toContain(h.kind)
    }
  })
})

describe('pointerSpot — 커서를 둘 자리', () => {
  const r = (top: number, left: number, w = 120, h = 48) => ({ top, left, width: w, height: h })

  it('기본은 대상 바로 아래 가운데', () => {
    const s = pointerSpot(r(100, 200), 1000, 800)
    expect(s.above).toBe(false)
    expect(s.y).toBeGreaterThan(148) // 대상 아래
    expect(s.x).toBeGreaterThan(200)
    expect(s.x).toBeLessThan(320)
  })

  it('아래가 화면 밖이면 위로 올린다', () => {
    const s = pointerSpot(r(730, 200), 1000, 800)
    expect(s.above).toBe(true)
    expect(s.y).toBeLessThan(730)
  })

  it('쓰는 곳은 입력칸 안쪽 오른쪽 — 칸 밖에 두면 아래 본문 글자를 덮는다', () => {
    const box = r(100, 200, 900, 52)
    const s = pointerSpot(box, 1000, 800, 'inside')
    expect(s.above).toBe(false)
    // 칸의 세로 한가운데, 오른쪽 테두리 안쪽
    expect(s.y).toBeGreaterThan(100)
    expect(s.y + POINTER.h).toBeLessThan(152)
    expect(s.x + POINTER.w).toBeLessThan(1100)
    expect(s.x).toBeGreaterThan(1000 - 60)
  })

  it('화면 왼쪽 끝 대상도 커서가 잘리지 않는다', () => {
    const s = pointerSpot(r(100, 0, 20), 1000, 800)
    expect(s.x).toBeGreaterThanOrEqual(0)
  })

  it('화면 오른쪽 끝 대상도 커서가 잘리지 않는다', () => {
    const s = pointerSpot(r(100, 990, 20), 1000, 800)
    expect(s.x + POINTER.w).toBeLessThanOrEqual(1000)
  })

  it('위아래 둘 다 좁으면 화면 안에 머문다', () => {
    const s = pointerSpot(r(0, 200, 120, 200), 1000, 200)
    expect(s.y).toBeGreaterThanOrEqual(0)
    expect(s.y + POINTER.h).toBeLessThanOrEqual(200)
  })
})

describe('needsScroll — 대상이 화면 밖인가', () => {
  it('화면 한가운데면 스크롤하지 않는다', () => {
    expect(needsScroll({ top: 300, height: 40 }, 800)).toBe(false)
  })

  it('위로 벗어났으면 스크롤한다', () => {
    expect(needsScroll({ top: -20, height: 40 }, 800)).toBe(true)
  })

  it('아래로 벗어났으면 스크롤한다', () => {
    expect(needsScroll({ top: 790, height: 40 }, 800)).toBe(true)
  })

  it('가장자리에 아슬아슬하면 스크롤한다 — 커서 자리도 있어야 한다', () => {
    expect(needsScroll({ top: 760, height: 40 }, 800)).toBe(true)
  })
})
