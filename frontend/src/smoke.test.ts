import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import App from './App.vue'

vi.stubGlobal(
  'fetch',
  vi.fn(() => Promise.reject(new Error('offline'))),
)

describe('App', () => {
  it('처음엔 랜딩을 보여준다', () => {
    const w = mount(App, {
      global: { plugins: [createPinia()], stubs: { SpeechText: true, PixelProgress: true } },
    })
    expect(w.text()).toContain('모두의')
    expect(w.text()).toContain('모의면접')
  })
})
