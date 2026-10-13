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
import { useAccountStore, setAccountApi } from '@/stores/account'
import { makeMockAccount } from '@/services/accountMock'
import InterviewerPicker from './InterviewerPicker.vue'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  setAccountApi(makeMockAccount({ delayMs: 0 }))
  vi.clearAllMocks()
})

const card = (w: ReturnType<typeof mount>, id: string) => w.find(`[data-test="interviewer-${id}"]`)

describe('InterviewerPicker', () => {
  it('면접관 4명 카드를 데이빗·쥴리·올리비아·벤 순서의 라디오 그룹으로 보여 주고, 처음엔 아무도 선택되지 않는다', () => {
    const w = mount(InterviewerPicker)
    expect(w.find('[role="radiogroup"]').exists()).toBe(true)
    const radios = w.findAll('[role="radio"]')
    expect(radios).toHaveLength(4)
    expect(radios.map((r) => r.attributes('data-test'))).toEqual([
      'interviewer-m1',
      'interviewer-f2',
      'interviewer-f3',
      'interviewer-m2',
    ])
    for (const nm of ['데이빗', '쥴리', '올리비아', '벤']) expect(w.text()).toContain(nm)
    expect(w.text()).toContain('기본 면접관(남)')
    expect(radios.every((r) => r.attributes('aria-checked') === 'false')).toBe(true)
  })
  it('카드 캐릭터는 92 프레임 × 2 = 184px(정수배), 시트 전체를 manifest 프레임 수만큼 늘린다', () => {
    const w = mount(InterviewerPicker)
    for (const id of ['m1', 'f3', 'm2', 'f2']) {
      const st = (card(w, id).find('.sprite').element as HTMLElement).style
      expect([st.width, st.height], id).toEqual(['184px', '184px'])
      expect(st.backgroundSize, id).toBe('2944px 184px') // idle 16f × 92 × 2
      expect(st.backgroundImage, id).toContain(`/sprites/interviewers64/${id}/center_idle.png`)
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
    expect(card(w, 'f2').classes()).toContain('dim')
    expect(playPreview).toHaveBeenCalledWith('/voices/preview/m1.ogg', expect.any(Function))
  })
  it('같은 카드를 다시 누르면 처음부터 다시 재생한다', async () => {
    const w = mount(InterviewerPicker)
    await card(w, 'f2').trigger('click')
    await card(w, 'f2').trigger('click')
    expect(playPreview).toHaveBeenCalledTimes(2)
  })
  it('재생 중인 캐릭터는 question 시트, 끝나면 idle 시트', async () => {
    let ended!: () => void
    vi.mocked(playPreview).mockImplementationOnce(async (_s, onEnded) => {
      ended = onEnded!
      return true
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] }) // 마운트 전에 — 스프라이트 타이머가 가짜 시계를 쓰게
    const w = mount(InterviewerPicker)
    await card(w, 'f3').trigger('click')
    await flushPromises()
    expect(card(w, 'f3').find('.sprite').attributes('style')).toContain('f3/center_question.png')
    vi.advanceTimersByTime(40 * 125) // in·out 없이 question만 반복 — 시간이 지나도 그대로
    await flushPromises()
    vi.useRealTimers()
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
    expect(useInterviewerStore().id).toBe('f2')
    expect(playPreview).toHaveBeenLastCalledWith('/voices/preview/f2.ogg', expect.any(Function))
  })
  it('방향키로 벤에 닿아도 티켓이 없으면 넘어가지 않고 요금제를 띄운다', async () => {
    const w = mount(InterviewerPicker)
    await card(w, 'f3').trigger('click')
    await w.find('[role="radiogroup"]').trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(useInterviewerStore().id).toBe('f3')
    expect(w.emitted('need-premium')).toHaveLength(1)
  })
  it('처음에서 왼쪽은 마지막(벤)이라 역시 요금제로 간다', async () => {
    const w = mount(InterviewerPicker)
    await card(w, 'm1').trigger('click')
    await w.find('[role="radiogroup"]').trigger('keydown', { key: 'ArrowLeft' })
    await flushPromises()
    expect(useInterviewerStore().id).toBe('m1')
    expect(w.emitted('need-premium')).toHaveLength(1)
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

  describe('InterviewerPicker — 벤(프리미엄)', () => {
    const premium = async () => {
      const a = useAccountStore()
      await a.signUp('a@b.com', 'pw123456', '이우진')
      await a.purchasePremium()
      await flushPromises()
    }

    it('벤 카드에 모서리 리본이 붙는다', () => {
      expect(card(mount(InterviewerPicker), 'm2').find('.ribbon').exists()).toBe(true)
    })

    it('무료 면접관에는 리본이 없다', () => {
      const w = mount(InterviewerPicker)
      for (const id of ['m1', 'f2', 'f3'])
        expect(card(w, id).find('.ribbon').exists(), id).toBe(false)
    })

    it('비로그인이 벤을 누르면 선택되지 않고 요금제를 띄운다', async () => {
      const w = mount(InterviewerPicker)
      await card(w, 'm2').trigger('click')
      await flushPromises()
      expect(useInterviewerStore().id).toBeNull()
      expect(w.emitted('need-premium')).toHaveLength(1)
    })

    it('티켓이 0장이면 프리미엄이어도 요금제를 띄운다 — 다 쓰면 다시 사야 한다', async () => {
      const a = useAccountStore()
      await a.signUp('a@b.com', 'pw123456', '이우진')
      await flushPromises()
      const w = mount(InterviewerPicker)
      await card(w, 'm2').trigger('click')
      await flushPromises()
      expect(useInterviewerStore().id).toBeNull()
      expect(w.emitted('need-premium')).toHaveLength(1)
    })

    it('티켓이 없어도 카드를 흐리게 하지 않는다 — 누를 수 있어야 길이 열린다', () => {
      expect(card(mount(InterviewerPicker), 'm2').classes()).not.toContain('lock')
    })

    it('티켓이 있으면 벤이 선택되고 남은 수가 보인다', async () => {
      await premium()
      const w = mount(InterviewerPicker)
      expect(card(w, 'm2').text()).toContain('티켓 10장')
      await card(w, 'm2').trigger('click')
      await flushPromises()
      expect(useInterviewerStore().id).toBe('m2')
      expect(w.emitted('need-premium')).toBeUndefined()
    })

    it('벤을 고르면 대입/회사 선택이 펼쳐진다', async () => {
      await premium()
      const w = mount(InterviewerPicker)
      expect(w.find('[data-test=track-pick]').exists()).toBe(false)
      await card(w, 'm2').trigger('click')
      await flushPromises()
      expect(w.find('[data-test=track-pick]').exists()).toBe(true)
    })

    it('트랙을 고르면 알린다 — 고르기 전에는 null이다', async () => {
      await premium()
      const w = mount(InterviewerPicker)
      await card(w, 'm2').trigger('click')
      await flushPromises()
      expect(w.emitted('track-change')?.at(-1)).toEqual([null])
      await w.find('[data-test=track-admission]').trigger('click')
      expect(w.emitted('track-change')?.at(-1)).toEqual(['admission'])
    })

    it('다른 면접관을 고르면 트랙 선택이 사라진다', async () => {
      await premium()
      const w = mount(InterviewerPicker)
      await card(w, 'm2').trigger('click')
      await flushPromises()
      await card(w, 'm1').trigger('click')
      await flushPromises()
      expect(w.find('[data-test=track-pick]').exists()).toBe(false)
    })
  })
})
