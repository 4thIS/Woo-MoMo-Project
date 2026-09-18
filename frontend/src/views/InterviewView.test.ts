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
vi.mock('@/services/tts', () => ({ synthesize: vi.fn(), initTts: vi.fn(), disposeTts: vi.fn() }))
vi.mock('@/services/audio', () => ({ playClip: vi.fn(), setMuted: vi.fn(), warmUpAudio: vi.fn() }))
import { useInterviewStore } from '@/stores/interview'
import { useModelStore } from '@/stores/model'
import InterviewView from './InterviewView.vue'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

const TTS_MANIFEST = {
  id: 'e4b',
  url: '/m',
  size: 1,
  template: { turnStart: '', turnEnd: '', roles: {} },
  systemPromptOverride: null,
  fallback: null,
  tts: {
    id: 'supertonic-3',
    baseUrl: '/t/',
    files: [{ path: 'a', size: 1 }],
    voice: 'M2',
    lang: 'ko',
  },
}

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
  it('TTS가 켜져 있으면 무대에 합성 음성 안내와 음소거 토글, 꺼져 있으면(텍스트 전용) 둘 다 없음 (#34·#36)', async () => {
    const m = useModelStore()
    m.manifest = TTS_MANIFEST
    const { w } = mountWith({ messages: [{ role: 'model', text: 'q' }] })
    expect(w.find('[data-test="ai-voice"]').exists()).toBe(true)
    expect(w.find('[data-test="mute"]').exists()).toBe(true)
    m.setVoiceWanted(false)
    await w.vm.$nextTick()
    expect(w.find('[data-test="ai-voice"]').exists()).toBe(false)
    expect(w.find('[data-test="mute"]').exists()).toBe(false)
  })
  it('말풍선은 revealed(음성에 맞춰 드러난 부분)만 보인다', () => {
    const { w } = mountWith({
      messages: [{ role: 'model', text: '첫 질문입니다' }],
      revealed: '첫 질',
    })
    expect(w.find('.bubble').text()).toBe('첫 질')
  })
  it('speaking 중엔 말하기·전송이 잠기고 답변 타이머가 없다', () => {
    const { w } = mountWith({
      stage: 'speaking',
      speaking: true,
      messages: [{ role: 'model', text: 'q', at: Date.now() }],
    })
    expect((w.find('[data-test="send"]').element as HTMLButtonElement).disabled).toBe(true)
    expect((w.find('textarea').element as HTMLTextAreaElement).disabled).toBe(true)
    expect(w.find('[data-test="answer-timer"]').exists()).toBe(false)
  })
  it('합성 대기 중(thinking, 생성 끝)에도 입력이 잠기고 타이머가 없다', () => {
    const { w } = mountWith({
      stage: 'thinking',
      generating: false,
      speaking: false,
      messages: [{ role: 'model', text: 'q', at: Date.now() }],
    })
    expect((w.find('textarea').element as HTMLTextAreaElement).disabled).toBe(true)
    expect(w.find('[data-test="answer-timer"]').exists()).toBe(false)
  })
  it('ended여도 speaking 중엔 마무리 창을 띄우지 않는다', async () => {
    const { w, s } = mountWith({
      stage: 'speaking',
      speaking: true,
      ended: true,
      messages: [{ role: 'model', text: '마치겠습니다', at: Date.now() }],
    })
    expect(w.find('[data-test="closing"]').exists()).toBe(false)
    s.$patch({ speaking: false, stage: 'waiting' })
    await w.vm.$nextTick()
    expect(w.find('[data-test="closing"]').exists()).toBe(true)
  })
  it('음소거 토글은 store.toggleMuted, 경고는 store.ttsWarning', async () => {
    useModelStore().manifest = TTS_MANIFEST
    const { w, s } = mountWith({ ttsWarning: '음성을 만들지 못했습니다' })
    const toggle = vi.spyOn(s, 'toggleMuted').mockImplementation(() => undefined)
    expect(w.find('[data-test="tts-warning"]').text()).toBe('음성을 만들지 못했습니다')
    await w.find('[data-test="mute"]').trigger('click')
    expect(toggle).toHaveBeenCalled()
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
  it('종료 문장이 나오면 바로 넘기지 않고 마무리 창을 띄우고, 리포트 받기를 눌러야 finish', async () => {
    const { w, s } = mountWith({
      messages: [{ role: 'model', text: '면접을 마치겠습니다.' }],
      ended: true,
    })
    const finish = vi.spyOn(s, 'finish').mockResolvedValue()
    await Promise.resolve()
    expect(finish).not.toHaveBeenCalled()
    expect(w.find('[data-test="closing"]').exists()).toBe(true)
    expect(w.text()).toContain('면접이 끝났습니다')
    expect(w.text()).toContain('면접을 마치겠습니다.') // 면접관의 마지막 말은 그대로 보인다
    await w.find('[data-test="get-report"]').trigger('click')
    expect(finish).toHaveBeenCalled()
  })
  it('생성 오류면 다시 물어보기 버튼', async () => {
    const { w, s } = mountWith({ genError: 'boom', messages: [{ role: 'user', text: '답' }] })
    const retry = vi.spyOn(s, 'retryLast').mockResolvedValue()
    expect(w.text()).toContain('응답이 끊겼습니다')
    await w.find('[data-test="retry"]').trigger('click')
    expect(retry).toHaveBeenCalled()
  })
  it('시작 시각부터 1초마다 시계가 오른다', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const { w } = mountWith({
      startedAt: 1_000_000 - 61_000,
      messages: [{ role: 'model', text: 'q' }],
    })
    expect(w.find('[data-test="clock"]').text()).toBe('01:01')
    vi.advanceTimersByTime(2_000)
    await w.vm.$nextTick()
    expect(w.find('[data-test="clock"]').text()).toBe('01:03')
    w.unmount()
    vi.useRealTimers()
  })
})

describe('InterviewView 답변 타이머', () => {
  it('마지막 면접관 질문이 끝난 시각부터 60초 카운트다운을 입력창에 넘긴다', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const { w } = mountWith({
      messages: [{ role: 'model', text: 'q', at: 1_000_000 - 13_000 }],
    })
    expect(w.find('[data-test="answer-timer"]').text()).toContain('00:47')
    vi.advanceTimersByTime(60_000)
    await w.vm.$nextTick()
    expect(w.find('[data-test="answer-timer"]').text()).toContain('-00:13')
    w.unmount()
    vi.useRealTimers()
  })
  it('생성 중이거나 마지막이 지원자 턴이면 타이머가 없다', () => {
    const a = mountWith({ generating: true, messages: [{ role: 'model', text: 'q', at: 1 }] })
    expect(a.w.find('[data-test="answer-timer"]').exists()).toBe(false)
    a.w.unmount()
    const b = mountWith({
      messages: [
        { role: 'model', text: 'q', at: 1 },
        { role: 'user', text: 'a', at: 2 },
      ],
    })
    expect(b.w.find('[data-test="answer-timer"]').exists()).toBe(false)
    b.w.unmount()
  })
})
