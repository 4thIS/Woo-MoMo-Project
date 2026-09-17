import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setAudioContextFactory, playClip, warmUpAudio } from './audio'

class FakeSource {
  buffer: unknown = null
  onended: (() => void) | null = null
  started = false
  stopped = false
  connect = vi.fn()
  start() {
    this.started = true
  }
  stop() {
    this.stopped = true
    this.onended?.()
  }
}
class FakeGain {
  gain = { value: 1 }
  connect = vi.fn()
}
class FakeCtx {
  state = 'suspended'
  destination = {}
  sources: FakeSource[] = []
  gains: FakeGain[] = []
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  createBuffer(_ch: number, len: number, rate: number) {
    const data = new Float32Array(len)
    return {
      length: len,
      sampleRate: rate,
      copyToChannel: (src: Float32Array) => data.set(src),
      _data: data,
    }
  }
  createBufferSource() {
    const s = new FakeSource()
    this.sources.push(s)
    return s
  }
  createGain() {
    const g = new FakeGain()
    this.gains.push(g)
    return g
  }
}
let ctx: FakeCtx
beforeEach(() => {
  ctx = new FakeCtx()
  __setAudioContextFactory(() => ctx as unknown as AudioContext)
})
afterEach(() => __setAudioContextFactory(null))

const clip = { samples: Float32Array.from([0.1, 0.2, 0.3]), sampleRate: 44100, durationMs: 0 }

describe('audio', () => {
  it('warmUpAudio는 컨텍스트를 만들고 resume한다(한 번만 만든다)', () => {
    warmUpAudio()
    warmUpAudio()
    expect(ctx.resume).toHaveBeenCalled()
    playClip(clip, { muted: false })
    expect(ctx.sources).toHaveLength(1) // 같은 컨텍스트 재사용
  })
  it('playClip은 버퍼→게인→목적지로 연결하고 끝나면 done이 resolve', async () => {
    const h = playClip(clip, { muted: false })
    const s = ctx.sources[0]
    expect(s.started).toBe(true)
    expect(ctx.gains[0].gain.value).toBe(1)
    s.onended?.()
    await expect(h.done).resolves.toBeUndefined()
  })
  it('muted면 게인 0 (타이밍은 유지)', () => {
    playClip(clip, { muted: true })
    expect(ctx.gains[0].gain.value).toBe(0)
    expect(ctx.sources[0].started).toBe(true)
  })
  it('stop()은 소스를 멈추고 done을 resolve한다', async () => {
    const h = playClip(clip, { muted: false })
    h.stop()
    expect(ctx.sources[0].stopped).toBe(true)
    await expect(h.done).resolves.toBeUndefined()
  })
})
