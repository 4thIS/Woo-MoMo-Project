import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSpeechActive, speechSupported, startSpeech, stopSpeech } from './speech'

class FakeRec extends EventTarget implements SpeechRecognitionLike {
  static last: FakeRec | null = null
  lang = ''
  continuous = false
  interimResults = false
  onresult: SpeechRecognitionLike['onresult'] = null
  onerror: SpeechRecognitionLike['onerror'] = null
  onend: SpeechRecognitionLike['onend'] = null
  started = 0
  stopped = 0
  constructor() {
    super()
    FakeRec.last = this
  }
  start() {
    this.started++
  }
  stop() {
    this.stopped++
    this.onend?.()
  }
}

afterEach(() => {
  stopSpeech()
  delete (window as Window).webkitSpeechRecognition
})

describe('speech', () => {
  it('미지원이면 supported=false', () => {
    expect(speechSupported()).toBe(false)
  })
  it('ko-KR·continuous·interim으로 시작하고 결과를 나눠 전달한다', () => {
    ;(window as Window).webkitSpeechRecognition = FakeRec
    const interim = vi.fn()
    const final = vi.fn()
    startSpeech(interim, final, vi.fn())
    const r = FakeRec.last!
    expect(r.lang).toBe('ko-KR')
    expect(r.continuous).toBe(true)
    expect(r.interimResults).toBe(true)
    expect(r.started).toBe(1)
    expect(isSpeechActive()).toBe(true)
    r.onresult!({
      resultIndex: 0,
      results: [
        { isFinal: false, 0: { transcript: '안녕' } },
        { isFinal: true, 0: { transcript: '하세요' } },
      ],
    } as unknown as SpeechRecognitionEventLike)
    expect(interim).toHaveBeenCalledWith('안녕')
    expect(final).toHaveBeenCalledWith('하세요')
    stopSpeech()
    expect(r.stopped).toBe(1)
    expect(isSpeechActive()).toBe(false)
  })
  it('오류는 onError로 전달하고 비활성이 된다', () => {
    ;(window as Window).webkitSpeechRecognition = FakeRec
    const err = vi.fn()
    startSpeech(vi.fn(), vi.fn(), err)
    FakeRec.last!.onerror!({ error: 'not-allowed' })
    expect(err).toHaveBeenCalledWith('not-allowed')
    expect(isSpeechActive()).toBe(false)
  })
})
