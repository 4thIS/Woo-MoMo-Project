import { describe, expect, it } from 'vitest'
import { formatBytes, formatGB } from './format'

describe('format', () => {
  it('formatGB는 소수 첫째 자리 GB', () => {
    expect(formatGB(2969059328)).toBe('약 2.8GB') // 1024 기준(GiB)
    expect(formatGB(2008432640)).toBe('약 1.9GB')
  })
  it('formatBytes는 단위 자동', () => {
    expect(formatBytes(1_220_000_000)).toBe('1.14 GB')
    expect(formatBytes(512 * 1024)).toBe('512.0 KB')
  })
})
