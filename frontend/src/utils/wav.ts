/** 녹음 조각을 서버가 받는 WAV로 바꾼다 (`docs/API.md` 목소리 분석 업로드).
 *
 * 서버는 16kHz 모노 PCM 16비트를 기대하고 RIFF/WAVE 머리를 확인한다. 5MB를 넘으면 413으로
 * 돌려보내므로 **여기서 미리 자른다** — 잘린 앞부분만으로도 분석은 된다.
 */

export const VOICE_SAMPLE_RATE = 16_000
export const VOICE_MAX_BYTES = 5 * 1024 * 1024
const HEADER = 44
const MAX_SAMPLES = Math.floor((VOICE_MAX_BYTES - HEADER) / 2)

/** 선형 보간. 받아쓰기에 쓰는 소리라 품질보다 길이·형식이 맞는 쪽이 중요하다 */
function resample(samples: Float32Array, from: number): Float32Array {
  if (!(from > 0) || from === VOICE_SAMPLE_RATE) return samples
  const ratio = from / VOICE_SAMPLE_RATE
  const n = Math.floor(samples.length / ratio)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const at = i * ratio
    const lo = Math.floor(at)
    const hi = Math.min(lo + 1, samples.length - 1)
    const t = at - lo
    out[i] = samples[lo] * (1 - t) + samples[hi] * t
  }
  return out
}

export function toWav16k(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const pcm = resample(samples, sampleRate).subarray(0, MAX_SAMPLES)
  const buf = new ArrayBuffer(HEADER + pcm.length * 2)
  const v = new DataView(buf)
  const tag = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i))
  }

  tag(0, 'RIFF')
  v.setUint32(4, buf.byteLength - 8, true)
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  v.setUint32(16, 16, true) // fmt 길이
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // 모노
  v.setUint32(24, VOICE_SAMPLE_RATE, true)
  v.setUint32(28, VOICE_SAMPLE_RATE * 2, true) // byteRate
  v.setUint16(32, 2, true) // blockAlign
  v.setUint16(34, 16, true)
  tag(36, 'data')
  v.setUint32(40, pcm.length * 2, true)

  for (let i = 0; i < pcm.length; i++) {
    // 범위를 벗어난 값은 가둔다 — 넘치면 소리가 뒤집혀 들린다
    const s = Math.max(-1, Math.min(1, pcm[i]))
    v.setInt16(HEADER + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buf
}
