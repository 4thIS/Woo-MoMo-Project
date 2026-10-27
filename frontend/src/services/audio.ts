import type { AudioClip } from './tts'

let ctx: AudioContext | null = null
let factory: (() => AudioContext) | null = null
let current: GainNode | null = null
let mutedFlag = false

/** 테스트용: 가짜 AudioContext 주입 */
export function __setAudioContextFactory(f: (() => AudioContext) | null) {
  factory = f
  ctx = null
}
function context(): AudioContext {
  if (!ctx) ctx = factory ? factory() : new AudioContext()
  return ctx
}

/** 사용자 제스처(면접 시작 클릭) 안에서 불러 자동재생 차단을 푼다 */
export function warmUpAudio(): void {
  const c = context()
  if (c.state !== 'running') void c.resume()
}

/** 재생 중인 소리에 즉시 반영. 이후 playClip이 muted를 생략하면 이 값을 쓴다 */
export function setMuted(on: boolean): void {
  mutedFlag = on
  if (current) current.gain.value = on ? 0 : 1
}

/** 녹음 조각을 파형으로. 못 풀면 null — 측정은 덤이지 조건이 아니다(recorder와 같은 약속).
 *  채널 0만 쓴다. 마이크는 모노이고, 스테레오여도 말·쉼 판별에는 한 채널이면 된다 */
export async function decodeClip(
  blob: Blob,
): Promise<{ samples: Float32Array; sampleRate: number } | null> {
  try {
    const buf = await blob.arrayBuffer()
    const decoded = await context().decodeAudioData(buf)
    return { samples: decoded.getChannelData(0), sampleRate: decoded.sampleRate }
  } catch {
    // 코덱을 모르거나 조각이 깨졌다 — 그 답변만 측정에서 빠진다
    return null
  }
}

/** 파형을 그대로 재생. muted면 GainNode 0으로 소리만 죽이고 길이·타이밍은 유지 */
export function playClip(
  clip: AudioClip,
  opts?: { muted?: boolean },
): { done: Promise<void>; stop(): void } {
  // Web Audio는 0-length 버퍼에서 예외를 던진다 — AudioContext를 건드리지 않고 바로 끝낸다
  if (clip.samples.length === 0) {
    return { done: Promise.resolve(), stop() {} }
  }
  const c = context()
  if (c.state !== 'running') void c.resume()
  const buffer = c.createBuffer(1, clip.samples.length, clip.sampleRate)
  // TS6 Float32Array<ArrayBufferLike> vs copyToChannel의 Float32Array<ArrayBuffer> 불일치(타입 전용).
  buffer.copyToChannel(clip.samples as Float32Array<ArrayBuffer>, 0)
  const gain = c.createGain()
  gain.gain.value = (opts?.muted ?? mutedFlag) ? 0 : 1
  current = gain
  const src = c.createBufferSource()
  src.buffer = buffer
  src.connect(gain)
  gain.connect(c.destination)
  let finish: () => void = () => undefined
  const done = new Promise<void>((resolve) => {
    finish = resolve
  })
  src.onended = () => {
    if (current === gain) current = null
    finish()
  }
  src.start()
  return {
    done,
    stop() {
      try {
        src.stop()
      } catch {
        /* 이미 끝남 */
      }
      if (current === gain) current = null
      finish()
    },
  }
}
