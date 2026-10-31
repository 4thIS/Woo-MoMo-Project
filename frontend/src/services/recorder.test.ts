import { afterEach, describe, expect, it, vi } from 'vitest'
import { startRecording } from './recorder'

type Handler = () => void

/** jsdom에는 MediaRecorder가 없다. 조각을 모았다 멈출 때 뱉는 최소 동작만 세운다 */
class FakeRecorder {
  static instances: FakeRecorder[] = []
  state: 'inactive' | 'recording' = 'inactive'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: Handler | null = null
  constructor(
    readonly stream: unknown,
    readonly options?: unknown,
  ) {
    FakeRecorder.instances.push(this)
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['소리'], { type: 'audio/webm' }) })
    this.onstop?.()
  }
}

function fakeStack(opts: { denied?: boolean; noRecorder?: boolean } = {}) {
  const stop = vi.fn()
  const stream = { getTracks: () => [{ stop }] }
  vi.stubGlobal('MediaRecorder', opts.noRecorder ? undefined : FakeRecorder)
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: opts.denied
        ? vi.fn().mockRejectedValue(new Error('NotAllowedError'))
        : vi.fn().mockResolvedValue(stream),
    },
  })
  return { stop }
}

afterEach(() => {
  FakeRecorder.instances = []
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('startRecording — 어떤 실패에도 던지지 않는다', () => {
  it('지원하지 않는 브라우저에서는 null을 준다', async () => {
    fakeStack({ noRecorder: true })
    expect(await startRecording()).toBeNull()
  })

  it('권한을 거절하면 null을 준다 — 던지지 않는다', async () => {
    fakeStack({ denied: true })
    expect(await startRecording()).toBeNull()
  })

  it('마이크가 아예 없는 환경에서도 null을 준다', async () => {
    vi.stubGlobal('MediaRecorder', FakeRecorder)
    vi.stubGlobal('navigator', {})
    expect(await startRecording()).toBeNull()
  })
})

describe('Recorder', () => {
  it('cut은 모은 소리를 돌려주고 다음 조각을 바로 시작한다', async () => {
    fakeStack()
    const rec = await startRecording()
    const clip = await rec!.cut()
    expect(clip?.blob.size).toBeGreaterThan(0)
    expect(FakeRecorder.instances).toHaveLength(2)
    expect(FakeRecorder.instances[1].state).toBe('recording')
  })

  it('stop은 마이크를 놓는다 — 빨간 점이 계속 켜져 있으면 안 된다', async () => {
    const { stop } = fakeStack()
    const rec = await startRecording()
    await rec!.stop()
    expect(stop).toHaveBeenCalled()
  })

  it('멈춘 뒤 cut은 null이다', async () => {
    fakeStack()
    const rec = await startRecording()
    await rec!.stop()
    expect(await rec!.cut()).toBeNull()
  })

  it('stop을 두 번 불러도 던지지 않는다', async () => {
    fakeStack()
    const rec = await startRecording()
    await rec!.stop()
    await expect(rec!.stop()).resolves.not.toThrow()
  })
})

describe('조각 길이', () => {
  /** webm 앞머리에는 전체 길이가 없다 — 녹음한 시간을 직접 재서 함께 보낸다 */
  const atTime = (ms: number) => vi.spyOn(Date, 'now').mockReturnValue(ms)

  it('끊을 때 녹음한 시간을 함께 준다', async () => {
    fakeStack()
    atTime(1_000_000)
    const rec = await startRecording()
    atTime(1_041_300)
    const clip = await rec!.cut()
    expect(clip!.durationSec).toBeCloseTo(41.3, 1)
  })

  it('다음 조각은 0부터 다시 잰다', async () => {
    fakeStack()
    atTime(0)
    const rec = await startRecording()
    atTime(10_000)
    await rec!.cut()
    atTime(15_000)
    const second = await rec!.cut()
    expect(second!.durationSec).toBeCloseTo(5, 1)
  })

  it('마이크를 놓을 때도 길이를 준다', async () => {
    fakeStack()
    atTime(0)
    const rec = await startRecording()
    atTime(3_000)
    const last = await rec!.stop()
    expect(last!.durationSec).toBeCloseTo(3, 1)
  })
})
