import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PixelProgress from './PixelProgress.vue'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  )
  vi.stubGlobal('requestAnimationFrame', vi.fn())
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never
})
afterEach(() => vi.unstubAllGlobals())

const base = {
  received: 1_220_000_000,
  total: 2_970_000_000,
  fileName: 'gemma4-e4b-it-web.litertlm',
}

describe('PixelProgress', () => {
  it('다운로드 중: 구간 문구와 퍼센트, 바 폭', () => {
    const w = mount(PixelProgress, {
      props: { ...base, progress: 41, phase: 'download', eta: '약 1분 30초 남음' },
    })
    expect(w.text()).toContain('양복은 챙겼습니다')
    expect(w.text()).toContain('41%')
    expect(w.text()).toContain('1.14 GB / 2.77 GB')
    expect((w.find('.fill').element as HTMLElement).style.width).toBe('41%')
  })
  it('초기화 중 문구', () => {
    const w = mount(PixelProgress, { props: { ...base, progress: 100, phase: 'init' } })
    expect(w.text()).toContain('출근 완료 — 자리에 앉는 중')
  })
  it('준비 완료면 바가 ok', () => {
    const w = mount(PixelProgress, { props: { ...base, progress: 100, phase: 'ready' } })
    expect(w.text()).toContain('면접관이 자리에 앉았습니다')
    expect(w.find('.fill').classes()).toContain('ok')
  })
  it('오류면 danger + 문구 + actions 슬롯', () => {
    const w = mount(PixelProgress, {
      props: { ...base, progress: 12, phase: 'error', errorText: '연결이 끊겼습니다' },
      slots: { actions: '<button>다시 시도</button>' },
    })
    expect(w.find('.fill').classes()).toContain('danger')
    expect(w.text()).toContain('연결이 끊겼습니다')
    expect(w.find('button').text()).toBe('다시 시도')
  })
  it('기본 배율(scale=3)로 캔버스 크기를 정수 확대한다', () => {
    const w = mount(PixelProgress, { props: { ...base, progress: 41, phase: 'download' } })
    const el = w.find('canvas').element as HTMLElement
    expect(el.style.width).toBe('960px')
    expect(el.style.height).toBe('240px')
  })
  it('다운로드 중에는 actions 슬롯이 렌더되지 않는다', () => {
    const w = mount(PixelProgress, {
      props: { ...base, progress: 41, phase: 'download' },
      slots: { actions: '<button>다시 시도</button>' },
    })
    expect(w.find('button').exists()).toBe(false)
  })
})
