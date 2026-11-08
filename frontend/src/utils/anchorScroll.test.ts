import { beforeEach, describe, expect, it, vi } from 'vitest'
import { scrollToId } from './anchorScroll'

beforeEach(() => {
  document.body.innerHTML = ''
  location.hash = ''
})

/** id를 단 요소 하나를 문서에 두고, 그 scrollIntoView를 지켜본다 */
function target(id = 'q3') {
  const el = document.createElement('div')
  el.id = id
  el.scrollIntoView = vi.fn()
  document.body.appendChild(el)
  return el
}

describe('scrollToId', () => {
  it('그 id로 굴러간다', () => {
    const el = target()
    expect(scrollToId('q3')).toBe(true)
    expect(el.scrollIntoView).toHaveBeenCalled()
  })

  it('해시를 바꾸지 않는다 — 해시 이동은 popstate를 쏘고, 그 자리에 화면을 닫는 리스너가 있다', () => {
    target()
    scrollToId('q3')
    expect(location.hash).toBe('')
  })

  it('부드러운 스크롤을 쓰지 않는다 — 16문항 거리에서 멀미가 난다', () => {
    const el = target()
    scrollToId('q3')
    const arg = vi.mocked(el.scrollIntoView).mock.calls[0][0] as ScrollIntoViewOptions | undefined
    expect(arg?.behavior).not.toBe('smooth')
  })

  it('없는 id면 false를 돌려주고 아무 일도 하지 않는다', () => {
    expect(scrollToId('없다')).toBe(false)
  })
})
