import { afterEach, describe, expect, it, vi } from 'vitest'
import { getManifest, getQuestions } from './api'

const json = (body: unknown, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as Response)

afterEach(() => vi.unstubAllGlobals())

describe('api', () => {
  it('getManifest는 /api/manifest 응답을 그대로 돌려준다', async () => {
    const manifest = {
      id: 'm',
      url: '/models/m.litertlm',
      size: 1,
      template: { turnStart: 'a', turnEnd: 'b', roles: {} },
      systemPromptOverride: null,
      fallback: null,
    }
    const fetchMock = vi.fn(() => json(manifest))
    vi.stubGlobal('fetch', fetchMock)
    expect(await getManifest()).toEqual(manifest)
    expect(fetchMock).toHaveBeenCalledWith('/api/manifest')
  })
  it('getQuestions는 field를 소문자로 보낸다', async () => {
    const fetchMock = vi.fn(() => json({ field: 'it', questions: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await getQuestions('IT')
    expect(fetchMock).toHaveBeenCalledWith('/api/questions/it')
  })
  it('비정상 응답이면 던진다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => json({}, false)),
    )
    await expect(getManifest()).rejects.toThrow('/api/manifest 500')
  })
})
