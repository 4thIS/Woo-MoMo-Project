/// <reference lib="webworker" />
/** Supertonic 3 TTS 워커 — onnxruntime-web(WebGPU)은 이 파일에서만 import. 파이프라인은 supertonic web/helper.js(MIT) 이식 */
import * as ort from 'onnxruntime-web/webgpu'
import {
  DEFAULT_MAX,
  KO_JA_MAX,
  chunkText,
  gaussianNoise,
  latentShape,
  lengthMask,
  normalizeText,
  textToIds,
} from '@/utils/tts'
import {
  SILENCE_SEC,
  SPEED,
  TOTAL_STEP,
  type MainToWorker,
  type TtsLoadFile,
  type WorkerToMain,
} from './ttsProtocol'

type Cfg = {
  ae: { sample_rate: number; base_chunk_size: number }
  ttl: { chunk_compress_factor: number; latent_dim: number }
}
type Style = { ttl: ort.Tensor; dp: ort.Tensor }
const CACHE = 'momo-models'

let sessions: {
  dp: ort.InferenceSession
  enc: ort.InferenceSession
  est: ort.InferenceSession
  voc: ort.InferenceSession
} | null = null
let cfg: Cfg | null = null
let style: Style | null = null
let indexer: number[] = []
let lang = 'ko'
const cancelled = new Set<number>()

