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
  muted: false,
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
  it('경과 시계를 mm:ss로 보여 준다 (질문 번호는 여전히 없다)', () => {
    const w = mount(InterviewStage, { props: { ...base, elapsedMs: 754_000 } })
    expect(w.find('[data-test="clock"]').text()).toBe('12:34')
    expect(w.text()).not.toMatch(/질문\s*\d|\d\s*\/\s*\d|남은/)
  })
  it('음소거 토글: 켜짐이면 aria-pressed=false, 클릭하면 toggle-mute', async () => {
    const w = mount(InterviewStage, { props: base })
    const btn = w.find('[data-test="mute"]')
    expect(btn.attributes('aria-pressed')).toBe('false')
    expect(btn.classes()).toContain('press')
    await btn.trigger('click')
    expect(w.emitted('toggle-mute')).toHaveLength(1)
    await w.setProps({ muted: true })
    expect(w.find('[data-test="mute"]').attributes('aria-pressed')).toBe('true')
  })
  it('경고 한 줄은 말풍선 아래에만, 없으면 렌더하지 않는다', async () => {
    const w = mount(InterviewStage, { props: base })
    expect(w.find('[data-test="tts-warning"]').exists()).toBe(false)
    await w.setProps({ warning: '음성을 만들지 못했습니다' })
    expect(w.find('[data-test="tts-warning"]').text()).toBe('음성을 만들지 못했습니다')
  })
  it('생성 중(thinking)엔 말풍선이 …', () => {
    const w = mount(InterviewStage, { props: { ...base, stage: 'thinking', bubble: '' } })
    expect(w.find('.bubble').text()).toBe('…')
  })
})

describe('InterviewStage 1회 재생', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  const srcOf = (w: ReturnType<typeof mount>, char: string) =>
    (w.find(`[data-char="${char}"]`).element as HTMLElement).style.backgroundImage

  it('좋은 답변: 셋이 동시에 1회 동작하고 가운데 끄덕임이 끝나면 react-done', async () => {
    const w = mount(InterviewStage, { props: base })
    await w.setProps({ reactPending: true })
    expect(srcOf(w, 'left')).toContain('left_pageflip')
    expect(srcOf(w, 'center')).toContain('center_nod')
    expect(srcOf(w, 'right')).toContain('right_writing')
    vi.advanceTimersByTime(11 * 125 + 50) // 11f @ 8fps
    await w.vm.$nextTick()
    expect(w.emitted('react-done')).toHaveLength(1)
    expect(srcOf(w, 'center')).toContain('center_idle')
  })

  it('답변 지연: 1회차 가운데 시계, 2회차 서기 펜 톡톡', async () => {
    const w = mount(InterviewStage, { props: base })
    await w.setProps({ watchTick: 1 })
    expect(srcOf(w, 'center')).toContain('center_watch')
    vi.advanceTimersByTime(10 * 125 + 50)
    await w.vm.$nextTick()
    expect(srcOf(w, 'center')).toContain('center_idle')
    await w.setProps({ watchTick: 2 })
    expect(srcOf(w, 'right')).toContain('right_pentap')
  })

  it('watch 중에 react가 와도 둘 다 끝나고 react-done이 나간다', async () => {
    const w = mount(InterviewStage, { props: base })
    await w.setProps({ watchTick: 1 })
    await w.setProps({ reactPending: true })
    vi.advanceTimersByTime(2000)
    await w.vm.$nextTick()
    expect(w.emitted('react-done')).toHaveLength(1)
    const srcs = w.findAll('.sprite').map((el) => (el.element as HTMLElement).style.backgroundImage)
    expect(srcs.some((s) => s.includes('center_nod') || s.includes('center_watch'))).toBe(false)
  })

  it('react 중에 watch가 와도 react-done은 나간다 (시계는 서기 펜 톡톡으로 대체)', async () => {
    const w = mount(InterviewStage, { props: base })
    await w.setProps({ reactPending: true })
    await w.setProps({ watchTick: 1 })
    expect(srcOf(w, 'center')).toContain('center_nod')
    expect(srcOf(w, 'right')).toContain('right_pentap')
    vi.advanceTimersByTime(2000)
    await w.vm.$nextTick()
    expect(w.emitted('react-done')).toHaveLength(1)
  })

  it('질문 중엔 가운데가 질문 제스처를 반복한다', () => {
    const w = mount(InterviewStage, { props: { ...base, stage: 'speaking' } })
    expect(srcOf(w, 'center')).toContain('center_question')
  })

  it('듣는 중엔 서기가 잔동작(필기)을 무작위 간격으로 한다', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0) // 최소 간격, 첫 후보
    const w = mount(InterviewStage, { props: { ...base, stage: 'listening' } })
    expect(srcOf(w, 'right')).toContain('right_idle')
    vi.advanceTimersByTime(5_000 + 10)
    await w.vm.$nextTick()
    expect(srcOf(w, 'right')).toContain('right_writing')
    vi.restoreAllMocks()
  })
})
