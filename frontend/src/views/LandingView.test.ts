import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/gpuCheck', () => ({ checkEnvironment: vi.fn() }))
vi.mock('@/services/api', () => ({ getManifest: vi.fn(), getQuestions: vi.fn() }))
vi.mock('@/services/modelCache', () => ({
  hasModel: vi.fn(async () => false),
  downloadModel: vi.fn(async () => {}),
  clearModels: vi.fn(),
  getModelBlob: vi.fn(async () => new Blob(['x'])),
  pruneModels: vi.fn(async () => 0),
  cacheKey: (id: string, url: string) => `/models-cache/${id}${url}`,
}))
vi.mock('@/services/llm', () => ({
  initEngine: vi.fn(async () => {}),
  disposeEngine: vi.fn(async () => {}),
}))

import { checkEnvironment } from '@/services/gpuCheck'
import { downloadModel, hasModel } from '@/services/modelCache'
import { getManifest } from '@/services/api'
import { useModelStore } from '@/stores/model'
import { useInterviewStore } from '@/stores/interview'
import LandingView from './LandingView.vue'

const manifest = {
  id: 'e4b',
  url: '/models/e4b.litertlm',
  size: 2969059328,
  template: { turnStart: '', turnEnd: '', roles: {} },
  systemPromptOverride: null,
  fallback: null,
}

const TTS = {
  id: 'supertonic-3',
  baseUrl: 'https://huggingface.co/x/resolve/abc/',
  files: [
    { path: 'onnx/a.onnx', size: 300_000_000 },
    { path: 'onnx/b.onnx', size: 98_653_257 },
  ],
  voice: 'M2',
  lang: 'ko',
}

