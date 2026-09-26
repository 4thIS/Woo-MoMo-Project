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
  it('면접관 3명 카드(이름·소개)를 라디오 그룹으로 보여 주고, 처음엔 아무도 선택되지 않는다', () => {
    const w = mount(InterviewerPicker)
    expect(w.find('[role="radiogroup"]').exists()).toBe(true)
    const radios = w.findAll('[role="radio"]')
    expect(radios).toHaveLength(3)
    expect(w.text()).toContain('온화한 선배')
    expect(w.text()).toContain('편하게 이야기해요')
    expect(radios.every((r) => r.attributes('aria-checked') === 'false')).toBe(true)
  })
  it('카드를 누르면 선택 + 포커스 강조 + 그 목소리 미리 듣기(음소거 저장값과 무관)', async () => {
    localStorage.setItem('momo.muted', '1')
    const w = mount(InterviewerPicker)
    await card(w, 'gentle').trigger('click')
    await flushPromises()
    expect(useInterviewerStore().id).toBe('gentle')
    expect(card(w, 'gentle').attributes('aria-checked')).toBe('true')
    expect(card(w, 'gentle').classes()).toContain('selected')
    expect(card(w, 'sharp').classes()).toContain('dim')
    expect(playPreview).toHaveBeenCalledWith('/voices/preview/gentle.ogg', expect.any(Function))
  })
  it('같은 카드를 다시 누르면 처음부터 다시 재생한다', async () => {
    const w = mount(InterviewerPicker)
    await card(w, 'sharp').trigger('click')
    await card(w, 'sharp').trigger('click')
    expect(playPreview).toHaveBeenCalledTimes(2)
  })
  it('재생 중인 캐릭터는 question 시트, 끝나면 idle 시트', async () => {
    let ended!: () => void
    vi.mocked(playPreview).mockImplementationOnce(async (_s, onEnded) => {
      ended = onEnded!
      return true
    })
    const w = mount(InterviewerPicker)
    await card(w, 'standard').trigger('click')
    await flushPromises()
    expect(card(w, 'standard').find('.sprite').attributes('style')).toContain('center_question.png')
    ended()
    await flushPromises()
    expect(card(w, 'standard').find('.sprite').attributes('style')).toContain('center_idle.png')
  })
  it('방향키로 다음 면접관을 고르면 선택하고 재생한다', async () => {
    const w = mount(InterviewerPicker)
    await card(w, 'gentle').trigger('click')
    await w.find('[role="radiogroup"]').trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(useInterviewerStore().id).toBe('standard')
    expect(playPreview).toHaveBeenLastCalledWith(
      '/voices/preview/standard.ogg',
      expect.any(Function),
    )
  })
  it('재생 실패면 안내 문구, 스피커 버튼은 없다, AI 합성 목소리 고지는 항상 있다', async () => {
    vi.mocked(playPreview).mockResolvedValueOnce(false)
    const w = mount(InterviewerPicker)
    expect(w.find('[data-test="ai-voice-preview"]').text()).toContain('AI로 합성한 목소리')
    await card(w, 'gentle').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="preview-error"]').text()).toContain('미리 듣기를 재생할 수 없습니다')
    expect(w.find('[data-test="speaker"]').exists()).toBe(false)
    expect(w.findAll('button').length).toBe(3) // 카드 3장뿐
  })
})
