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
}))
vi.mock('@/services/llm', () => ({
  initEngine: vi.fn(async () => {}),
  disposeEngine: vi.fn(async () => {}),
}))

import { checkEnvironment } from '@/services/gpuCheck'
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

const mountView = () =>
  mount(LandingView, {
    global: { stubs: { SpeechText: { props: ['text'], template: '<p>{{ text }}</p>' } } },
  })

beforeEach(() => {
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
  it('매니페스트 용량을 동의 창에 보여준다', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.text()).toContain('약 2.8GB')
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
