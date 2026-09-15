import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cacheKey, clearModels, downloadModel, getModelBlob, hasModel } from './modelCache'

/** Cache API 최소 가짜: Map 하나 */
function fakeCaches() {
  const store = new Map<string, Response>()
  const cache = {
    match: async (k: string) => store.get(k) ?? undefined,
    put: async (k: string, r: Response) => void store.set(k, r),
  }
  return { open: async () => cache, delete: async () => true, _store: store }
}

function streamOf(chunks: Uint8Array[], contentLength: number) {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      chunks.forEach((ch) => c.enqueue(ch))
      c.close()
    },
  })
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'Content-Length': String(contentLength) }),
    body,
  } as Response
}

let caches: ReturnType<typeof fakeCaches>
beforeEach(() => {
  caches = fakeCaches()
  vi.stubGlobal('caches', caches)
})
afterEach(() => vi.unstubAllGlobals())

describe('modelCache', () => {
  it('키는 id와 url을 포함한다', () => {
    expect(cacheKey('m1', '/models/a.litertlm')).toBe('/models-cache/m1/models/a.litertlm')
  })

  it('진행률을 보고하고 완료 후 캐시에 넣는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamOf([new Uint8Array(3), new Uint8Array(2)], 5)),
    )
    const seen: number[] = []
    await downloadModel('m1', '/models/a', 5, (r) => seen.push(r))
    expect(seen).toEqual([3, 5])
    expect(await hasModel('m1', '/models/a')).toBe(true)
    expect((await getModelBlob('m1', '/models/a'))?.size).toBe(5)
  })

  it('수신 바이트가 크기와 다르면 캐시에 넣지 않고 던진다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamOf([new Uint8Array(3)], 5)),
    )
    await expect(downloadModel('m1', '/models/a', 5, () => {})).rejects.toThrow('incomplete')
    expect(await hasModel('m1', '/models/a')).toBe(false)
  })

  it('clearModels는 캐시를 지운다', async () => {
    const del = vi.spyOn(caches, 'delete')
    await clearModels()
    expect(del).toHaveBeenCalledWith('momo-models')
  })
})
