/** 답변 전달력 측정 (#99, 벤 전용). 브라우저 API·스토어 없는 순수 함수.
 *
 * 소리는 **숫자로만** 바뀌어 서버로 간다(`docs/API.md` 리포트 본문 `delivery`).
 * 파형 자체도, 받아쓴 텍스트도 이 계산 밖으로 나가지 않는다.
 */

/** 에너지를 재는 창. 20ms면 음절 하나보다 짧아 말과 쉼의 경계를 놓치지 않는다 */
export const FRAME_MS = 20
/** 이보다 짧게 말한 조각은 아예 보내지 않는다 — 서버의 '측정 부족'까지 갈 필요가 없다 */
export const MIN_SPEECH_SEC = 5
/** 이만큼 벌어져야 '긴 쉼'. 그보다 짧은 틈은 숨이지 멈칫이 아니다 */
const LONG_PAUSE_SEC = 2
/** 바닥 잡음으로 보는 지점. 답변의 상당 부분은 말이므로 아래쪽에서 고른다 */
const NOISE_PERCENTILE = 0.2
/** 단발 클릭 하나에 기준이 끌려가지 않게, 최댓값 대신 위쪽 분위수를 쓴다 */
const PEAK_PERCENTILE = 0.95
const OVER_FLOOR = 3
const OVER_PEAK = 0.05
/** 기준은 봉우리를 넘을 수 없다 — 쉼 없이 쭉 말하면 바닥 자체가 말이라 기준이 말 위로 올라간다 */
const UNDER_PEAK = 0.5
/** 이 아래는 어떤 방에서도 말이 아니다. 바닥만 따라가면 완전한 무음 조각에서 잡음을 말로 센다.
 *  ponytail: 마이크 게인이 아주 낮으면 말을 통째로 놓칠 수 있는 값 — 4번 정확도 검증에서 조정한다 */
const ABS_FLOOR = 0.005

/** 군말을 셀 수 있을 만큼은 말했는지 — 짧은 답을 'low'로 단정하지 않는다 */
const MIN_SYLLABLES_FOR_FILLER = 10
const FILLER_HIGH_PER_100 = 8
const FILLER_NORMAL_PER_100 = 3
/** 단독으로 선 군말만. '그러니까'·'그게'의 '그'는 말의 일부다 */
const FILLER = /(?:^|[\s,.!?])(음+|어+|그+|저기|뭐|막)(?=[\s,.!?]|$)/g

export type FillerLevel = 'low' | 'normal' | 'high'

export interface SpeechStats {
  /** 쉼을 뺀, 실제로 소리를 낸 시간(초) */
  speechSec: number
  longPauses: number
  longestPauseSec: number
  /** 조각이 시작되고 첫 말소리까지(초). 조각의 0초가 질문이 끝난 시각이다 */
  firstWordSec: number
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** 받아쓴 텍스트의 한글 음절 수. 영문·숫자는 발음 길이를 모르니 빼고 센다 */
export function countSyllables(text: string): number {
  return (text.match(/[가-힣]/g) ?? []).length
}

/** 군말 경향. 셀 거리가 없으면 null — 서버는 null이면 군말을 입에 올리지 않는다 */
export function fillerLevelOf(text: string): FillerLevel | null {
  const syllables = countSyllables(text)
  if (syllables < MIN_SYLLABLES_FOR_FILLER) return null
  const hits = [...text.matchAll(FILLER)].length
  const per100 = (hits / syllables) * 100
  if (per100 >= FILLER_HIGH_PER_100) return 'high'
  return per100 >= FILLER_NORMAL_PER_100 ? 'normal' : 'low'
}

/**
 * 답변 조각 하나의 말·쉼을 잰다. 잴 거리가 없으면 null(타이핑·무음·너무 짧은 답변).
 *
 * 말 판별 기준은 **그 조각의 바닥 잡음을 따라간다.** 조용한 방과 시끄러운 방에 같은 절댓값을
 * 쓰면 한쪽은 숨소리까지 말로 세고 다른 쪽은 말을 통째로 놓친다.
 */
export function analyzeSpeech(samples: Float32Array, sampleRate: number): SpeechStats | null {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || samples.length === 0) return null
  const size = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000))

  const rms: number[] = []
  for (let i = 0; i + size <= samples.length; i += size) {
    let sum = 0
    for (let k = i; k < i + size; k++) sum += samples[k] * samples[k]
    rms.push(Math.sqrt(sum / size))
  }
  if (!rms.length) return null

  const sorted = [...rms].sort((a, b) => a - b)
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
  const peak = at(PEAK_PERCENTILE)
  const threshold = Math.max(
    ABS_FLOOR,
    Math.min(Math.max(at(NOISE_PERCENTILE) * OVER_FLOOR, peak * OVER_PEAK), peak * UNDER_PEAK),
  )

  const loud = rms.map((v) => v > threshold)
  const first = loud.indexOf(true)
  const last = loud.lastIndexOf(true)
  if (first < 0) return null

  // 첫 말소리부터 마지막 말소리까지만 본다 — 끝의 침묵은 전송을 늦게 누른 것이지 쉼이 아니다
  const frameSec = size / sampleRate
  let speechSec = 0
  let longPauses = 0
  let longestPauseSec = 0
  let gap = 0
  for (let i = first; i <= last; i++) {
    if (!loud[i]) {
      gap++
      continue
    }
    const paused = gap * frameSec
    if (paused >= LONG_PAUSE_SEC) {
      longPauses++
      longestPauseSec = Math.max(longestPauseSec, paused)
    }
    gap = 0
    speechSec += frameSec
  }
  if (speechSec < MIN_SPEECH_SEC) return null

  return {
    speechSec: round1(speechSec),
    longPauses,
    longestPauseSec: round1(longestPauseSec),
    firstWordSec: round1(first * frameSec),
  }
}
