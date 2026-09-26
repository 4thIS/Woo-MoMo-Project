import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setAudioFactory, playPreview, stopPreview } from './preview'

class FakeAudio {
  src = ''
  currentTime = 5
  onended: (() => void) | null = null
  paused = 0
  play = vi.fn(async () => undefined as void)
  pause() {
    this.paused++
  }
  end() {
    this.onended?.()
  }
}
let a: FakeAudio
beforeEach(() => {
  a = new FakeAudio()
  __setAudioFactory(() => a as unknown as HTMLAudioElement)
})
afterEach(() => __setAudioFactory(null))

describe('services/preview', () => {
  it('src를 처음부터 재생하고 성공이면 true, 끝나면 onEnded', async () => {
    const onEnded = vi.fn()
    expect(await playPreview('/voices/preview/gentle.ogg', onEnded)).toBe(true)
    expect(a.src).toBe('/voices/preview/gentle.ogg')
    expect(a.currentTime).toBe(0)
    a.end()
    expect(onEnded).toHaveBeenCalledTimes(1)
  })
  it('새로 재생하면 이전 재생을 멈추고, 이전 onEnded는 부르지 않는다', async () => {
    const first = vi.fn()
    await playPreview('/voices/preview/gentle.ogg', first)
    const second = vi.fn()
    await playPreview('/voices/preview/sharp.ogg', second)
    expect(a.paused).toBeGreaterThanOrEqual(1)
    a.end()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
  it('play()가 거부되면 false(재생 실패)', async () => {
    a.play.mockRejectedValueOnce(new Error('NotSupportedError'))
    expect(await playPreview('/voices/preview/none.ogg')).toBe(false)
  })
  it('다른 재생에 밀려나 거부된 play()는 실패가 아니다(true)', async () => {
    let rejectFirst!: (e: unknown) => void
    a.play.mockImplementationOnce(() => new Promise<void>((_, rej) => (rejectFirst = rej)))
    const p1 = playPreview('/voices/preview/gentle.ogg')
    await playPreview('/voices/preview/sharp.ogg')
    rejectFirst(new DOMException('interrupted', 'AbortError'))
    expect(await p1).toBe(true)
  })
  it('stopPreview는 멈추고 onEnded를 부르지 않는다', async () => {
    const onEnded = vi.fn()
    await playPreview('/voices/preview/gentle.ogg', onEnded)
    stopPreview()
    a.end()
    expect(onEnded).not.toHaveBeenCalled()
  })
})
