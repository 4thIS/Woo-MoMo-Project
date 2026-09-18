import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cacheKey,
  clearModels,
  downloadModel,
  getModelBlob,
  hasModel,
  pruneModels,
} from './modelCache'

/** Cache API 최소 가짜: Map 하나 */
function fakeCaches() {
  const store = new Map<string, Response>()
  const cache = {
    match: async (k: string) => store.get(k) ?? undefined,
    // 실제 Cache API처럼 put은 바디를 끝까지 읽어 저장한다(스트리밍 Response도 여기서 소비된다)
    put: async (k: string, r: Response) => void store.set(k, new Response(await r.arrayBuffer())),
    // 실제 Cache API처럼 키를 절대 URL을 가진 Request 모양으로 돌려준다
    keys: async () => [...store.keys()].map((k) => ({ url: new URL(k, location.href).href })),
    delete: async (req: string | { url: string }) =>
      store.delete(
        typeof req === 'string' ? req : new URL(req.url).pathname + new URL(req.url).search,
      ),
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
  // jsdom의 Blob과 Node(undici)의 Response는 서로를 인식하지 못해 Response가 Blob을 문자열로 바꿔버린다.
  // Response가 인식하는 Node Blob으로 전역을 바꿔 실제 브라우저 동작(Response가 Blob을 그대로 받음)에 맞춘다.
  vi.stubGlobal('Blob', NodeBlob)
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

  it('스트림이 중간에 끊기면 항목을 남기지 않는다', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(3))
        c.error(new Error('network down'))
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            headers: new Headers({ 'Content-Length': '5' }),
            body,
          }) as Response,
      ),
    )
    await expect(downloadModel('m1', '/models/a', 5, () => {})).rejects.toThrow('network down')
    expect(await hasModel('m1', '/models/a')).toBe(false)
  })

  it('clearModels는 캐시를 지운다', async () => {
    const del = vi.spyOn(caches, 'delete')
    await clearModels()
    expect(del).toHaveBeenCalledWith('momo-models')
  })
})

describe('pruneModels (#22)', () => {
  it('현재 매니페스트에 없는 옛 항목만 지우고 현 키는 남긴다', async () => {
    const keep = cacheKey('e4b', 'https://huggingface.co/x/resolve/abc/e4b.litertlm')
    caches._store.set(keep, new Response('new'))
    caches._store.set(cacheKey('e4b', '/models/e4b.litertlm'), new Response('old1'))
    caches._store.set(cacheKey('e2b', '/models/e2b.litertlm'), new Response('old2'))
    const removed = await pruneModels([keep])
    expect(removed).toBe(2)
    expect([...caches._store.keys()]).toEqual([keep])
  })
  it('지울 게 없으면 0', async () => {
    const keep = cacheKey('e4b', '/models/e4b.litertlm')
    caches._store.set(keep, new Response('x'))
    expect(await pruneModels([keep])).toBe(0)
  })
})
