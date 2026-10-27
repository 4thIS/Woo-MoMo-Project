import { describe, expect, it } from 'vitest'
import { analyzeSpeech, countSyllables, fillerLevelOf, FRAME_MS, MIN_SPEECH_SEC } from './delivery'

const RATE = 16_000

/** 말/쉼 구간을 초 단위로 그려 파형을 만든다. loud=말(진폭 0.3), 나머지는 바닥 잡음 */
function wave(spans: { sec: number; loud: boolean }[], rate = RATE): Float32Array {
  const total = Math.round(spans.reduce((a, s) => a + s.sec, 0) * rate)
  const out = new Float32Array(total)
  let i = 0
  for (const s of spans) {
    const n = Math.round(s.sec * rate)
    for (let k = 0; k < n && i < total; k++, i++) {
      // 톱니로 채운다 — 상수는 RMS가 같아도 사람 소리와 달라 임계를 못 가른다
      const amp = s.loud ? 0.3 : 0.002
      out[i] = amp * ((k % 100) / 50 - 1)
    }
  }
  return out
}

describe('countSyllables', () => {
  it('한글 음절만 센다 — 공백·영문·숫자·문장부호는 빼고', () => {
    expect(countSyllables('안녕하세요')).toBe(5)
    expect(countSyllables('React 18로 만들었습니다.')).toBe(7)
    expect(countSyllables('')).toBe(0)
  })
})

describe('fillerLevelOf', () => {
  it('군말이 없으면 low', () => {
    expect(fillerLevelOf('저는 프론트엔드 개발자로 삼 년 일했습니다')).toBe('low')
  })

  it('군말이 잦으면 high', () => {
    expect(fillerLevelOf('음 그러니까 어 그 음 저기 어 그게')).toBe('high')
  })

  it('셀 거리가 없으면 null — 받아쓰기가 비었을 때 low로 단정하지 않는다', () => {
    expect(fillerLevelOf('')).toBeNull()
    expect(fillerLevelOf('네')).toBeNull()
  })
})

describe('analyzeSpeech', () => {
  it('말한 시간은 쉼을 뺀 시간이다', () => {
    const r = analyzeSpeech(
      wave([
        { sec: 3, loud: true },
        { sec: 3, loud: false },
        { sec: 4, loud: true },
      ]),
      RATE,
    )!
    expect(r.speechSec).toBeGreaterThan(6.4)
    expect(r.speechSec).toBeLessThan(7.6)
  })

  it('2초 이상 벌어진 틈만 긴 쉼으로 센다 — 숨 쉬는 틈은 말의 일부다', () => {
    const r = analyzeSpeech(
      wave([
        { sec: 3, loud: true },
        { sec: 0.4, loud: false }, // 숨
        { sec: 3, loud: true },
        { sec: 2.6, loud: false }, // 긴 쉼
        { sec: 3, loud: true },
      ]),
      RATE,
    )!
    expect(r.longPauses).toBe(1)
    expect(r.longestPauseSec).toBeGreaterThan(2.4)
    expect(r.longestPauseSec).toBeLessThan(2.8)
  })

  it('첫마디까지 = 조각이 시작되고 처음 말소리가 난 시각 (조각의 0초가 질문이 끝난 시각)', () => {
    const r = analyzeSpeech(
      wave([
        { sec: 2.5, loud: false },
        { sec: 6, loud: true },
      ]),
      RATE,
    )!
    expect(r.firstWordSec).toBeGreaterThan(2.3)
    expect(r.firstWordSec).toBeLessThan(2.7)
  })

  it('끝의 침묵은 쉼이 아니다 — 전송을 늦게 누른 것뿐이다', () => {
    const r = analyzeSpeech(
      wave([
        { sec: 6, loud: true },
        { sec: 5, loud: false },
      ]),
      RATE,
    )!
    expect(r.longPauses).toBe(0)
    expect(r.speechSec).toBeLessThan(6.6)
  })

  it('말소리가 없으면 null — 타이핑으로 답한 조각이 여기서 걸러진다', () => {
    expect(analyzeSpeech(wave([{ sec: 10, loud: false }]), RATE)).toBeNull()
  })

  it(`말한 시간이 ${MIN_SPEECH_SEC}초 미만이면 null — 서버의 '측정 부족'까지 가지 않는다`, () => {
    const r = analyzeSpeech(
      wave([
        { sec: 1, loud: false },
        { sec: 2, loud: true },
      ]),
      RATE,
    )
    expect(r).toBeNull()
  })

  it('빈 파형·0 샘플레이트에 터지지 않는다', () => {
    expect(analyzeSpeech(new Float32Array(0), RATE)).toBeNull()
    expect(analyzeSpeech(wave([{ sec: 6, loud: true }]), 0)).toBeNull()
  })

  it('조용한 방이든 시끄러운 방이든 같은 말을 같게 센다 — 바닥 잡음에 따라가는 기준이다', () => {
    const spans = [
      { sec: 4, loud: true },
      { sec: 3, loud: false },
      { sec: 4, loud: true },
    ]
    const quiet = analyzeSpeech(wave(spans), RATE)!
    const noisy = analyzeSpeech(wave(spans).map((v) => v + 0.02) as unknown as Float32Array, RATE)!
    expect(Math.abs(quiet.speechSec - noisy.speechSec)).toBeLessThan(0.5)
    expect(noisy.longPauses).toBe(quiet.longPauses)
  })

  it(`프레임은 ${FRAME_MS}ms — 긴 샘플도 한 번에 훑는다`, () => {
    const r = analyzeSpeech(wave([{ sec: 120, loud: true }]), RATE)!
    expect(r.speechSec).toBeGreaterThan(119)
  })
})
