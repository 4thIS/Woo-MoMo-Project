import { describe, it, expect } from 'vitest'
import { PLAN_TIERS, PLAN_FEATURES, litCount, planKeyOf, type PlanKey } from './plans'

const KEYS: PlanKey[] = ['guest', 'member', 'premium']

describe('등급', () => {
  it('비로그인·로그인·프리미엄 셋이다', () => {
    expect(PLAN_TIERS.map((t) => t.key)).toEqual(KEYS)
  })

  it('모든 등급에 이름과 가격이 적혀 있다 — 요금표인데 가격이 없으면 안 된다', () => {
    for (const t of PLAN_TIERS) {
      expect(t.label.length, t.key).toBeGreaterThan(0)
      expect(t.price.length, t.key).toBeGreaterThan(0)
    }
  })
})

describe('기능 목록', () => {
  it('모든 기능이 세 등급 모두에 켬/끔을 정해 둔다', () => {
    for (const f of PLAN_FEATURES) {
      expect(f.label.length).toBeGreaterThan(0)
      for (const k of KEYS) expect(typeof f.on[k], `${f.label}/${k}`).toBe('boolean')
    }
  })

  it('이름이 겹치지 않는다', () => {
    expect(new Set(PLAN_FEATURES.map((f) => f.label)).size).toBe(PLAN_FEATURES.length)
  })

  it('등급은 겹겹이 쌓인다 — 아래에서 되는 것은 위에서도 된다', () => {
    for (const f of PLAN_FEATURES) {
      if (f.on.guest) expect(f.on.member, `${f.label}: guest만 되고 member는 안 됨`).toBe(true)
      if (f.on.member) expect(f.on.premium, `${f.label}: member만 되고 premium은 안 됨`).toBe(true)
    }
  })

  it('프리미엄은 전부 켜진다', () => {
    expect(PLAN_FEATURES.every((f) => f.on.premium)).toBe(true)
  })

  it('켜진 것에는 곁들이는 설명이 있다 — 켜졌는데 빈칸이면 뭐가 되는지 모른다', () => {
    for (const f of PLAN_FEATURES)
      for (const k of KEYS) if (f.on[k]) expect(f.note[k], `${f.label}/${k}`).toBeTruthy()
  })

  it('프리미엄 전용은 벤·녹음·한도 셋이다', () => {
    const only = PLAN_FEATURES.filter((f) => f.on.premium && !f.on.member)
    expect(only).toHaveLength(3)
    expect(only.some((f) => f.label.includes('벤'))).toBe(true)
    expect(only.some((f) => f.label.includes('녹음'))).toBe(true)
  })
})

describe('litCount — 몇 개가 켜지나', () => {
  it('등급이 올라갈수록 는다', () => {
    expect(litCount('guest')).toBeLessThan(litCount('member'))
    expect(litCount('member')).toBeLessThan(litCount('premium'))
  })

  it('프리미엄은 전부다', () => {
    expect(litCount('premium')).toBe(PLAN_FEATURES.length)
  })

  it('비로그인은 면접을 보고 리포트를 받는 둘이다', () => {
    expect(litCount('guest')).toBe(2)
  })
})

describe('planKeyOf — 지금 내 칸', () => {
  it('비로그인은 guest', () => {
    expect(planKeyOf(null)).toBe('guest')
  })
  it('로그인은 member', () => {
    expect(planKeyOf('member')).toBe('member')
  })
  it('프리미엄은 premium', () => {
    expect(planKeyOf('premium')).toBe('premium')
  })
})
