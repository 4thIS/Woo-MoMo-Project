import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkEnvironment } from './gpuCheck'

afterEach(() => vi.unstubAllGlobals())

describe('checkEnvironment', () => {
  it('WebGPU 없음', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ quota: 100, usage: 40 }) } })
    expect(await checkEnvironment()).toEqual({
      webgpu: false,
      webgpuReason: 'no-api',
      gpuName: null,
      storageFree: 60,
      touch: false,
    })
  })
  it('어댑터 이름과 여유 공간', async () => {
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: async () => ({ info: { vendor: 'intel', description: 'Intel Xe' } }) },
      storage: { estimate: async () => ({ quota: 10, usage: 3 }) },
    })
    expect(await checkEnvironment()).toEqual({
      webgpu: true,
      webgpuReason: null,
      gpuName: 'Intel Xe',
      storageFree: 7,
      touch: false,
    })
  })
  it('estimate 미지원이면 storageFree null', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({ info: {} }) } })
    expect((await checkEnvironment()).storageFree).toBeNull()
  })
  it('requestAdapter가 null이면 WebGPU 없음 — 원인은 no-adapter(가속 꺼짐 등)', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => null } })
    const env = await checkEnvironment()
    expect(env.webgpu).toBe(false)
    expect(env.webgpuReason).toBe('no-adapter')
  })
})

describe('checkEnvironment — 손으로 만지는 기기인지', () => {
  it('coarse 포인터면 touch true', async () => {
    vi.stubGlobal('navigator', { gpu: undefined, maxTouchPoints: 5 })
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('coarse') }))
    expect((await checkEnvironment()).touch).toBe(true)
  })

  it('마우스뿐인 데스크톱은 touch false', async () => {
    vi.stubGlobal('navigator', { gpu: undefined, maxTouchPoints: 0 })
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect((await checkEnvironment()).touch).toBe(false)
  })

  it('matchMedia가 없어도 던지지 않는다', async () => {
    vi.stubGlobal('navigator', { gpu: undefined, maxTouchPoints: 0 })
    vi.stubGlobal('matchMedia', undefined)
    expect((await checkEnvironment()).touch).toBe(false)
  })
})
