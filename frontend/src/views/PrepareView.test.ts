import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/api', () => ({
  getManifest: vi.fn(),
  getQuestions: vi.fn(async () => ({ field: 'it', questions: [] })),
}))
vi.mock('@/services/pdf', () => ({ extractPdfText: vi.fn() }))
vi.mock('@/services/modelCache', () => ({
  clearModels: vi.fn(async () => {}),
  hasModel: vi.fn(async () => false),
  downloadModel: vi.fn(
    async (_id: string, _url: string, size: number, onProgress: (r: number) => void) => {
      onProgress(size)
    },
  ),
  getModelBlob: vi.fn(async () => new Blob(['x'])),
}))
vi.mock('@/services/llm', () => ({
  initEngine: vi.fn(async () => {}),
  disposeEngine: vi.fn(async () => {}),
  startSession: vi.fn(),
}))
vi.mock('@/services/tts', () => ({
  initTts: vi.fn(async () => {}),
  synthesize: vi.fn(async () => ({
    samples: new Float32Array(1),
    sampleRate: 44100,
    durationMs: 0,
  })),
  disposeTts: vi.fn(),
}))
vi.mock('@/services/audio', () => ({
  warmUpAudio: vi.fn(),
  playClip: vi.fn(),
  setMuted: vi.fn(),
}))

import { extractPdfText } from '@/services/pdf'
import { clearModels } from '@/services/modelCache'
import { warmUpAudio } from '@/services/audio'
import { useModelStore } from '@/stores/model'
import { useInterviewStore } from '@/stores/interview'
import PrepareView from './PrepareView.vue'

const mountView = () => mount(PrepareView, { global: { stubs: { PixelProgress: true } } })

/** ① 지원 정보(분야 IT + 직무)를 채우고 직무 입력을 떠나 ② 이력서 단계로 넘어간다 */
async function fillProfile(w: ReturnType<typeof mountView>) {
  await w.findAll('[role=radio]')[0].trigger('click') // IT
  await flushPromises()
  await w.find('[data-test=job]').setValue('백엔드 개발자')
  await w.find('[data-test=job]').trigger('blur')
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  const m = useModelStore()
  m.active = { id: 'e4b', url: '/models/e4b.litertlm', size: 100 }
  m.total = 100
  m.received = 78
  m.status = 'downloading'
})

