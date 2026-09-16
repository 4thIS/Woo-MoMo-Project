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

export function startSpeech(
  onInterim: (t: string) => void,
  onFinal: (t: string) => void,
  onError: (msg: string) => void,
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
  r.onerror = (e) => {
    onError(e.error)
    rec = null
  }
  r.onend = () => {
    rec = null
  }
  rec = r
  r.start()
}

export function stopSpeech(): void {
  const r = rec
  rec = null
  r?.stop()
}
