import { describe, it, expect } from 'vitest'
import { hintFor, HINTS, type HintContext } from './hints'

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
