import { describe, expect, it } from 'vitest'
import { VOICE_MAX_BYTES, VOICE_SAMPLE_RATE, toWav16k } from './wav'

/** 헤더 읽기 도우미 */
const view = (b: ArrayBuffer) => new DataView(b)
const ascii = (b: ArrayBuffer, at: number, n: number) =>
  String.fromCharCode(...new Uint8Array(b, at, n))

const tone = (n: number) => Float32Array.from({ length: n }, (_, i) => Math.sin(i / 8))

describe('toWav16k', () => {
  it('RIFF/WAVE 머리를 붙인다 — 서버가 이걸로 확인한다', () => {
    const b = toWav16k(tone(100), VOICE_SAMPLE_RATE)
    expect(ascii(b, 0, 4)).toBe('RIFF')
    expect(ascii(b, 8, 4)).toBe('WAVE')
    expect(ascii(b, 12, 4)).toBe('fmt ')
    expect(ascii(b, 36, 4)).toBe('data')
  })

  it('16kHz 모노 PCM 16비트로 적는다', () => {
    const v = view(toWav16k(tone(100), VOICE_SAMPLE_RATE))
    expect(v.getUint16(20, true)).toBe(1) // PCM
    expect(v.getUint16(22, true)).toBe(1) // 모노
    expect(v.getUint32(24, true)).toBe(VOICE_SAMPLE_RATE)
    expect(v.getUint16(34, true)).toBe(16) // 비트
    expect(v.getUint32(28, true)).toBe(VOICE_SAMPLE_RATE * 2) // byteRate
    expect(v.getUint16(32, true)).toBe(2) // blockAlign
  })

  it('길이 칸이 실제 크기와 맞는다', () => {
    const b = toWav16k(tone(100), VOICE_SAMPLE_RATE)
    const v = view(b)
    expect(v.getUint32(40, true)).toBe(100 * 2)
    expect(v.getUint32(4, true)).toBe(b.byteLength - 8)
    expect(b.byteLength).toBe(44 + 200)
  })

  it('48kHz를 16kHz로 줄인다 — 길이가 1/3이 된다', () => {
    const b = toWav16k(tone(4800), 48000)
    expect(view(b).getUint32(40, true)).toBe(1600 * 2)
  })

  it('이미 16kHz면 그대로 쓴다', () => {
    const b = toWav16k(tone(1600), VOICE_SAMPLE_RATE)
    expect(view(b).getUint32(40, true)).toBe(1600 * 2)
  })

  it('8kHz도 16kHz로 맞춘다 — 서버가 한 가지만 받는다', () => {
    const b = toWav16k(tone(800), 8000)
    expect(view(b).getUint32(40, true)).toBe(1600 * 2)
  })

  it('소리 크기를 16비트 범위 안에 가둔다', () => {
    const b = toWav16k(Float32Array.from([2, -2, 0]), VOICE_SAMPLE_RATE)
    const v = view(b)
    expect(v.getInt16(44, true)).toBe(32767)
    expect(v.getInt16(46, true)).toBe(-32768)
    expect(v.getInt16(48, true)).toBe(0)
  })

  it('5MB를 넘으면 앞부분만 남긴다 — 서버가 413으로 돌려보낸다', () => {
    const tooMany = Math.floor(VOICE_MAX_BYTES / 2) + 1000
    const b = toWav16k(tone(tooMany), VOICE_SAMPLE_RATE)
    expect(b.byteLength).toBeLessThanOrEqual(VOICE_MAX_BYTES)
    // 잘려도 머리는 멀쩡해야 한다
    expect(ascii(b, 0, 4)).toBe('RIFF')
    expect(view(b).getUint32(40, true)).toBe(b.byteLength - 44)
  })

  it('소리가 없으면 머리만 있는 WAV가 된다', () => {
    const b = toWav16k(new Float32Array(0), VOICE_SAMPLE_RATE)
    expect(b.byteLength).toBe(44)
    expect(view(b).getUint32(40, true)).toBe(0)
  })

  it('말이 안 되는 표본율은 그대로 둔다 — 0으로 나누지 않는다', () => {
    expect(() => toWav16k(tone(10), 0)).not.toThrow()
    expect(() => toWav16k(tone(10), -1)).not.toThrow()
  })
})
