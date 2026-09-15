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
}))

import { extractPdfText } from '@/services/pdf'
import { clearModels } from '@/services/modelCache'
import { useModelStore } from '@/stores/model'
import { useInterviewStore } from '@/stores/interview'
import PrepareView from './PrepareView.vue'

const mountView = () => mount(PrepareView, { global: { stubs: { PixelProgress: true } } })

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
    await w.findAll('[role=radio]')[0].trigger('click') // IT
    await w.find('[data-test=job]').setValue('백엔드 개발자')
    const input = w.find('[data-test=file]')
    Object.defineProperty(input.element, 'files', {
      value: [new File(['x'], 'cv.pdf', { type: 'application/pdf' })],
    })
    await input.trigger('change')
    await flushPromises()
    expect(w.text()).toContain('입력 완료')
    expect(w.text()).toMatch(/\d+자 추출/)
    expect(useInterviewStore().resumeName).toBe('cv.pdf')
  })

  it('추출 글자가 적으면 직접 붙여넣기 안내', async () => {
    vi.mocked(extractPdfText).mockResolvedValue('짧음')
    const w = mountView()
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
    const input = w.find('[data-test=file]')
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'scan.pdf')] })
    await input.trigger('change')
    await flushPromises()
    await w.find('[data-test=paste]').setValue('가'.repeat(60))
    expect(useInterviewStore().resumeDone).toBe(true)
  })

  it('모델 ready + 입력 완료면 버튼 활성, 클릭하면 interview로', async () => {
    const w = mountView()
    const m = useModelStore()
    m.status = 'ready'
    const s = useInterviewStore()
    await s.setField('it')
    s.setJob('백엔드')
    s.setResume('cv.pdf', '가'.repeat(60))
    await flushPromises()
    const btn = w.find('[data-test=start]')
    expect((btn.element as HTMLButtonElement).disabled).toBe(false)
    await btn.trigger('click')
    expect(s.phase).toBe('interview')
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
    expect(useModelStore().status).toBe('downloaded')
  })
})
