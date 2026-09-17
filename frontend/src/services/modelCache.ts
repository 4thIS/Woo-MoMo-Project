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
 * 스트리밍 다운로드 + 진행률. 수신 바이트가 expectedSize(매니페스트 size)와 다르면 캐시에 저장하지 않는다(설계서 6절).
 * Content-Length가 있으면 그것도 대조한다.
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
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    onProgress(received)
  }
  if (received !== expectedSize || received !== declared)
    throw new Error(`incomplete: ${received}/${expectedSize}`)
  // TS6 Uint8Array<ArrayBufferLike> vs BlobPart의 ArrayBufferView<ArrayBuffer> 불일치(타입 전용, fetch 바디는 항상 실제 ArrayBuffer).
  const blob = new Blob(chunks as BlobPart[], { type: 'application/octet-stream' })
  const cache = await caches.open(CACHE)
  await cache.put(
    cacheKey(id, url),
    new Response(blob, { headers: { 'Content-Length': String(received) } }),
  )
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