describe('PrepareView', () => {
  it('아무것도 없으면 시작 버튼 비활성 + 이유', () => {
    const w = mountView()
    const btn = w.find('[data-test=start]')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
    expect(btn.text()).toContain('면접관이 자리에 앉으면 열립니다')
  })

  it('분야 칩 + 직무 + PDF → 입력 완료 태그', async () => {
    vi.mocked(extractPdfText).mockResolvedValue('이력서 '.repeat(100))
    const w = mountView()
    await fillProfile(w)
    const input = w.find('[data-test=file]')
    Object.defineProperty(input.element, 'files', {
      value: [new File(['x'], 'cv.pdf', { type: 'application/pdf' })],
    })
    await input.trigger('change')
    await flushPromises()
    expect(w.text()).toMatch(/\d+자 추출/)
    expect(useInterviewStore().resumeName).toBe('cv.pdf')
  })

  it('PDF를 끌어다 놓아도 같은 경로로 읽는다 (dragover는 기본 동작을 막는다)', async () => {
    vi.mocked(extractPdfText).mockResolvedValue('이력서 '.repeat(100))
    const w = mountView()
    await fillProfile(w)
    const zone = w.find('[data-test=drop]')
    const over = new Event('dragover', { cancelable: true })
    zone.element.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(true)
    const file = new File(['x'], 'cv.pdf', { type: 'application/pdf' })
    await zone.trigger('drop', { dataTransfer: { files: [file] } })
    await flushPromises()
    expect(extractPdfText).toHaveBeenCalledWith(file)
    expect(useInterviewStore().resumeName).toBe('cv.pdf')
  })

  it('PDF가 아닌 파일을 떨어뜨리면 무시한다', async () => {
    const w = mountView()
    await fillProfile(w)
    await w.find('[data-test=drop]').trigger('drop', {
      dataTransfer: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] },
    })
    await flushPromises()
    expect(extractPdfText).not.toHaveBeenCalled()
    expect(useInterviewStore().resumeName).toBeNull()
  })

  it('추출 글자가 적으면 직접 붙여넣기 안내', async () => {
    vi.mocked(extractPdfText).mockResolvedValue('짧음')
    const w = mountView()
    await fillProfile(w)
    const input = w.find('[data-test=file]')
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'scan.pdf')] })
    await input.trigger('change')
    await flushPromises()
    expect(w.text()).toContain('글자를 거의 읽지 못했습니다')
    expect(w.find('[data-test=paste]').exists()).toBe(true)
  })

  it('붙여넣기는 blur 없이 입력만으로도 즉시 반영된다', async () => {
    vi.mocked(extractPdfText).mockResolvedValue('짧음')
    const w = mountView()
    await fillProfile(w)
    const input = w.find('[data-test=file]')
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'scan.pdf')] })
    await input.trigger('change')
    await flushPromises()
    await w.find('[data-test=paste]').setValue('가'.repeat(60))
    expect(useInterviewStore().resumeDone).toBe(true)
  })

  it('간단 이력서 작성을 열어 완성하면 이력서 입력이 끝난다', async () => {
    const w = mountView()
    await fillProfile(w)
    await w.find('[data-test=form-open]').trigger('click')
    expect(w.find('[data-test=form-open]').exists()).toBe(false)
    w.findComponent({ name: 'ResumeForm' }).vm.$emit(
      'done',
      '이름: 홍길동 ' + '지원동기: 가 '.repeat(20),
    )
    await flushPromises()
    expect(useInterviewStore().resumeDone).toBe(true)
    expect(useInterviewStore().resumeName).toBe('직접 작성')
    expect(w.find('[data-test=form-open]').text()).toContain('간단 이력서 수정')
  })

  it('처음엔 지원 정보만 보이고 이력서 폼은 없다; 다음 화살표는 비활성', () => {
    const w = mountView()
    expect(w.find('[data-test=step-profile]').exists()).toBe(true)
    expect(w.find('[data-test=step-resume]').exists()).toBe(false)
    expect((w.find('[data-test=step-next]').element as HTMLButtonElement).disabled).toBe(true)
    expect((w.find('[data-test=step-prev]').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('분야·직무를 채우고 직무 입력을 떠나면 같은 자리에 이력서 폼이 나타난다', async () => {
    const w = mountView()
    await w.findAll('[role=radio]')[0].trigger('click')
    await flushPromises() // 폴백 질문 로드까지 끝낸 뒤 직무 입력
    await w.find('[data-test=job]').setValue('백엔드 개발자')
    expect(w.find('[data-test=step-resume]').exists()).toBe(false) // 입력 중엔 안 넘어감
    await w.find('[data-test=job]').trigger('blur')
    await flushPromises()
    expect(w.find('[data-test=step-profile]').exists()).toBe(false)
    expect(w.find('[data-test=step-resume]').exists()).toBe(true)
    expect(w.text()).toContain('2 / 2')
  })

  it('화살표로 지원 정보 ↔ 이력서를 왕복하고, 뒤로 간 뒤엔 자동 전환하지 않는다', async () => {
    const w = mountView()
    await fillProfile(w)
    await w.find('[data-test=step-prev]').trigger('click')
    expect(w.find('[data-test=step-profile]').exists()).toBe(true)
    expect((w.find('[data-test=job]').element as HTMLInputElement).value).toBe('백엔드 개발자')
    await w.find('[data-test=job]').setValue('프론트엔드 개발자')
    await w.find('[data-test=job]').trigger('blur')
    await flushPromises()
    expect(w.find('[data-test=step-profile]').exists()).toBe(true) // 자동 전환 없음
    await w.find('[data-test=step-next]').trigger('click')
    expect(w.find('[data-test=step-resume]').exists()).toBe(true)
    expect(useInterviewStore().profile.job).toBe('프론트엔드 개발자')
  })

  it('모델 ready + 입력 완료면 버튼 활성, 클릭하면 세션을 시작한다', async () => {
    const w = mountView()
    const m = useModelStore()
    m.status = 'ready'
    const s = useInterviewStore()
    await s.setField('it')
    s.setJob('백엔드')
    s.setResume('cv.pdf', '가'.repeat(60))
    await flushPromises()
    const startSpy = vi.spyOn(s, 'start').mockResolvedValue()
    const btn = w.find('[data-test=start]')
    expect((btn.element as HTMLButtonElement).disabled).toBe(false)
    await btn.trigger('click')
    expect(startSpy).toHaveBeenCalled()
  })
})

describe('PrepareView — 캐시 지우기 후 재다운로드', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    )
    vi.stubGlobal('requestAnimationFrame', vi.fn())
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never
  })
  afterEach(() => vi.unstubAllGlobals())

  it('캐시 지우기를 누르면 지운 뒤 다시 내려받는다', async () => {
    const m = useModelStore()
    m.manifest = {
      id: 'e4b',
      url: '/models/e4b.litertlm',
      size: 100,
      template: { turnStart: '', turnEnd: '', roles: {} },
      systemPromptOverride: null,
      fallback: { id: 'e2b', url: '/models/e2b.litertlm', size: 50 },
    }
    m.active = { id: 'e4b', url: '/models/e4b.litertlm', size: 100 }
    m.status = 'error'
    m.error = '연결이 끊겼습니다'

    const w = mount(PrepareView)
    const actions = w.findAll('button').map((b) => b.text())
    expect(actions).toContain('다시 시도')
    expect(actions).toContain('경량 모델로 시도')
    expect(actions).toContain('캐시 지우기')

    const clearBtn = w.findAll('button').find((b) => b.text() === '캐시 지우기')!
    await clearBtn.trigger('click')
    await flushPromises()

    expect(clearModels).toHaveBeenCalled()
    expect(useModelStore().status).toBe('ready')
  })
})

