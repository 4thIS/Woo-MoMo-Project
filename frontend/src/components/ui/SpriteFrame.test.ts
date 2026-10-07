import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SpriteFrame from './SpriteFrame.vue'

const styleOf = (props: { frameW: number; frameH: number; frames: number; scale: number }) =>
  (
    mount(SpriteFrame, { props: { src: '/s.png', ...props } }).find('.sprite')
      .element as HTMLElement
  ).style

describe('SpriteFrame', () => {
  it('보이는 크기는 frameW·frameH × scale이고, 시트 전체를 frames칸 크기로 늘린다 — 원본 픽셀 크기(32·64)와 무관', () => {
    const st = styleOf({ frameW: 64, frameH: 64, frames: 15, scale: 3 })
    expect([st.width, st.height]).toEqual(['192px', '192px'])
    expect(st.backgroundSize).toBe('2880px 192px')
    expect(st.backgroundPosition).toBe('0px 0px') // 첫 프레임
  })
  it('같은 화면 크기는 같은 결과: 32 × 6 과 64 × 3', () => {
    const a = styleOf({ frameW: 32, frameH: 32, frames: 10, scale: 6 })
    const b = styleOf({ frameW: 64, frameH: 64, frames: 10, scale: 3 })
    expect([a.width, a.height, a.backgroundSize]).toEqual([b.width, b.height, b.backgroundSize])
  })
})
