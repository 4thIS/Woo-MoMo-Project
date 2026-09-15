import { describe, expect, it } from 'vitest'
import { verdict } from './envVerdict'

describe('verdict', () => {
  const need = 3_000_000_000
  it('WebGPU 없음이 최우선', () => {
    expect(verdict({ webgpu: false, storageFree: 0 }, need)).toBe('no-webgpu')
  })
  it('공간 부족', () => {
    expect(verdict({ webgpu: true, storageFree: need - 1 }, need)).toBe('no-space')
  })
  it('공간을 알 수 없으면 통과시킨다 (estimate 미지원 브라우저)', () => {
    expect(verdict({ webgpu: true, storageFree: null }, need)).toBe('ok')
  })
  it('통과', () => {
    expect(verdict({ webgpu: true, storageFree: need * 2 }, need)).toBe('ok')
  })
})
