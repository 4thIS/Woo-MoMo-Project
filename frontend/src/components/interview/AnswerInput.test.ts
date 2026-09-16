import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@/services/speech', () => ({
  speechSupported: vi.fn(() => false),
  startSpeech: vi.fn(),
  stopSpeech: vi.fn(),
  isSpeechActive: vi.fn(() => false),
}))
import { speechSupported, startSpeech, stopSpeech } from '@/services/speech'
import AnswerInput, { SILENCE_MS } from './AnswerInput.vue'

beforeEach(() => vi.mocked(speechSupported).mockReturnValue(false))

describe('AnswerInput', () => {
  it('Enter로 전송, Shift+Enter는 줄바꿈', async () => {
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    const ta = w.find('textarea')
    await ta.setValue('답변')
    await ta.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(w.emitted('send')).toBeUndefined()
    await ta.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('send')?.[0]).toEqual(['답변'])
    expect((ta.element as HTMLTextAreaElement).value).toBe('')
  })
  it('빈 입력은 전송하지 않는다', async () => {
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    await w.find('[data-test="send"]').trigger('click')
    expect(w.emitted('send')).toBeUndefined()
  })
  it('생성 중이면 입력 비활성 + 버튼이 중단', async () => {
    const w = mount(AnswerInput, { props: { generating: true, disabled: false } })
    expect(w.find('textarea').attributes('disabled')).toBeDefined()
    expect(w.find('[data-test="send"]').text()).toBe('중단')
    await w.find('[data-test="send"]').trigger('click')
    expect(w.emitted('abort')).toHaveLength(1)
  })
  it('typing은 입력 유무를 emit한다', async () => {
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    await w.find('textarea').setValue('a')
    expect(w.emitted('typing')?.at(-1)).toEqual([true])
    await w.find('textarea').setValue('')
    expect(w.emitted('typing')?.at(-1)).toEqual([false])
  })
  it('음성 미지원이면 말하기 버튼 비활성', () => {
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    expect(w.find('[data-test="mic"]').attributes('disabled')).toBeDefined()
  })
  it('말하기 ON이면 typing true를 emit한다', async () => {
    vi.mocked(speechSupported).mockReturnValue(true)
    vi.mocked(startSpeech).mockImplementation(() => {})
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    await w.find('[data-test="mic"]').trigger('click')
    expect(w.emitted('typing')?.at(-1)).toEqual([true])
  })
  it('마이크 권한 거부(not-allowed) 후 말하기 버튼이 비활성된다', async () => {
    vi.mocked(speechSupported).mockReturnValue(true)
    vi.mocked(startSpeech).mockImplementation((_i, _f, onError) => onError('not-allowed'))
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    await w.find('[data-test="mic"]').trigger('click')
    expect(w.find('[data-test="mic"]').attributes('disabled')).toBeDefined()
  })
  it('말하기 ON이면 확정 결과를 덧붙이고 자동 전송하지 않는다', async () => {
    vi.mocked(speechSupported).mockReturnValue(true)
    vi.mocked(startSpeech).mockImplementation((_i, onFinal) => onFinal('안녕하세요'))
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    await w.find('textarea').setValue('기존 ')
    await w.find('[data-test="mic"]').trigger('click')
    expect((w.find('textarea').element as HTMLTextAreaElement).value).toBe('기존 안녕하세요')
    expect(w.emitted('send')).toBeUndefined()
  })
})

describe('AnswerInput 듣기 잠금·늦은 결과', () => {
  it('disabled가 되면 듣기를 멈춘다', async () => {
    vi.mocked(speechSupported).mockReturnValue(true)
    vi.mocked(startSpeech).mockImplementation(() => {})
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    await w.find('[data-test="mic"]').trigger('click')
    expect(w.find('[data-test="mic"]').text()).toContain('듣는 중')
    await w.setProps({ disabled: true })
    expect(stopSpeech).toHaveBeenCalled()
    expect(w.find('[data-test="mic"]').text()).toContain('말하기')
  })
  it('토글을 끈 뒤 늦게 온 확정 결과는 버린다', async () => {
    vi.mocked(speechSupported).mockReturnValue(true)
    let late: ((t: string) => void) | null = null
    vi.mocked(startSpeech).mockImplementation((_i, onFinal) => {
      late = onFinal
    })
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    await w.find('[data-test="mic"]').trigger('click')
    await w.find('[data-test="mic"]').trigger('click') // 끔
    late!('늦은 결과')
    await w.vm.$nextTick()
    expect((w.find('textarea').element as HTMLTextAreaElement).value).toBe('')
  })
  it('미지원이면 툴팁이 이유를 말한다', () => {
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    expect(w.find('[data-test="mic"]').attributes('title')).toContain('지원하지 않습니다')
  })
})

type Cbs = { interim: (t: string) => void; final: (t: string) => void; end?: () => void }
function armSpeech(): Cbs {
  const cbs = {} as Cbs
  vi.mocked(speechSupported).mockReturnValue(true)
  vi.mocked(startSpeech).mockImplementation((onInterim, onFinal, _onErr, onEnd) => {
    cbs.interim = onInterim
    cbs.final = onFinal
    cbs.end = onEnd
  })
  return cbs
}

