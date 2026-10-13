import { describe, it, expect } from 'vitest'
import { PLAN_ROWS, PLAN_COLUMNS, planKeyOf } from './plans'

describe('등급 비교표', () => {
  it('칸은 비로그인·로그인·프리미엄 셋이다', () => {
    expect(PLAN_COLUMNS.map((c) => c.key)).toEqual(['guest', 'member', 'premium'])
  })

  it('모든 줄이 세 칸을 다 채운다', () => {
    for (const r of PLAN_ROWS) {
      expect(r.label.length, r.label).toBeGreaterThan(0)
      for (const c of PLAN_COLUMNS) expect(r.cells[c.key], `${r.label}/${c.key}`).toBeTruthy()
    }
  })

  it('프리미엄 면접관은 프리미엄에서만 된다', () => {
    const row = PLAN_ROWS.find((r) => r.label.includes('벤'))!
    expect(row.cells.guest).toBe('—')
    expect(row.cells.member).toBe('—')
    expect(row.cells.premium).toContain('10')
  })

  it('보관함 한도가 등급마다 다르게 적힌다', () => {
    const row = PLAN_ROWS.find((r) => r.label.includes('보관함'))!
    expect(row.cells.guest).toBe('—')
    expect(row.cells.member).toContain('5')
    expect(row.cells.premium).toContain('제외')
  })

  it('줄이 겹치지 않는다', () => {
    expect(new Set(PLAN_ROWS.map((r) => r.label)).size).toBe(PLAN_ROWS.length)
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
