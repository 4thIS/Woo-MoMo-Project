import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/api', () => ({ getManifest: vi.fn() }))
vi.mock('@/services/modelCache', () => ({
  hasModel: vi.fn(),
  downloadModel: vi.fn(),
  clearModels: vi.fn(),
  getModelBlob: vi.fn(),
}))
vi.mock('@/services/llm', () => ({ initEngine: vi.fn(), disposeEngine: vi.fn() }))

import { getManifest } from '@/services/api'
import { downloadModel, getModelBlob, hasModel } from '@/services/modelCache'
import { initEngine } from '@/services/llm'
import { useModelStore } from './model'

const manifest = {
  id: 'e4b',
  url: '/models/e4b.litertlm',
  size: 100,
  template: { turnStart: '<|turn>', turnEnd: '<turn|>', roles: {} },
  systemPromptOverride: null,
  fallback: { id: 'e2b', url: '/models/e2b.litertlm', size: 50 },
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(getManifest).mockResolvedValue(manifest)
  vi.mocked(hasModel).mockResolvedValue(false)
  vi.mocked(downloadModel).mockImplementation(async (_id, _url, _size, onProgress) => {
    onProgress(50)
    onProgress(100)
  })
  vi.mocked(getModelBlob).mockResolvedValue(new Blob(['x']))
  vi.mocked(initEngine).mockResolvedValue(undefined)
})

describe('model store', () => {
  it('매니페스트를 읽어 total을 세팅한다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    expect(s.manifest?.id).toBe('e4b')
    expect(s.total).toBe(100)
    expect(s.status).toBe('idle')
  })

  it('download는 진행률을 반영하고 downloaded로 끝난다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    const p = s.download()
    expect(s.status).toBe('downloading')
    await p
    expect(s.received).toBe(100)
    expect(s.progress).toBe(100)
    expect(s.status).toBe('ready')
  })

  it('캐시에 있으면 다운로드를 건너뛴다', async () => {
    vi.mocked(hasModel).mockResolvedValue(true)
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(downloadModel).not.toHaveBeenCalled()
    expect(s.status).toBe('ready')
  })

  it('실패하면 error와 메시지', async () => {
    vi.mocked(downloadModel).mockRejectedValue(new Error('incomplete: 3/100'))
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(s.status).toBe('error')
    expect(s.error).toContain('incomplete')
  })

  it('useFallback은 폴백 모델로 바꿔 다시 받는다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.useFallback()
    expect(s.active?.id).toBe('e2b')
    expect(downloadModel).toHaveBeenCalledWith(
      'e2b',
      '/models/e2b.litertlm',
      50,
      expect.any(Function),
      undefined,
    )
  })

  it('매니페스트 실패는 manifestError에 남는다', async () => {
    vi.mocked(getManifest).mockRejectedValue(new Error('/api/manifest 500'))
    const s = useModelStore()
    await s.loadManifest()
    expect(s.manifestError).toContain('500')
  })

  it('active 없이 download를 호출하면 error 상태로 남는다', async () => {
    const s = useModelStore()
    await s.download()
    expect(s.status).toBe('error')
    expect(s.error).toContain('manifest')
  })

  it('download 후 init이 이어져 ready가 된다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(initEngine).toHaveBeenCalledWith(expect.any(Blob), { maxNumTokens: 8192 })
    expect(s.status).toBe('ready')
  })

  it('init 실패는 error + initFailed', async () => {
    vi.mocked(initEngine).mockRejectedValue(new Error('gpu oom'))
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(s.status).toBe('error')
    expect(s.error).toBe('gpu oom')
    expect(s.initFailed).toBe(true)
  })

  it('캐시에 Blob이 없으면 error', async () => {
    vi.mocked(getModelBlob).mockResolvedValue(null)
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(s.status).toBe('error')
  })
})
