let rec: SpeechRecognitionLike | null = null

function ctor() {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

export function speechSupported(): boolean {
  return ctor() !== null
}

export function isSpeechActive(): boolean {
  return rec !== null
}

/**
 * 음성 인식을 시작한다. 이미 듣는 중이거나 미지원이면 아무것도 하지 않는다.
 * @param onEnd 브라우저가 스스로 인식을 끝냈을 때(무음 등) 호출. `stopSpeech()`로 끝낸 경우에는 부르지 않는다.
 */
export function startSpeech(
  onInterim: (t: string) => void,
  onFinal: (t: string) => void,
  onError: (msg: string) => void,
  onEnd?: () => void,
): void {
  const C = ctor()
  if (!C || rec) return
  const r = new C()
  r.lang = 'ko-KR'
  r.continuous = true
  r.interimResults = true
  r.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]
      const t = res[0].transcript
      if (res.isFinal) onFinal(t)
      else onInterim(t)
    }
  }
  // 실제 SpeechRecognition의 onend/onerror는 비동기로 늦게 온다. 그 사이 새 인식기가 시작됐을 수 있으므로
  // 자기 자신이 아직 현재 인식기일 때만 상태를 정리한다.
  r.onerror = (e) => {
    if (rec === r) rec = null
    onError(e.error)
  }
  r.onend = () => {
    if (rec !== r) return // stopSpeech()로 이미 정리됐거나 다른 인식기로 교체됨
    rec = null
    onEnd?.()
  }
  rec = r
  r.start()
}

export function stopSpeech(): void {
  const r = rec
  rec = null
  r?.stop()
}