const mountView = () =>
  mount(LandingView, {
    global: { stubs: { SpeechText: { props: ['text'], template: '<p>{{ text }}</p>' } } },
  })

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.mocked(getManifest).mockResolvedValue(manifest)
  vi.mocked(checkEnvironment).mockResolvedValue({
    webgpu: true,
    webgpuReason: null,
    gpuName: 'Test GPU',
    storageFree: 10e9,
  })
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('LandingView', () => {
  it('매니페스트 용량을 동의 창에 보여준다 — tts가 없으면 음성·합계 행 없음', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.text()).toContain('약 2.8GB')
    expect(w.text()).not.toContain('음성 모델')
    expect(w.text()).not.toContain('합계')
    expect(w.text()).toContain('모델 다운로드에 동의하시겠습니까?')
  })
  it('tts가 있으면 표에 두 행(모델·음성 모델), 이름과 용량은 다른 열, 합계는 표 아래 한 줄 (#32)', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts: TTS })
    const w = mountView()
    await flushPromises()
    expect(w.text()).toContain('면접관 모델·목소리 다운로드에 동의하시겠습니까?')
    const rows = w.findAll('[data-test="model-row"]')
    expect(rows).toHaveLength(2)
    const cells = (i: number) => rows[i].findAll('td').map((c) => c.text())
    expect(cells(0)).toEqual([
      '',
      'e4b',
      '약 2.8GB',
      '이 브라우저의 캐시',
      '사이트 데이터 삭제로 언제든',
    ])
    expect(cells(1).slice(1, 3)).toEqual(['supertonic-3 (목소리 M2)', '약 380MB'])
    expect(w.findAll('th').map((h) => h.text())).toEqual([
      '받기',
      '모델',
      '용량',
      '저장 위치',
      '삭제',
    ])
    expect(w.find('[data-test="total"]').text()).toBe('합계 약 3.1GB')
    expect(w.text()).toContain('음성은 브라우저에서 AI로 합성됩니다') // #34
  })
  it('tts가 없으면 한 행뿐, 합계·합성 안내 없음', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.findAll('[data-test="model-row"]')).toHaveLength(1)
    expect(w.find('[data-test="total"]').exists()).toBe(false)
    expect(w.text()).not.toContain('AI로 합성')
  })
  it('체크박스: Gemma는 체크 고정(비활성), 목소리는 기본 체크이고 해제하면 합계·필요 용량이 모델만 (#36)', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts: TTS })
    const w = mountView()
    await flushPromises()
    const gemma = w.find('[data-test="pick-model"]').element as HTMLInputElement
    const voice = w.find('[data-test="pick-voice"]')
    expect(gemma.checked).toBe(true)
    expect(gemma.disabled).toBe(true)
    expect((voice.element as HTMLInputElement).checked).toBe(true)
    await voice.setValue(false)
    expect(useModelStore().voiceWanted).toBe(false)
    expect(w.find('[data-test="total"]').text()).toBe('합계 약 2.8GB')
    expect(w.text()).not.toContain('AI로 합성')
    await w.findAll('[role=radio]')[0].trigger('click')
    await flushPromises()
    expect(w.text()).toContain('필요 2.8GB')
  })
  it('장비 확인의 필요 용량은 모델 + 음성 모델 합계다 (#27)', async () => {
    vi.mocked(getManifest).mockResolvedValue({
      ...manifest,
      tts: {
        id: 't',
        baseUrl: '/m/',
        files: [{ path: 'a', size: 398_653_257 }],
        voice: 'M2',
        lang: 'ko',
      },
    })
    vi.mocked(checkEnvironment).mockResolvedValue({
      webgpu: true,
      webgpuReason: null,
      gpuName: 'Test GPU',
      storageFree: 50 * 1024 ** 3,
    })
    const w = mountView()
    await flushPromises()
    await w.findAll('[role=radio]')[0].trigger('click')
    await flushPromises()
    expect(w.text()).toContain('필요 3.1GB')
  })

  it('동의 "네"를 고르면 장비 확인 창이 열리고 결과가 나온다', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.find('[data-test=env]').exists()).toBe(false)
    await w.findAll('[role=radio]')[0].trigger('click')
    await flushPromises()
    expect(w.find('[data-test=env]').exists()).toBe(true)
    expect(w.text()).toContain('Test GPU')
    expect(w.text()).toContain('출전 가능')
  })

  it('WebGPU가 없으면 실행 불가 + 버튼 비활성 + 브라우저 안내', async () => {
    vi.mocked(checkEnvironment).mockResolvedValue({
      webgpu: false,
      webgpuReason: 'no-api',
      gpuName: null,
      storageFree: null,
    })
    const w = mountView()
    await flushPromises()
    await w.findAll('[role=radio]')[0].trigger('click')
    await flushPromises()
    expect(w.text()).toContain('실행 불가')
    expect(w.text()).toContain('Chrome')
    expect((w.find('[data-test=start-download]').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('어댑터를 못 잡으면 그래픽 가속 켜는 순서를 안내하고, 다시 확인으로 재검사한다', async () => {
    vi.mocked(checkEnvironment).mockResolvedValue({
      webgpu: false,
      webgpuReason: 'no-adapter',
      gpuName: null,
      storageFree: null,
    })
    const w = mountView()
    await flushPromises()
    await w.findAll('[role=radio]')[0].trigger('click')
    await flushPromises()
    expect(w.text()).toContain('그래픽 가속')
    expect(w.text()).toContain('chrome://settings/system')
    vi.mocked(checkEnvironment).mockResolvedValue({
      webgpu: true,
      webgpuReason: null,
      gpuName: 'Test GPU',
      storageFree: 50 * 1024 ** 3,
    })
    await w.find('[data-test=recheck]').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('출전 가능')
    expect(w.find('[data-test=recheck]').exists()).toBe(false)
  })

  it('매니페스트 로드 실패 시 판정 없음 + 버튼 비활성, 5초 전엔 안내 없음', async () => {
    vi.mocked(getManifest).mockRejectedValue(new Error('network'))
    const w = mountView()
    await flushPromises()
    expect(w.text()).not.toContain('서버에 연결할 수 없습니다')
    await w.findAll('[role=radio]')[0].trigger('click')
    await flushPromises()
    expect(w.text()).not.toContain('출전 가능')
    expect((w.find('[data-test=start-download]').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('내려받기 시작 → 다운로드 시작 + prepare로 이동', async () => {
    const w = mountView()
    await flushPromises()
    await w.findAll('[role=radio]')[0].trigger('click')
    await flushPromises()
    await w.find('[data-test=start-download]').trigger('click')
    await flushPromises()
    expect(useInterviewStore().phase).toBe('prepare')
    expect(useModelStore().status).toBe('ready')
  })
})

describe('LandingView — 재방문 (#33)', () => {
  beforeEach(() => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts: TTS })
    vi.mocked(hasModel).mockResolvedValue(true)
  })
  afterEach(() => vi.mocked(hasModel).mockResolvedValue(false))

  it('캐시가 다 있으면 동의 창은 접힌 통과 표시, 장비 확인은 자동 실행돼 접힌 한 줄 + "바로 준비하기"', async () => {
    const w = mountView()
    await flushPromises()
    const consent = w.find('[data-test="revisit-consent"]')
    expect(consent.exists()).toBe(true)
    expect(consent.text()).toContain('e4b · supertonic-3')
    expect(consent.text()).toContain('이 브라우저에 저장됨')
    expect(w.find('[role=radio]').exists()).toBe(false) // 동의를 다시 고르지 않는다
    expect(checkEnvironment).toHaveBeenCalled()
    const env = w.find('[data-test="revisit-env"]')
    expect(env.text()).toContain('WebGPU')
    expect(env.text()).toContain('Test GPU')
    const go = w.find('[data-test="go-prepare"]')
    expect(go.exists()).toBe(true)
    await go.trigger('click')
    await flushPromises()
    expect(useInterviewStore().phase).toBe('prepare')
    expect(useModelStore().status).toBe('ready') // 캐시 히트 → 다운로드 없이 초기화만
    expect(downloadModel).not.toHaveBeenCalled()
  })
  it('접힌 동의 창을 펼치면 표(체크박스)가 보이고, 목소리를 해제해도 재방문(Gemma 캐시)이면 그대로 접힌 흐름', async () => {
    const w = mountView()
    await flushPromises()
    await w.find('[data-test="revisit-expand"]').trigger('click')
    expect(w.findAll('[data-test="model-row"]')).toHaveLength(2)
    await w.find('[data-test="pick-voice"]').setValue(false)
    await flushPromises()
    expect(w.find('[data-test="revisit-consent"]').exists()).toBe(true)
    expect(w.find('[data-test="revisit-consent"]').text()).toContain('목소리 없음')
  })
  it('캐시에 TTS 일부가 없으면 첫 방문 흐름(동의 선택)', async () => {
    vi.mocked(hasModel).mockImplementation(async (id) => id === 'e4b')
    const w = mountView()
    await flushPromises()
    expect(w.find('[data-test="revisit-consent"]').exists()).toBe(false)
    expect(w.find('[role=radio]').exists()).toBe(true)
  })
  it('재방문이면 이미 받아 둔 것이라 저장 공간이 부족해도 막지 않는다', async () => {
    vi.mocked(checkEnvironment).mockResolvedValue({
      webgpu: true,
      webgpuReason: null,
      gpuName: 'Test GPU',
      storageFree: 100 * 1024 ** 2, // 100MB
    })
    const w = mountView()
    await flushPromises()
    expect(w.find('[data-test="revisit-env"]').text()).toContain('이미 받아 둠')
    expect(w.find('[data-test="go-prepare"]').exists()).toBe(true)
    expect(w.text()).not.toContain('공간 부족')
  })
  it('재방문이어도 WebGPU 실패면 장비 확인은 접지 않고 원인별 조치를 보여준다', async () => {
    vi.mocked(checkEnvironment).mockResolvedValue({
      webgpu: false,
      webgpuReason: 'no-api',
      gpuName: null,
      storageFree: null,
    })
    const w = mountView()
    await flushPromises()
    expect(w.find('[data-test="revisit-env"]').exists()).toBe(false)
    expect(w.find('[data-test="fix-webgpu"]').exists()).toBe(true)
    expect(w.find('[data-test="go-prepare"]').exists()).toBe(false)
  })
})
