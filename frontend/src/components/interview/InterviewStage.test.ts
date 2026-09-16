import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import InterviewStage from './InterviewStage.vue'

const base = {
  stage: 'waiting' as const,
  bubble: '자기소개를 해주세요.',
  streaming: false,
  reactPending: false,
  watchTick: 0,
  fieldLabel: 'IT',
  job: '백엔드',
}

describe('InterviewStage', () => {
  it('말풍선·분야·직무를 표시하고 질문 번호는 없다', () => {
    const w = mount(InterviewStage, { props: base })
    expect(w.text()).toContain('자기소개를 해주세요.')
    expect(w.text()).toContain('IT')
    expect(w.text()).toContain('백엔드')
    expect(w.text()).not.toMatch(/질문\s*\d|\d\s*\/\s*\d|남은/)
  })
  it('면접 종료 버튼은 end를 emit한다', async () => {
    const w = mount(InterviewStage, { props: base })
    await w.find('[data-test="end"]').trigger('click')
    expect(w.emitted('end')).toHaveLength(1)
  })
  it('스프라이트 3장 + 지원자 정수리', () => {
    const w = mount(InterviewStage, { props: base })
    expect(w.findAll('.sprite').length).toBe(4)
  })
})

describe('InterviewStage 1회 재생', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('watch 중에 react가 와도 둘 다 끝나고 react-done이 나간다', async () => {
    const w = mount(InterviewStage, { props: base })
    await w.setProps({ watchTick: 1 })
    await w.setProps({ reactPending: true })
    vi.advanceTimersByTime(2000)
    await w.vm.$nextTick()
    expect(w.emitted('react-done')).toHaveLength(1)
    // 둘 다 끝났으면 기본 idle 시트로 돌아온다
    const srcs = w.findAll('.sprite').map((el) => (el.element as HTMLElement).style.backgroundImage)
    expect(srcs.some((s) => s.includes('center_react') || s.includes('center_watch'))).toBe(false)
  })

  it('react 중에 watch가 와도 react-done은 나간다', async () => {
    const w = mount(InterviewStage, { props: base })
    await w.setProps({ reactPending: true })
    await w.setProps({ watchTick: 1 })
    vi.advanceTimersByTime(2000)
    await w.vm.$nextTick()
    expect(w.emitted('react-done')).toHaveLength(1)
  })
})
