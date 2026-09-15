import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useSectionWheel } from './useSectionWheel'

function setup() {
  const scrolls: number[] = []
  const Comp = defineComponent({
    setup() {
      const root = ref<HTMLElement | null>(null)
      useSectionWheel(root)
      return () =>
        h(
          'div',
          { ref: root, class: 'snap-root' },
          [0, 1, 2].map((i) => h('section', { class: 'snap', 'data-i': i })),
        )
    },
  })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const w = mount(Comp, { attachTo: document.body })
  const el = w.element as HTMLElement
  const sections = [...el.querySelectorAll<HTMLElement>('.snap')]
  sections.forEach((s, i) => {
    Object.defineProperty(s, 'offsetTop', { value: i * 900 })
    s.scrollIntoView = () => scrolls.push(i)
  })
  return { w, el, scrolls }
}

const wheel = (el: HTMLElement, deltaY: number) =>
  el.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }))

describe('useSectionWheel', () => {
  it('아래 휠 → 다음 섹션, 위 휠 → 이전 섹션 (부드러운 스크롤 중엔 무시)', () => {
    vi.useFakeTimers()
    const { el, scrolls } = setup()
    wheel(el, 100)
    wheel(el, 100) // 이동 중 → 무시
    expect(scrolls).toEqual([1])
    vi.advanceTimersByTime(800)
    el.scrollTop = 900
    wheel(el, -100)
    expect(scrolls).toEqual([1, 0])
    vi.useRealTimers()
  })

  it('첫 섹션에서 위로, 마지막에서 아래로는 아무 일도 없다', () => {
    const { el, scrolls } = setup()
    wheel(el, -100)
    expect(scrolls).toEqual([])
  })

  it('휠 기본 동작을 막는다', () => {
    const { el } = setup()
    const ev = new WheelEvent('wheel', { deltaY: 100, cancelable: true })
    el.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })
})
