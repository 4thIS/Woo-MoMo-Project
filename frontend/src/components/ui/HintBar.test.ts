import { describe, it, expect, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import HintBar from './HintBar.vue'
import { useHintsStore } from '@/stores/hints'
import { useInterviewStore } from '@/stores/interview'
import { useInterviewerStore } from '@/stores/interviewer'

const bar = () => mount(HintBar, { global: { plugins: [createPinia()] } })

describe('HintBar', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('랜딩에서 면접관을 안 골랐으면 그 힌트를 보여 준다', () => {
    const w = bar()
    expect(w.get('[data-test="hint"]').text()).toContain('면접관을 고르세요')
  })

  it('확인을 누르면 사라지고 본 것으로 기록된다', async () => {
    const w = bar()
    await w.get('[data-test="hint-ok"]').trigger('click')
    expect(w.find('[data-test="hint"]').exists()).toBe(false)
    expect(useHintsStore().seen).toContain('pick-interviewer')
  })

  it('확인한 뒤 상황이 그대로면 다음 힌트가 바로 튀어나오지 않는다', async () => {
    const w = bar()
    await w.get('[data-test="hint-ok"]').trigger('click')
    expect(w.find('[data-test="hint"]').exists()).toBe(false)
    // 상황이 바뀌면 그때 다시 말을 건다
    useInterviewerStore().select('m1')
    await w.vm.$nextTick()
    expect(w.get('[data-test="hint"]').text()).toContain('장비 확인')
  })

  it('그만 보기를 누르면 전부 꺼진다', async () => {
    const w = bar()
    await w.get('[data-test="hint-off"]').trigger('click')
    expect(useHintsStore().enabled).toBe(false)
    expect(w.find('[data-test="hint"]').exists()).toBe(false)
  })

  it('꺼져 있으면 아무것도 그리지 않는다', () => {
    useHintsStore().disable()
    expect(bar().find('[data-test="hint"]').exists()).toBe(false)
  })

  it('화면이 바뀌면 그 화면의 힌트로 바뀐다', async () => {
    const w = bar()
    const s = useInterviewStore()
    useInterviewerStore().select('m1')
    s.phase = 'report'
    await w.vm.$nextTick()
    expect(w.get('[data-test="hint"]').text()).toContain('PDF로 저장')
  })

  it('면접관을 고르면 다음 할 일로 바뀐다', async () => {
    const w = bar()
    useInterviewerStore().select('m1')
    await w.vm.$nextTick()
    expect(w.get('[data-test="hint"]').text()).toContain('장비 확인')
  })

  it('면접 중 면접관이 말하는 동안에는 말을 걸지 않는다', async () => {
    const w = bar()
    const s = useInterviewStore()
    s.phase = 'interview'
    s.stage = 'speaking'
    await w.vm.$nextTick()
    expect(w.find('[data-test="hint"]').exists()).toBe(false)
    s.stage = 'waiting'
    await w.vm.$nextTick()
    expect(w.get('[data-test="hint"]').text()).toContain('말하기')
  })
})

describe('자리 비움은 힌트가 드나들 때마다 출렁이지 않는다', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    document.documentElement.style.removeProperty('--hint-space')
  })

  it('힌트가 사라져도 켜져 있는 동안은 자리를 유지한다', async () => {
    const hints = useHintsStore()
    const w = bar()
    await flushPromises()
    expect(document.documentElement.style.getPropertyValue('--hint-space')).not.toBe('0px')
    const kept = document.documentElement.style.getPropertyValue('--hint-space')
    // 확인을 눌러 힌트를 닫는다 — 면접 화면이 그때마다 늘었다 줄면 안 된다
    await w.find('[data-test=hint-ok]').trigger('click')
    await flushPromises()
    expect(w.find('[data-test=hint]').exists()).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--hint-space')).toBe(kept)
    expect(hints.enabled).toBe(true)
  })

  it('그만 보기를 누르면 자리를 돌려준다', async () => {
    const w = bar()
    await flushPromises()
    await w.find('[data-test=hint-off]').trigger('click')
    await flushPromises()
    expect(document.documentElement.style.getPropertyValue('--hint-space')).toBe('0px')
  })
})
