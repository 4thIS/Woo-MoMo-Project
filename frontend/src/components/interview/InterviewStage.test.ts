import { describe, expect, it } from 'vitest'
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
