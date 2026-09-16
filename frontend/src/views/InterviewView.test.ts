import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/llm', () => ({ startSession: vi.fn() }))
vi.mock('@/services/api', () => ({ getQuestions: vi.fn(), getManifest: vi.fn() }))
vi.mock('@/services/speech', () => ({
  speechSupported: () => false,
  startSpeech: vi.fn(),
  stopSpeech: vi.fn(),
  isSpeechActive: () => false,
}))
import { useInterviewStore } from '@/stores/interview'
import InterviewView from './InterviewView.vue'

beforeEach(() => setActivePinia(createPinia()))

function mountWith(patch: Partial<ReturnType<typeof useInterviewStore>['$state']>) {
  const s = useInterviewStore()
  s.$patch({
    phase: 'interview',
    stage: 'waiting',
    profile: { field: 'it', job: '백엔드' },
    ...patch,
  })
  return { w: mount(InterviewView, { attachTo: document.body }), s }
}

describe('InterviewView', () => {
  it('말풍선에는 스트리밍 중 텍스트, 아니면 마지막 면접관 발화', () => {
    const { w } = mountWith({ messages: [{ role: 'model', text: '첫 질문' }] })
    expect(w.text()).toContain('첫 질문')
  })
  it('면접 종료 → 인라인 확인 → 확인하면 finish', async () => {
    const { w, s } = mountWith({ messages: [{ role: 'model', text: 'q' }] })
    const finish = vi.spyOn(s, 'finish').mockResolvedValue()
    await w.find('[data-test="end"]').trigger('click')
    expect(w.text()).toContain('지금까지의 답변으로 리포트를 만들까요?')
    await w.find('[data-test="end-confirm"]').trigger('click')
    expect(finish).toHaveBeenCalled()
  })
  it('토큰 한도를 넘으면 입력을 막고 안내를 띄운다', () => {
    const { w } = mountWith({ tokenCount: 7000, messages: [{ role: 'model', text: 'q' }] })
    expect(w.text()).toContain('면접관이 마무리하려 합니다')
    expect(w.find('textarea').attributes('disabled')).toBeDefined()
  })
  it('종료 문장이 나오면 자동으로 finish', async () => {
    const s = useInterviewStore()
    const finish = vi.spyOn(s, 'finish').mockResolvedValue()
    mountWith({ messages: [{ role: 'model', text: '면접을 마치겠습니다.' }], ended: true })
    await Promise.resolve()
    expect(finish).toHaveBeenCalled()
  })
  it('생성 오류면 다시 물어보기 버튼', async () => {
    const { w, s } = mountWith({ genError: 'boom', messages: [{ role: 'user', text: '답' }] })
    const retry = vi.spyOn(s, 'retryLast').mockResolvedValue()
    expect(w.text()).toContain('응답이 끊겼습니다')
    await w.find('[data-test="retry"]').trigger('click')
    expect(retry).toHaveBeenCalled()
  })
})
