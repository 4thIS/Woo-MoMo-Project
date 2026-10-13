import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { LEGACY_CENTER, LEGACY_SIDE, interviewerById } from '@/interviewers'
import InterviewStage from './InterviewStage.vue'

const base = {
  stage: 'waiting' as const,
  bubble: '자기소개를 해주세요.',
  streaming: false,
  watchTick: 0,
  fieldLabel: 'IT',
  job: '백엔드',
  muted: false,
  voice: true,
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
  it('세 자리 모두 92 프레임 × 2 = 184px — 시트 전체를 늘려 그린다(지원자는 32 × 6 = 192px 그대로)', () => {
    const w = mount(InterviewStage, { props: base })
    for (const c of ['left', 'center', 'right']) {
      const st = (w.find(`[data-char="${c}"]`).element as HTMLElement).style
      expect([st.width, st.height], c).toEqual(['184px', '184px'])
    }
    // 배석자 left_idle 16프레임(manifest) → 시트 전체 92 × 16 × 2 = 2944px
    const left = (w.find('[data-char="left"]').element as HTMLElement).style
    expect(left.backgroundSize).toBe('2944px 184px')
    const cand = (w.find('.candidate .sprite').element as HTMLElement).style
    expect([cand.width, cand.height]).toEqual(['192px', '192px'])
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
  it('voice=false(텍스트 전용)면 음소거 토글과 합성 음성 안내가 없다 (#34·#36)', () => {
    const w = mount(InterviewStage, { props: { ...base, voice: false } })
    expect(w.find('[data-test="mute"]').exists()).toBe(false)
    expect(w.find('[data-test="ai-voice"]').exists()).toBe(false)
  })
  it('voice=true면 음소거 상태와 무관하게 AI 합성 음성 안내가 항상 보인다 (#34)', async () => {
    const w = mount(InterviewStage, { props: { ...base, voice: true } })
    expect(w.find('[data-test="ai-voice"]').text()).toContain('AI로 합성한 목소리')
    expect(w.find('[data-test="ai-voice"]').text()).toContain('Supertonic 3')
    await w.setProps({ muted: true })
    expect(w.find('[data-test="ai-voice"]').exists()).toBe(true)
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
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  const tick = async (w: ReturnType<typeof mount>, ms: number) => {
    vi.advanceTimersByTime(ms)
    await w.vm.$nextTick()
  }
  const F = 125 // 8fps 한 프레임
  const srcOf = (w: ReturnType<typeof mount>, char: string) =>
    (w.find(`[data-char="${char}"]`).element as HTMLElement).style.backgroundImage

  it('답변 지연: 1회차 가운데 시계, 2회차 서기 펜 톡톡', async () => {
    const w = mount(InterviewStage, { props: base })
    await w.setProps({ watchTick: 1 })
    expect(srcOf(w, 'center')).toContain('center_watch')
    vi.advanceTimersByTime(12 * 125 + 50) // f3 watch 12f @ 8fps
    await w.vm.$nextTick()
    expect(srcOf(w, 'center')).toContain('center_idle')
    await w.setProps({ watchTick: 2 })
    expect(srcOf(w, 'right')).toContain('right_pentap')
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
  })

  it('말하기: question_in 1회 → question 반복 → 끝나면 question_out 1회 → idle', async () => {
    const w = mount(InterviewStage, { props: base })
    await w.setProps({ stage: 'speaking' })
    expect(srcOf(w, 'center')).toContain('m1/center_question_in.png')
    await tick(w, 8 * F + 50) // m1 question_in 8f
    expect(srcOf(w, 'center')).toContain('m1/center_question.png')
    await tick(w, 30 * F) // 말하는 동안 계속 question
    expect(srcOf(w, 'center')).toContain('m1/center_question.png')
    await w.setProps({ stage: 'waiting' })
    expect(srcOf(w, 'center')).toContain('m1/center_question_out.png')
    await tick(w, 8 * F + 50) // question_out 8f
    expect(srcOf(w, 'center')).toContain('m1/center_idle.png')
  })

  it('집어 드는 중에 말이 끝나면 다 든 뒤에 내려놓는다(이음새 포즈 유지)', async () => {
    const w = mount(InterviewStage, { props: base })
    await w.setProps({ stage: 'speaking' })
    await tick(w, 3 * F)
    await w.setProps({ stage: 'waiting' })
    expect(srcOf(w, 'center')).toContain('center_question_in.png')
    await tick(w, 5 * F + 50)
    expect(srcOf(w, 'center')).toContain('center_question_out.png')
    await tick(w, 8 * F + 50)
    expect(srcOf(w, 'center')).toContain('m1/center_idle.png')
  })

  it('잔동작 중에 말을 시작하면 바로 question_in으로 바뀐다', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const w = mount(InterviewStage, { props: base })
    await tick(w, 15_000 + 10)
    expect(srcOf(w, 'center')).toContain('center_lookside')
    await w.setProps({ stage: 'speaking' })
    expect(srcOf(w, 'center')).toContain('center_question_in.png')
  })

  it('말하는 중(내려놓기 포함)엔 시계 신호가 가운데를 끊지 않고 서기 펜 톡톡으로 간다', async () => {
    const w = mount(InterviewStage, { props: { ...base, stage: 'speaking' } })
    await w.setProps({ watchTick: 1 })
    expect(srcOf(w, 'center')).toContain('center_question.png')
    expect(srcOf(w, 'right')).toContain('right_pentap')
    await w.setProps({ stage: 'waiting' })
    await w.setProps({ watchTick: 3 })
    expect(srcOf(w, 'center')).toContain('center_question_out.png')
  })

  it('대체 세트(기존 32×32): in·out은 center_idle 1회 — 같은 시트가 이어져도 멈추지 않고 idle로 돌아온다', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const w = mount(InterviewStage, { props: { ...base, centerSprites: LEGACY_CENTER } })
    await w.setProps({ stage: 'speaking' })
    expect(srcOf(w, 'center')).toContain('/sprites/interviewers/center_idle.png')
    await tick(w, 2 * F)
    await w.setProps({ stage: 'waiting' }) // in 도중 종료 → in 끝나고 out(같은 파일)
    await tick(w, 2 * LEGACY_CENTER.idle.frames * F + 100) // in·out 각 15f
    // in·out이 모두 끝나 덮어쓰기가 풀렸으면 대기 잔동작(lookside)이 대기 시작 15초 뒤에 나온다
    await tick(w, 15_000 - (2 * LEGACY_CENTER.idle.frames * F + 100) + 50)
    expect(srcOf(w, 'center')).toContain('/sprites/interviewers/center_lookside.png')
  })
})

describe('InterviewStage — 면접관', () => {
  it('centerSprites를 주면 가운데 자리는 그 면접관 시트, 좌우는 그대로', () => {
    const sp = interviewerById('m1')!.sprites
    const w = mount(InterviewStage, { props: { ...base, centerSprites: sp } })
    expect(w.find('[data-char="center"]').attributes('style')).toContain('m1/center_idle.png')
    expect(w.find('[data-char="left"]').attributes('style')).toContain(
      '/sprites/interviewers64/sl/left_idle.png',
    )
  })
  it('배석자 새 시트(sl·sr)를 못 불러와 sideSprites로 기존 세트를 주면 그걸 쓴다', () => {
    const w = mount(InterviewStage, { props: { ...base, sideSprites: LEGACY_SIDE } })
    expect(w.find('[data-char="left"]').attributes('style')).toContain(
      '/sprites/interviewers/left_idle.png',
    )
    expect(w.find('[data-char="right"]').attributes('style')).toContain(
      '/sprites/interviewers/right_idle.png',
    )
  })
  it('좋은 답변 반응 연결(reactPending·react-done)은 없다', () => {
    const w = mount(InterviewStage, { props: base })
    expect(Object.keys(w.props())).not.toContain('reactPending')
  })
  it('면접관 이름을 상단 태그에 붙인다', () => {
    const w = mount(InterviewStage, { props: { ...base, interviewerName: '압박 면접관(여)' } })
    expect(w.text()).toContain('IT · 백엔드 · 면접관: 압박 면접관(여)')
  })
})
