import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BarChart from './BarChart.vue'

describe('BarChart', () => {
  it('항목마다 막대 하나, 값은 title로 읽힌다', () => {
    const w = mount(BarChart, {
      props: {
        items: [
          { label: '10-01', value: 1 },
          { label: '10-02', value: 4 },
        ],
        format: (n: number) => `${n}건`,
      },
    })
    const bars = w.findAll('[data-test=chart-bar]')
    expect(bars).toHaveLength(2)
    expect(bars[1]!.find('title').text()).toBe('10-02: 4건')
  })

  it('값이 모두 0이거나 비면 기록 없음', () => {
    const zero = mount(BarChart, { props: { items: [{ label: 'a', value: 0 }] } })
    expect(zero.get('[data-test=chart-empty]').text()).toBe('기록 없음')
    expect(zero.find('svg').exists()).toBe(false)
    const none = mount(BarChart, { props: { items: [] } })
    expect(none.text()).toBe('기록 없음')
  })
})
