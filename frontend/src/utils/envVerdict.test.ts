import { describe, expect, it } from 'vitest'
import { isHandheld, verdict } from './envVerdict'

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

describe('isHandheld — 휴대폰·태블릿 (멘토링 보완)', () => {
  it('WebGPU가 없고 손으로 만지는 기기면 휴대폰으로 본다', () => {
    expect(isHandheld({ webgpu: false, touch: true })).toBe(true)
  })

  it('WebGPU가 되면 휴대폰이어도 막지 않는다 — 앞으로 모바일이 지원해도 코드를 안 고친다', () => {
    expect(isHandheld({ webgpu: true, touch: true })).toBe(false)
  })

  it('터치 없는 데스크톱은 WebGPU가 없어도 휴대폰이 아니다 — 가속 끈 PC다', () => {
    expect(isHandheld({ webgpu: false, touch: false })).toBe(false)
  })
})

describe('verdict — 서버가 답하는 면접관(벤)은 WebGPU를 안 본다 (멘토링 보완)', () => {
  const need = 3_000_000_000

  it('WebGPU가 없어도 통과한다 — 추론이 이 기기에서 일어나지 않는다', () => {
    expect(verdict({ webgpu: false, storageFree: need * 2 }, need, false)).toBe('ok')
  })

  it('저장 공간은 그래도 본다 — 목소리는 이 기기에 받는다', () => {
    expect(verdict({ webgpu: false, storageFree: need - 1 }, need, false)).toBe('no-space')
  })

  it('받을 게 없으면 공간도 안 막는다', () => {
    expect(verdict({ webgpu: false, storageFree: 0 }, 0, false)).toBe('ok')
  })

  it('기본값은 지금과 같다 — WebGPU가 필요하다고 본다', () => {
    expect(verdict({ webgpu: false, storageFree: need * 2 }, need)).toBe('no-webgpu')
  })
})