const post = (m: WorkerToMain, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(m, transfer)

/** 캐시 우선, 없으면 fetch. (initTts가 먼저 내려받아 캐시에 넣어 두므로 보통 캐시 히트) */
async function fetchFile(f: TtsLoadFile): Promise<Response> {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(f.cacheKey)
  if (hit) return hit
  const res = await fetch(f.url)
  if (!res.ok) throw new Error(`tts file ${res.status}: ${f.path}`)
  return res
}
const byPath = (files: TtsLoadFile[], suffix: string) => {
  const f = files.find((x) => x.path.endsWith(suffix))
  if (!f) throw new Error(`manifest.tts에 ${suffix} 없음`)
  return f
}

async function load(msg: Extract<MainToWorker, { type: 'load' }>) {
  if (!('gpu' in navigator)) throw new Error('이 브라우저(워커)에서 WebGPU를 쓸 수 없습니다')
  ort.env.wasm.wasmPaths = msg.wasmPaths
  ort.env.wasm.numThreads = 1
  lang = msg.lang
  const opt: ort.InferenceSession.SessionOptions = {
    executionProviders: ['webgpu'],
    graphOptimizationLevel: 'all',
  }
  const mk = async (suffix: string, stage: string) => {
    post({ type: 'progress', stage })
    const buf = await (await fetchFile(byPath(msg.files, suffix))).arrayBuffer()
    return ort.InferenceSession.create(buf, opt)
  }
  const dp = await mk('duration_predictor.onnx', '길이 예측기')
  const enc = await mk('text_encoder.onnx', '텍스트 인코더')
  const est = await mk('vector_estimator.onnx', '벡터 추정기')
  const voc = await mk('vocoder.onnx', '보코더')
  cfg = (await (await fetchFile(byPath(msg.files, 'tts.json'))).json()) as Cfg
  indexer = (await (await fetchFile(byPath(msg.files, 'unicode_indexer.json'))).json()) as number[]
  const vs = (await (
    await fetchFile(byPath(msg.files, `voice_styles/${msg.voice}.json`))
  ).json()) as {
    style_ttl: { dims: number[]; data: number[][][] }
    style_dp: { dims: number[]; data: number[][][] }
  }
  const flat = (d: number[][][]) => Float32Array.from(d.flat(2))
  style = {
    ttl: new ort.Tensor('float32', flat(vs.style_ttl.data), [
      1,
      vs.style_ttl.dims[1],
      vs.style_ttl.dims[2],
    ]),
    dp: new ort.Tensor('float32', flat(vs.style_dp.data), [
      1,
      vs.style_dp.dims[1],
      vs.style_dp.dims[2],
    ]),
  }
  sessions = { dp, enc, est, voc }
}

/** 한 청크 합성: duration → text_encoder → vector_estimator×TOTAL_STEP → vocoder */
async function inferChunk(text: string): Promise<{ wav: Float32Array; durSec: number }> {
  if (!sessions || !cfg || !style) throw new Error('not loaded')
  const wrapped = normalizeText(text, lang)
  const ids = textToIds(wrapped, indexer)
  const textIds = new ort.Tensor(
    'int64',
    BigInt64Array.from(ids, (x) => BigInt(x)),
    [1, ids.length],
  )
  const textMask = new ort.Tensor('float32', Float32Array.from(lengthMask([ids.length])[0]), [
    1,
    1,
    ids.length,
  ])

  const dpOut = await sessions.dp.run({
    text_ids: textIds,
    style_dp: style.dp,
    text_mask: textMask,
  })
  const durSec = Number((dpOut.duration.data as Float32Array)[0]) / SPEED

  const encOut = await sessions.enc.run({
    text_ids: textIds,
    style_ttl: style.ttl,
    text_mask: textMask,
  })
  const textEmb = encOut.text_emb

  const { latentLen, latentDimVal, chunkSize } = latentShape(
    durSec,
    cfg.ae.sample_rate,
    cfg.ae.base_chunk_size,
    cfg.ttl.chunk_compress_factor,
    cfg.ttl.latent_dim,
  )
  const validLen = Math.floor((Math.floor(durSec * cfg.ae.sample_rate) + chunkSize - 1) / chunkSize)
  const mask = Float32Array.from(lengthMask([validLen], latentLen)[0])
  let xt = gaussianNoise(latentDimVal * latentLen)
  for (let d = 0; d < latentDimVal; d++)
    for (let t = 0; t < latentLen; t++) xt[d * latentLen + t] *= mask[t]
  const latentMask = new ort.Tensor('float32', mask, [1, 1, latentLen])
  const totalStep = new ort.Tensor('float32', Float32Array.of(TOTAL_STEP), [1])
  for (let step = 0; step < TOTAL_STEP; step++) {
    const out = await sessions.est.run({
      noisy_latent: new ort.Tensor('float32', xt, [1, latentDimVal, latentLen]),
      text_emb: textEmb,
      style_ttl: style.ttl,
      latent_mask: latentMask,
      text_mask: textMask,
      current_step: new ort.Tensor('float32', Float32Array.of(step), [1]),
      total_step: totalStep,
    })
    xt = Float32Array.from(out.denoised_latent.data as Float32Array)
  }
  const voc = await sessions.voc.run({
    latent: new ort.Tensor('float32', xt, [1, latentDimVal, latentLen]),
  })
  return { wav: Float32Array.from(voc.wav_tts.data as Float32Array), durSec }
}

async function synthesize(id: number, text: string) {
  if (!sessions || !cfg) throw new Error('not loaded')
  const maxLen = lang === 'ko' || lang === 'ja' ? KO_JA_MAX : DEFAULT_MAX
  const chunks = chunkText(text, maxLen)
  const parts: Float32Array[] = []
  const silence = new Float32Array(Math.floor(SILENCE_SEC * cfg.ae.sample_rate))
  for (let i = 0; i < chunks.length; i++) {
    if (cancelled.has(id)) return
    if (i > 0) parts.push(silence)
    parts.push((await inferChunk(chunks[i])).wav)
  }
  if (cancelled.has(id)) return
  const total = parts.reduce((n, p) => n + p.length, 0)
  const samples = new Float32Array(total)
  let off = 0
  for (const p of parts) {
    samples.set(p, off)
    off += p.length
  }
  post({ type: 'audio', id, samples, sampleRate: cfg.ae.sample_rate }, [samples.buffer])
}

self.onmessage = async (e: MessageEvent<MainToWorker>) => {
  const m = e.data
  try {
    if (m.type === 'load') {
      await load(m)
      post({ type: 'loaded' })
    } else if (m.type === 'synthesize') {
      await synthesize(m.id, m.text)
    } else if (m.type === 'cancel') {
      cancelled.add(m.id)
    }
  } catch (err) {
    post({
      type: 'error',
      id: m.type === 'synthesize' ? m.id : undefined,
      message: err instanceof Error ? err.message : String(err),
    })
  } finally {
    if (m.type === 'synthesize') cancelled.delete(m.id)
  }
}
