import { describe, expect, it } from 'vitest'
import { fmtDate, fmtDateTime, fmtDelta, fmtText } from './format'

describe('관리자 시각 표시 (KST)', () => {
  it('UTC 15:30은 한국 시간으로 다음 날 00:30', () => {
    expect(fmtDateTime('2026-10-16T15:30:00Z')).toBe('2026-10-17 00:30')
    expect(fmtDate('2026-10-16T15:30:00Z')).toBe('2026-10-17')
  })
  it('KST 자정 직전(UTC 14:59)은 같은 날', () => {
    expect(fmtDateTime('2026-10-16T14:59:00Z')).toBe('2026-10-16 23:59')
    expect(fmtDate('2026-10-16T14:59:00Z')).toBe('2026-10-16')
  })
  it('시간대 표기가 있는 값도 변환한다', () => {
    expect(fmtDateTime('2026-10-16T15:30:00+00:00')).toBe('2026-10-17 00:30')
  })
  it('날짜만 있는 문자열은 그대로', () => {
    expect(fmtDate('2026-10-16')).toBe('2026-10-16')
    expect(fmtDateTime('2026-10-16')).toBe('2026-10-16')
  })
  it('null은 —', () => {
    expect(fmtDate(null)).toBe('—')
    expect(fmtDateTime(null)).toBe('—')
    expect(fmtText(null)).toBe('—')
    expect(fmtDelta(null)).toBe('—')
    expect(fmtDelta(3)).toBe('+3')
    expect(fmtDelta(-2)).toBe('-2')
  })
})
