import { describe, expect, it } from 'vitest'
import { truncateResume } from './truncate'

describe('truncateResume', () => {
  it('앞뒤 공백을 정리하고 2000자에서 자른다', () => {
    const long = ' 가'.repeat(3000)
    expect(truncateResume(long)).toHaveLength(2000)
  })
  it('짧으면 그대로', () => {
    expect(truncateResume('안녕하세요')).toBe('안녕하세요')
  })
  it('연속 공백·개행은 하나로', () => {
    expect(truncateResume('a \n\n  b')).toBe('a b')
  })
})