const TTS = {
  id: 'supertonic-3',
  baseUrl: '/models/tts/supertonic-3/',
  files: [{ path: 'a.onnx', size: 100 }],
  voice: 'M2',
  lang: 'ko',
}
const manifestWithTts = {
  id: 'e4b',
  url: '/models/e4b.litertlm',
  size: 100,
  template: { turnStart: '', turnEnd: '', roles: {} },
  systemPromptOverride: null,
  fallback: null,
  tts: TTS,
}

describe('PrepareView — 목소리 준비', () => {
  it('Gemma ready + TTS 다운로드 중이면 진행 창은 voice 단계에 TTS 수치, 체크리스트에 "목소리 준비"', () => {
    const m = useModelStore()
    m.manifest = manifestWithTts
    m.status = 'ready'
    m.received = 100
    m.$patch({ ttsStatus: 'downloading', ttsReceived: 40, ttsTotal: 100 })
    const w = mountView()
    const stub = w.find('pixel-progress-stub')
    expect(stub.attributes('phase')).toBe('voice')
    expect(stub.attributes('progress')).toBe('40')
    expect(stub.attributes('filename')).toBe('supertonic-3')
    expect(w.text()).toContain('목소리 준비 (40%)')
    expect((w.find('[data-test="start"]').element as HTMLButtonElement).disabled).toBe(true)
  })
  it('TTS 실패면 error 단계 + 원인, 다시 시도는 retryTts만 부른다', async () => {
    const m = useModelStore()
    m.manifest = manifestWithTts
    m.status = 'ready'
    m.$patch({ ttsStatus: 'error', ttsError: 'size mismatch' })
    const retryTts = vi.spyOn(m, 'retryTts').mockResolvedValue()
    const retry = vi.spyOn(m, 'retry').mockResolvedValue()
    const w = mount(PrepareView)
    expect(w.text()).toContain('size mismatch')
    expect(w.text()).toContain('목소리 준비 (실패)')
    await w.find('[data-test="retry-tts"]').trigger('click')
    expect(retryTts).toHaveBeenCalled()
    expect(retry).not.toHaveBeenCalled()
    expect(w.find('[data-test="retry-model"]').exists()).toBe(false)
  })
  it('manifest.tts가 없으면 체크리스트에 목소리 항목이 없고 Gemma ready면 ready 단계', () => {
    const m = useModelStore()
    m.manifest = { ...manifestWithTts, tts: null }
    m.status = 'ready'
    m.ttsStatus = 'ready'
    const w = mountView()
    expect(w.text()).not.toContain('목소리 준비')
    expect(w.find('pixel-progress-stub').attributes('phase')).toBe('ready')
  })
  it('면접 시작 클릭은 warmUpAudio를 먼저 부른다', async () => {
    const m = useModelStore()
    m.manifest = manifestWithTts
    m.status = 'ready'
    m.ttsStatus = 'ready'
    const w = mountView()
    await fillProfile(w)
    vi.mocked(extractPdfText).mockResolvedValue('가'.repeat(100))
    const input = w.find('[data-test="file"]')
    Object.defineProperty(input.element, 'files', {
      value: [new File(['x'], 'cv.pdf', { type: 'application/pdf' })],
    })
    await input.trigger('change')
    await flushPromises()
    const interview = useInterviewStore()
    const start = vi.spyOn(interview, 'start').mockResolvedValue()
    await w.find('[data-test="start"]').trigger('click')
    expect(warmUpAudio).toHaveBeenCalled()
    expect(start).toHaveBeenCalled()
  })
})
