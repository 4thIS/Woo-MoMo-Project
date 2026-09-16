import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChoiceMenu from './ChoiceMenu.vue'

const items = [
  { value: 'yes', label: '네' },
  { value: 'no', label: '아니요' },
]

describe('ChoiceMenu', () => {
  it('클릭으로 선택하고 update:modelValue를 낸다', async () => {
    const w = mount(ChoiceMenu, { props: { items, modelValue: null } })
    await w.findAll('[role=radio]')[1].trigger('click')
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['no'])
  })
  it('모든 항목에 커서 자리가 있고(고를 수 있음을 알림), 선택된 항목만 on', () => {
    const w = mount(ChoiceMenu, { props: { items, modelValue: 'yes' } })
    const radios = w.findAll('[role=radio]')
    expect(radios[0].find('svg').exists()).toBe(true)
    expect(radios[1].find('svg').exists()).toBe(true)
    expect(radios[0].classes()).toContain('on')
    expect(radios[1].classes()).not.toContain('on')
    expect(radios[0].attributes('aria-checked')).toBe('true')
  })
  it('ArrowDown은 다음 항목을 선택한다', async () => {
    const w = mount(ChoiceMenu, { props: { items, modelValue: 'yes' } })
    await w.find('[role=radiogroup]').trigger('keydown', { key: 'ArrowDown' })
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['no'])
  })
  it('disabled면 아무것도 내지 않는다', async () => {
    const w = mount(ChoiceMenu, { props: { items, modelValue: null, disabled: true } })
    await w.findAll('[role=radio]')[0].trigger('click')
    expect(w.emitted('update:modelValue')).toBeUndefined()
  })
  it('선택 없음에서 ArrowUp은 마지막 값을 낸다', async () => {
    const w = mount(ChoiceMenu, { props: { items, modelValue: null } })
    await w.find('[role=radiogroup]').trigger('keydown', { key: 'ArrowUp' })
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['no'])
  })
  it('ArrowDown은 마지막 항목에서 처음으로 순환한다', async () => {
    const w = mount(ChoiceMenu, { props: { items, modelValue: 'no' } })
    await w.find('[role=radiogroup]').trigger('keydown', { key: 'ArrowDown' })
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['yes'])
  })
  it('ArrowUp은 첫 항목에서 마지막으로 순환한다', async () => {
    const w = mount(ChoiceMenu, { props: { items, modelValue: 'yes' } })
    await w.find('[role=radiogroup]').trigger('keydown', { key: 'ArrowUp' })
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['no'])
  })
  it('선택된 라디오만 tabindex 0이다', () => {
    const w = mount(ChoiceMenu, { props: { items, modelValue: 'yes' } })
    const radios = w.findAll('[role=radio]')
    expect(radios[0].attributes('tabindex')).toBe('0')
    expect(radios[1].attributes('tabindex')).toBe('-1')
  })
})
