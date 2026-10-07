import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/preview', () => ({
  playPreview: vi.fn(async () => true),
  stopPreview: vi.fn(),
}))
vi.mock('@/services/sprites', () => ({ probeImage: vi.fn(async () => true) }))
vi.mock('@/services/api', () => ({ getManifest: vi.fn(), getQuestions: vi.fn() }))
vi.mock('@/services/llm', () => ({ initEngine: vi.fn(), disposeEngine: vi.fn() }))
vi.mock('@/services/tts', () => ({
  initTts: vi.fn(),
  synthesize: vi.fn(),
  disposeTts: vi.fn(),
  setTtsVoice: vi.fn(),
}))

import { playPreview } from '@/services/preview'
import { useInterviewerStore } from '@/stores/interviewer'
import InterviewerPicker from './InterviewerPicker.vue'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

const card = (w: ReturnType<typeof mount>, id: string) => w.find(`[data-test="interviewer-${id}"]`)

describe('InterviewerPicker', () => {
  it('면접관 4명 카드(이름·소개)를 m1·f3·m2·f2 순서의 라디오 그룹으로 보여 주고, 처음엔 아무도 선택되지 않는다', () => {
    const w = mount(InterviewerPicker)
    expect(w.find('[role="radiogroup"]').exists()).toBe(true)
    const radios = w.findAll('[role="radio"]')
    expect(radios).toHaveLength(4)
    expect(radios.map((r) => r.attributes('data-test'))).toEqual([
      'interviewer-m1',
      'interviewer-f3',
      'interviewer-m2',
      'interviewer-f2',
    ])
    expect(w.text()).toContain('기본 면접관(남)')
    expect(w.text()).toContain('압박 면접관(여)')
    expect(w.text()).toContain('근거를 보여 주세요')
    expect(radios.every((r) => r.attributes('aria-checked') === 'false')).toBe(true)
  })
  it('카드 캐릭터는 64 프레임 × 2 = 128px', () => {
    const w = mount(InterviewerPicker)
    for (const id of ['m1', 'f3', 'm2', 'f2']) {
      const st = (card(w, id).find('.sprite').element as HTMLElement).style
      expect([st.width, st.height], id).toEqual(['128px', '128px'])
    }
  })
  it('카드를 누르면 선택 + 포커스 강조 + 그 목소리 미리 듣기(음소거 저장값과 무관)', async () => {
    localStorage.setItem('momo.muted', '1')
    const w = mount(InterviewerPicker)
    await card(w, 'm1').trigger('click')
    await flushPromises()
    expect(useInterviewerStore().id).toBe('m1')
    expect(card(w, 'm1').attributes('aria-checked')).toBe('true')
    expect(card(w, 'm1').classes()).toContain('selected')
    expect(card(w, 'm2').classes()).toContain('dim')
    expect(playPreview).toHaveBeenCalledWith('/voices/preview/m1.ogg', expect.any(Function))
  })
  it('같은 카드를 다시 누르면 처음부터 다시 재생한다', async () => {
    const w = mount(InterviewerPicker)
    await card(w, 'm2').trigger('click')
    await card(w, 'm2').trigger('click')
    expect(playPreview).toHaveBeenCalledTimes(2)
  })
  it('재생 중인 캐릭터는 question 시트, 끝나면 idle 시트', async () => {
    let ended!: () => void
    vi.mocked(playPreview).mockImplementationOnce(async (_s, onEnded) => {
      ended = onEnded!
      return true
    })
    const w = mount(InterviewerPicker)
    await card(w, 'f3').trigger('click')
    await flushPromises()
    expect(card(w, 'f3').find('.sprite').attributes('style')).toContain('f3/center_question.png')
    ended()
    await flushPromises()
    expect(card(w, 'f3').find('.sprite').attributes('style')).toContain('f3/center_idle.png')
  })
  it('방향키로 다음 면접관을 고르면 선택하고 재생한다', async () => {
    const w = mount(InterviewerPicker)
    await card(w, 'm1').trigger('click')
    await w.find('[role="radiogroup"]').trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(useInterviewerStore().id).toBe('f3')
    expect(playPreview).toHaveBeenLastCalledWith('/voices/preview/f3.ogg', expect.any(Function))
  })
  it('마지막(f2)에서 오른쪽은 처음(m1)으로, 처음에서 왼쪽은 마지막으로 돈다', async () => {
    const w = mount(InterviewerPicker)
    await card(w, 'f2').trigger('click')
    await w.find('[role="radiogroup"]').trigger('keydown', { key: 'ArrowRight' })
    expect(useInterviewerStore().id).toBe('m1')
    await w.find('[role="radiogroup"]').trigger('keydown', { key: 'ArrowLeft' })
    expect(useInterviewerStore().id).toBe('f2')
  })
  it('재생 실패면 안내 문구, 스피커 버튼은 없다, AI 합성 목소리 고지는 항상 있다', async () => {
    vi.mocked(playPreview).mockResolvedValueOnce(false)
    const w = mount(InterviewerPicker)
    expect(w.find('[data-test="ai-voice-preview"]').text()).toContain('AI로 합성한 목소리')
    await card(w, 'm1').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="preview-error"]').text()).toContain('미리 듣기를 재생할 수 없습니다')
    expect(w.find('[data-test="speaker"]').exists()).toBe(false)
    expect(w.findAll('button').length).toBe(4) // 카드 4장뿐
  })
})
