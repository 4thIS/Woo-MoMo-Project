const CACHE = 'momo-models'

export const cacheKey = (id: string, url: string) => `/models-cache/${id}${url}`

export async function hasModel(id: string, url: string): Promise<boolean> {
  const cache = await caches.open(CACHE)
  return (await cache.match(cacheKey(id, url))) !== undefined
}

export async function getModelBlob(id: string, url: string): Promise<Blob | null> {
  const cache = await caches.open(CACHE)
  const res = await cache.match(cacheKey(id, url))
  return res ? res.blob() : null
}

/**
 * 스트리밍 다운로드 + 진행률. 청크를 메모리에 모으지 않고 Cache API에 바로 흘려 넣는다 —
 * 3GB를 JS 힙에 쌓으면(+ Blob 복사) 4GB 탭 한도에 닿아 GC 스톨·크래시가 난다.
 * 수신 바이트가 expectedSize(매니페스트 size)·Content-Length와 다르면 항목을 지우고 던진다(설계서 6절).
 */
export async function downloadModel(
  id: string,
  url: string,
  expectedSize: number,
  onProgress: (received: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, { signal })
  if (!res.ok || !res.body) throw new Error(`model fetch ${res.status}`)
  const declared = Number(res.headers.get('Content-Length') ?? expectedSize)
  let received = 0
  const counted = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        received += chunk.byteLength
        onProgress(received)
        ctl.enqueue(chunk)
      },
    }),
  )
  const cache = await caches.open(CACHE)
  const key = cacheKey(id, url)
  try {
    await cache.put(
      key,
      new Response(counted, { headers: { 'Content-Type': 'application/octet-stream' } }),
    )
  } catch (e) {
    await cache.delete(key).catch(() => undefined) // 중간에 끊긴 항목이 남지 않게
    throw e
  }
  if (received !== expectedSize || received !== declared) {
    await cache.delete(key).catch(() => undefined)
    throw new Error(`incomplete: ${received}/${expectedSize}`)
  }
}

export async function clearModels(): Promise<void> {
  await caches.delete(CACHE)
}

/**
 * 현재 매니페스트에 없는 항목을 지운다(#22). 매니페스트 주소가 바뀌거나(파이 → Hugging Face)
 * 모델 id가 바뀌면(파인튜닝 모델) 옛 항목이 수 GB씩 남으므로, 다운로드 전에 정리해 여유 공간 계산에도 반영한다.
 * @param keep 남길 캐시 키(`cacheKey()` 결과). 지운 개수를 돌려준다
 */
export async function pruneModels(keep: string[]): Promise<number> {
  const cache = await caches.open(CACHE)
  const keepUrls = new Set(keep.map((k) => new URL(k, location.href).href))
  let removed = 0
  for (const req of await cache.keys()) {
    if (keepUrls.has(req.url)) continue
    await cache.delete(req)
    removed++
  }
  return removed
}
