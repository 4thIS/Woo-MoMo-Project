import { describe, expect, it } from 'vitest'
import { formatBytes, formatGB, formatSize } from './format'

describe('format', () => {
  it('formatGB는 소수 첫째 자리 GB', () => {
    expect(formatGB(2969059328)).toBe('약 2.8GB') // 1024 기준(GiB)
    expect(formatGB(2008432640)).toBe('약 1.9GB')
  })
  it('formatSize는 1GiB 이상이면 GB, 아니면 MB (동의 창 표기 공용)', () => {
    expect(formatSize(2969059328)).toBe('약 2.8GB')
    expect(formatSize(398653257)).toBe('약 380MB') // Supertonic 3 합계, MiB 기준
    expect(formatSize(2969059328 + 398653257)).toBe('약 3.1GB')
  })
  it('formatBytes는 단위 자동', () => {
    expect(formatBytes(1_220_000_000)).toBe('1.14 GB')
    expect(formatBytes(512 * 1024)).toBe('512.0 KB')
  })
})
