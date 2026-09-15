import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StatCard from './StatCard.vue'

describe('StatCard', () => {
  it('state 변경에 반응해 게이지가 다시 채워진다', async () => {
    const w = mount(StatCard, { props: { label: 'WebGPU', value: '확인 중', state: 'pending' } })
    expect(w.findAll('.gauge i.on')).toHaveLength(0)

    await w.setProps({ state: 'ok' })
    expect(w.findAll('.gauge i.on')).toHaveLength(3)

    await w.setProps({ state: 'fail' })
    expect(w.findAll('.gauge i.on')).toHaveLength(1)
    expect(w.find('.gauge').classes()).toContain('fail')
  })
})