describe('AnswerInput 침묵 자동 전송', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('첫 마디 이후 결과가 SILENCE_MS 동안 없으면 자동 전송한다', async () => {
    const cbs = armSpeech()
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    await w.find('[data-test="mic"]').trigger('click')
    vi.advanceTimersByTime(SILENCE_MS * 3)
    expect(w.emitted('send')).toBeUndefined() // 첫 마디 전엔 절대 안 보냄
    cbs.interim('안녕')
    await w.vm.$nextTick()
    expect(w.find('[data-test="silence"]').exists()).toBe(true)
    vi.advanceTimersByTime(SILENCE_MS - 500)
    cbs.final('안녕하세요') // 결과가 오면 타이머 리셋
    vi.advanceTimersByTime(SILENCE_MS - 500)
    expect(w.emitted('send')).toBeUndefined()
    vi.advanceTimersByTime(500)
    expect(w.emitted('send')?.[0]).toEqual(['안녕하세요'])
  })

  it('받아쓴 텍스트가 비어 있으면 보내지 않고 계속 듣는다', async () => {
    const cbs = armSpeech()
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    await w.find('[data-test="mic"]').trigger('click')
    cbs.interim(' ')
    vi.advanceTimersByTime(SILENCE_MS)
    expect(w.emitted('send')).toBeUndefined()
    expect(w.find('[data-test="mic"]').text()).toContain('듣는 중')
  })

  it('토글을 끄면 취소되고 텍스트는 남는다', async () => {
    const cbs = armSpeech()
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    await w.find('[data-test="mic"]').trigger('click')
    cbs.final('중간까지')
    await w.find('[data-test="mic"]').trigger('click') // off
    vi.advanceTimersByTime(SILENCE_MS * 2)
    expect(w.emitted('send')).toBeUndefined()
    expect((w.find('textarea').element as HTMLTextAreaElement).value).toBe('중간까지')
    expect(w.find('[data-test="silence"]').exists()).toBe(false)
  })

  it('브라우저가 스스로 인식을 끝내도 타이머는 살아 있어 전송한다', async () => {
    const cbs = armSpeech()
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    await w.find('[data-test="mic"]').trigger('click')
    cbs.final('끝')
    cbs.end?.()
    vi.advanceTimersByTime(SILENCE_MS)
    expect(w.emitted('send')?.[0]).toEqual(['끝'])
  })

  it('입력이 잠기면(generating) 타이머가 취소된다', async () => {
    const cbs = armSpeech()
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    await w.find('[data-test="mic"]').trigger('click')
    cbs.final('답')
    await w.setProps({ generating: true })
    vi.advanceTimersByTime(SILENCE_MS)
    expect(w.emitted('send')).toBeUndefined()
    expect(w.emitted('abort')).toBeUndefined()
  })

  it('인식이 스스로 끝난 뒤 잠기면 남은 타이머도 취소된다', async () => {
    const cbs = armSpeech()
    const w = mount(AnswerInput, { props: { generating: false, disabled: false } })
    await w.find('[data-test="mic"]').trigger('click')
    cbs.final('답')
    cbs.end?.()
    await w.setProps({ generating: true })
    vi.advanceTimersByTime(SILENCE_MS)
    expect(w.emitted('send')).toBeUndefined()
    expect(w.emitted('abort')).toBeUndefined()
  })
})

describe('AnswerInput 답변 타이머(60초 게이지)', () => {
  const mountLeft = (leftMs: number | null) =>
    mount(AnswerInput, { props: { generating: false, disabled: false, leftMs } })
  it('leftMs가 null이면 타이머를 그리지 않는다', () => {
    expect(mountLeft(null).find('[data-test="answer-timer"]').exists()).toBe(false)
  })
  it('여유: 노란 바 78% + 00:47', () => {
    const w = mountLeft(47_000)
    const t = w.find('[data-test="answer-timer"]')
    expect(t.text()).toContain('00:47')
    expect(t.find('.fill').attributes('style')).toContain('width: 78%')
    expect(t.classes()).not.toContain('warn')
  })
  it('임박(≤10초): warn 클래스 + 깜빡이는 숫자', () => {
    const w = mountLeft(8_000)
    const t = w.find('[data-test="answer-timer"]')
    expect(t.classes()).toContain('warn')
    expect(t.find('.num').classes()).toContain('blink')
    expect(t.text()).toContain('00:08')
  })
  it('초과: 바는 비고 숫자는 음수, 전송은 막지 않는다', async () => {
    const w = mountLeft(-12_000)
    const t = w.find('[data-test="answer-timer"]')
    expect(t.text()).toContain('-00:12')
    expect(t.find('.fill').attributes('style')).toContain('width: 0%')
    expect(t.find('.num').classes()).not.toContain('blink') // 초과 후엔 고정 표시
    await w.find('textarea').setValue('늦은 답')
    await w.find('[data-test="send"]').trigger('click')
    expect(w.emitted('send')?.[0]).toEqual(['늦은 답'])
  })
})
