/**
 * 면접관 미리 듣기 — HTMLAudioElement 하나로 정적 OGG를 재생한다.
 * TTS 엔진·AudioContext·음소거(momo.muted)와 무관하게 호출되면 항상 소리를 낸다(spec 3.1·4.4).
 * 클릭 핸들러 안에서 불리므로 자동 재생 제한에 걸리지 않는다.
 */
let factory: () => HTMLAudioElement = () => new Audio()
let audio: HTMLAudioElement | null = null
let token = 0

/** 테스트에서 가짜 오디오를 꽂는다. null이면 실제 Audio */
export function __setAudioFactory(f: (() => HTMLAudioElement) | null): void {
  factory = f ?? (() => new Audio())
  audio = null
}

/** 재생 실패(파일 없음·디코딩 실패·거부)면 false. 다른 재생에 밀려나 거부된 경우는 실패가 아니다(true) */
export async function playPreview(src: string, onEnded?: () => void): Promise<boolean> {
  stopPreview()
  const my = ++token
  const a = (audio ??= factory())
  a.src = src
  a.currentTime = 0
  a.onended = () => {
    if (my === token) onEnded?.()
  }
  try {
    await a.play()
    return true
  } catch {
    return my !== token
  }
}

export function stopPreview(): void {
  token++
  if (!audio) return
  audio.onended = null
  audio.pause()
}
