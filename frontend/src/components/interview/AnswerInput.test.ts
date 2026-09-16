import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@/services/speech', () => ({
  speechSupported: vi.fn(() => false),
  startSpeech: vi.fn(),
  stopSpeech: vi.fn(),
  isSpeechActive: vi.fn(() => false),
}))
import { speechSupported, startSpeech, stopSpeech } from '@/services/speech'
import AnswerInput from './AnswerInput.vue'

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
