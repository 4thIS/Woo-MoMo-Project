import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PixelButton from './PixelButton.vue'

describe('PixelButton', () => {
  it('primary는 커서 아이콘을 보여준다', () => {
    const w = mount(PixelButton, { slots: { default: '시작' } })
    expect(w.find('svg').exists()).toBe(true)
    expect(w.text()).toContain('시작')
  })
  it('disabled면 커서를 숨기고 클릭을 막는다', async () => {
    const w = mount(PixelButton, { props: { disabled: true }, slots: { default: '시작' } })
    expect(w.find('svg').exists()).toBe(false)
    await w.trigger('click')
    expect(w.emitted('click')).toBeUndefined()
  })
  it('secondary는 커서가 없다', () => {
    const w = mount(PixelButton, { props: { variant: 'secondary' }, slots: { default: '취소' } })
    expect(w.find('svg').exists()).toBe(false)
  })
})
