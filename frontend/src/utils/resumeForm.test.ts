import { describe, expect, it } from 'vitest'
import { RESUME_FIELDS, composeResume } from './resumeForm'

describe('composeResume', () => {
  it('항목 순서대로 "라벨: 값" 줄을 만들고 빈 항목은 없음', () => {
    const text = composeResume({ name: ' 홍길동 ', age: '27', motive: '성장하고 싶어서' })
    const lines = text.split('\n')
    expect(lines).toHaveLength(RESUME_FIELDS.length)
    expect(lines[0]).toBe('이름: 홍길동')
    expect(lines[3]).toBe('자격증: 없음')
    expect(lines.at(-1)).toBe('지원동기: 성장하고 싶어서')
  })
  it('긴 항목은 500자 상한', () => {
    for (const f of RESUME_FIELDS.filter((f) => f.long)) expect(f.max).toBeLessThanOrEqual(500)
  })
})
