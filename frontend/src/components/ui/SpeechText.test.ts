import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SpeechText from './SpeechText.vue'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('SpeechText', () => {
  it('30ms마다 한 글자씩 찍고 끝나면 done', async () => {
    const w = mount(SpeechText, { props: { text: '안녕' } })
    expect(w.text()).toBe('')
    await vi.advanceTimersByTimeAsync(30)
    expect(w.text()).toBe('안')
    await vi.advanceTimersByTimeAsync(30)
    expect(w.text()).toBe('안녕')
    expect(w.emitted('done')).toHaveLength(1)
  })
  it('문장부호 뒤에는 120ms 더 쉰다', async () => {
    const w = mount(SpeechText, { props: { text: '네. 가' } })
    await vi.advanceTimersByTimeAsync(60) // '네.'
    expect(w.text()).toBe('네.')
    await vi.advanceTimersByTimeAsync(30)
    expect(w.text()).toBe('네.') // 아직 쉬는 중
    await vi.advanceTimersByTimeAsync(150)
    expect(w.text()).toBe('네. 가')
  })
  it('typing=false면 즉시 전부', () => {
    expect(mount(SpeechText, { props: { text: '전부', typing: false } }).text()).toBe('전부')
  })
  it('reduced-motion이면 즉시 전부', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    )
    expect(mount(SpeechText, { props: { text: '전부' } }).text()).toBe('전부')
  })
})
