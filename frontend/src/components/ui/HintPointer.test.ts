import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import HintPointer from './HintPointer.vue'
import { POINTER, SCROLL_MARGIN } from '@/utils/hints'

/** jsdom은 레이아웃을 하지 않는다 — 대상의 자리를 직접 심어 준다 */
function target(id: string, box: { top: number; left: number; width: number; height: number }) {
  const el = document.createElement('button')
  el.dataset.test = id
  const rect = {
    ...box,
    bottom: box.top + box.height,
    right: box.left + box.width,
    x: box.left,
    y: box.top,
  }
  el.getBoundingClientRect = () => rect as DOMRect
  el.getClientRects = () => [rect] as unknown as DOMRectList
  el.scrollIntoView = vi.fn()
  document.body.appendChild(el)
  return el
}

/** rAF 한 바퀴를 돌려 커서가 자리를 잡게 한다 */
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))

beforeEach(() => {
  document.body.innerHTML = ''
  window.innerWidth = 1000
  window.innerHeight = 800
})
afterEach(() => vi.restoreAllMocks())

describe('HintPointer', () => {
  it('대상을 못 찾으면 아무것도 그리지 않는다', async () => {
    const w = mount(HintPointer, { props: { selector: '[data-test=nope]', kind: 'click' } })
    await frame()
    expect(w.find('[data-test=hint-pointer]').exists()).toBe(false)
  })

  it('대상 아래에 붙는다', async () => {
    target('start', { top: 300, left: 400, width: 120, height: 48 })
    const w = mount(HintPointer, { props: { selector: '[data-test=start]', kind: 'click' } })
    await frame()
    const style = w.get('[data-test=hint-pointer]').attributes('style')!
    expect(style).toContain(`top: ${300 + 48 + POINTER.gap}px`)
    expect(style).toContain(`left: ${400 + 60 - POINTER.w / 2}px`)
  })

  it('아래가 모자라면 위로 올라가 뒤집힌다', async () => {
    target('start', { top: 780, left: 400, width: 120, height: 48 })
    const w = mount(HintPointer, { props: { selector: '[data-test=start]', kind: 'click' } })
    await frame()
    expect(w.get('[data-test=hint-pointer]').classes()).toContain('flip')
  })

  it('쓰는 곳이면 키보드로 바뀐다', async () => {
    target('answer', { top: 300, left: 400, width: 120, height: 48 })
    const w = mount(HintPointer, { props: { selector: '[data-test=answer]', kind: 'type' } })
    await frame()
    expect(w.get('[data-test=hint-pointer]').classes()).toContain('key')
  })

  it('대상이 화면 밖이면 스크롤해 보여 준다', async () => {
    const el = target('start', { top: 1200, left: 400, width: 120, height: 48 })
    mount(HintPointer, { props: { selector: '[data-test=start]', kind: 'click' } })
    await frame()
    expect(el.scrollIntoView).toHaveBeenCalled()
  })

  it('화면 안에 잘 보이면 스크롤하지 않는다', async () => {
    const el = target('start', { top: 400, left: 400, width: 120, height: 48 })
    mount(HintPointer, { props: { selector: '[data-test=start]', kind: 'click' } })
    await frame()
    expect(el.scrollIntoView).not.toHaveBeenCalled()
  })

  it('가장자리에 붙어 커서 자리가 없으면 스크롤한다', async () => {
    const el = target('start', { top: 800 - SCROLL_MARGIN, left: 400, width: 120, height: 48 })
    mount(HintPointer, { props: { selector: '[data-test=start]', kind: 'click' } })
    await frame()
    expect(el.scrollIntoView).toHaveBeenCalled()
  })

  it('선택자에 여럿 걸리면 실제로 보이는 것을 고른다', async () => {
    const hidden = document.createElement('button')
    hidden.dataset.test = 'go-prepare'
    hidden.getClientRects = () => [] as unknown as DOMRectList // 숨겨져 있다
    document.body.appendChild(hidden)
    target('consent', { top: 200, left: 100, width: 200, height: 60 })
    const w = mount(HintPointer, {
      props: { selector: '[data-test=go-prepare], [data-test=consent]', kind: 'click' },
    })
    await frame()
    expect(w.get('[data-test=hint-pointer]').attributes('style')).toContain(
      `top: ${200 + 60 + POINTER.gap}px`,
    )
  })

  it('대상이 움직이면 커서가 따라간다', async () => {
    const el = target('start', { top: 300, left: 400, width: 120, height: 48 })
    const w = mount(HintPointer, { props: { selector: '[data-test=start]', kind: 'click' } })
    await frame()
    const moved = {
      top: 500,
      left: 400,
      width: 120,
      height: 48,
      bottom: 548,
      right: 520,
      x: 400,
      y: 500,
    }
    el.getBoundingClientRect = () => moved as DOMRect
    el.getClientRects = () => [moved] as unknown as DOMRectList
    await frame()
    expect(w.get('[data-test=hint-pointer]').attributes('style')).toContain(
      `top: ${500 + 48 + POINTER.gap}px`,
    )
  })
})
