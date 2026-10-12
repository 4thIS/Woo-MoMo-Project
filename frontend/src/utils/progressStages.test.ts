import { describe, expect, it } from 'vitest'
import {
  SCROLL,
  advance,
  IDLE_GAP,
  MAX_AHEAD,
  PROP_GAP,
  PROP_KEYS,
  nextIdleAt,
  pickIdle,
  spawnProp,
  stepProps,
  stepScene,
  STAGES,
  approach,
  captionFor,
  distanceAhead,
  overallFraction,
  progressRate,
  type SceneProp,
  type StageState,
} from './progressStages'

describe('progressStages', () => {
  it('구간을 건너뛰어도 전환 애니를 순서대로 큐에 넣는다', () => {
    const s = advance({ stage: 0, queue: [] }, 75)
    expect(s.stage).toBe(2)
    expect(s.queue).toEqual(['pickup_suit', 'pickup_bag'])
  })
  it('같은 구간 안에서는 아무것도 추가하지 않는다', () => {
    const s = advance({ stage: 1, queue: [] }, 45)
    expect(s).toEqual({ stage: 1, queue: [] })
  })
  it('100%(모델+TTS 완료)에서 look_up', () => {
    expect(advance({ stage: 2, queue: [] }, 99).queue).toEqual([])
    expect(advance({ stage: 2, queue: [] }, 100).queue).toEqual(['look_up'])
  })
  it('문구', () => {
    expect(captionFor(10)).toBe('출근 준비 중…')
    expect(captionFor(41)).toBe('양복은 챙겼습니다. 가방을 찾는 중…')
    expect(captionFor(95)).toBe('가방도 챙겼습니다. 회사가 보이기 시작했어요.')
    expect(captionFor(100)).toBe('회사 앞입니다')
  })
})

describe('장면 (#25): 트레드밀 + 도착 예정 거리', () => {
  it('진행 속도: 창 안의 첫·끝 표본으로 %/s, 표본이 모자라거나 안 변했으면 0', () => {
    expect(progressRate([], 0)).toBe(0)
    expect(progressRate([{ t: 0, p: 10 }], 100)).toBe(0)
    expect(
      progressRate(
        [
          { t: 0, p: 10 },
          { t: 1000, p: 10.5 },
          { t: 2000, p: 11 },
        ],
        2000,
      ),
    ).toBe(0.5)
    // 4초 넘게 멈춤 → 창 밖 표본은 버려져 0
    expect(
      progressRate(
        [
          { t: 0, p: 10 },
          { t: 1000, p: 11 },
          { t: 6000, p: 11 },
          { t: 7000, p: 11 },
        ],
        7000,
      ),
    ).toBe(0)
  })
  it('남은 거리 = 도착까지 걸릴 초 × 걷는 속도. 지났으면 0, 속도 모르면 null', () => {
    expect(distanceAhead(30, 20, 0.5)).toBe((10 / 0.5) * SCROLL) // 20초 뒤 → 800px
    expect(distanceAhead(30, 30, 0.5)).toBe(0)
    expect(distanceAhead(30, 45, 0.5)).toBe(0)
    expect(distanceAhead(30, 20, 0)).toBeNull()
  })
  it('물건은 바닥과 같은 속도로 다가오고, 예상 위치가 맞으면 정확히 그 속도만 움직인다', () => {
    // 목표가 base와 같으면 오차 0 → 딱 speed·dt만 이동
    expect(approach(500, 500 - SCROLL * 0.1, 0.1)).toBeCloseTo(500 - SCROLL * 0.1)
    // 속도를 모르면 바닥과 함께만
    expect(approach(500, null, 0.1)).toBeCloseTo(500 - SCROLL * 0.1)
  })
  it('오차 보정은 점프하지 않는다: 가까워질 땐 최대 3배 속도, 멀어질 땐 절반 속도 이하', () => {
    const dt = 0.1
    const near = approach(500, 100, dt) // 400px 당겨야 함
    expect(500 - near).toBeLessThanOrEqual(SCROLL * dt * 4 + 1e-9) // 바닥 1배 + 보정 3배
    expect(500 - near).toBeGreaterThan(SCROLL * dt)
    const far = approach(500, 900, dt) // 400px 밀려나야 함
    expect(far).toBeLessThanOrEqual(500) // 뒤로 밀리는 속도(0.5배) < 바닥 속도(1배) → 그래도 다가온다
    expect(far).toBeGreaterThan(500 - SCROLL * dt)
  })
})

describe('전체 진행률 (#26)', () => {
  it('모델 + TTS 합산 바이트 기준', () => {
    expect(
      overallFraction({ modelSize: 800, modelReceived: 800, ttsSize: 200, ttsReceived: 0 }),
    ).toBe(0.8)
    expect(
      overallFraction({ modelSize: 800, modelReceived: 800, ttsSize: 200, ttsReceived: 100 }),
    ).toBe(0.9)
  })
  it('tts가 없으면 모델만', () => {
    expect(
      overallFraction({ modelSize: 800, modelReceived: 400, ttsSize: 0, ttsReceived: 0 }),
    ).toBe(0.5)
  })
  it('모델 캐시 히트(received = size)면 모델 몫은 꽉 찬 채 시작한다', () => {
    expect(
      overallFraction({ modelSize: 800, modelReceived: 800, ttsSize: 200, ttsReceived: 50 }),
    ).toBe(0.85)
  })
  it('총량 0이면 0, 초과 수신은 1로 자른다', () => {
    expect(overallFraction({ modelSize: 0, modelReceived: 0, ttsSize: 0, ttsReceived: 0 })).toBe(0)
    expect(overallFraction({ modelSize: 10, modelReceived: 99, ttsSize: 0, ttsReceived: 0 })).toBe(
      1,
    )
  })
})

describe('stepScene — 진행률이 장면을 끈다', () => {
  const CHAR_X = 60
  const fresh = (): SceneProp[] =>
    STAGES.map((s, i) => ({
      stage: i,
      at: s.at,
      gap: s.item ? 18 : 40,
      x: null as number | null,
      done: false,
    })).filter((p) => p.stage > 0)

  /** 진행률 시퀀스를 프레임 단위로 흘려보내고 마지막 구간을 돌려준다 */
  function run(points: { p: number; secs: number }[], fps = 60) {
    let state: StageState = { stage: 0, queue: [] }
    let props = fresh()
    let prev = 0
    const dt = 1 / fps
    for (const seg of points) {
      const frames = Math.round(seg.secs * fps)
      const rate = seg.secs > 0 ? (seg.p - prev) / seg.secs : 0
      for (let i = 0; i < frames; i++) {
        const progress = prev + ((seg.p - prev) * i) / frames
        const r = stepScene(state, props, progress, Math.max(0, rate), dt, CHAR_X)
        state = r.state
        props = r.props
      }
      prev = seg.p
    }
    const r = stepScene(state, props, prev, 0, dt, CHAR_X)
    return r.state.stage
  }

  it('20분짜리 느린 다운로드에서도 구간이 끝까지 간다', () => {
    // 실서버에서 본 증상: 물건이 수천 px 앞에 생겨 끝내 닿지 못하고 속옷 차림으로만 걸었다
    expect(run([{ p: 100, secs: 1200 }], 10)).toBe(STAGES.length - 1)
  })
  it('속도가 들쭉날쭉해도(멈췄다 빨라짐) 구간이 따라온다', () => {
    expect(
      run(
        [
          { p: 5, secs: 60 }, // 아주 느리게 시작
          { p: 5, secs: 20 }, // 멈춤
          { p: 95, secs: 30 }, // 갑자기 빨라짐
          { p: 100, secs: 10 },
        ],
        10,
      ),
    ).toBe(STAGES.length - 1)
  })
  it('물건은 화면 밖 MAX_AHEAD 너머에 생기지 않는다', () => {
    const r = stepScene({ stage: 0, queue: [] }, fresh(), 0, 0.08, 1 / 60, CHAR_X)
    for (const pr of r.props) {
      if (pr.x !== null) expect(pr.x).toBeLessThanOrEqual(CHAR_X + pr.gap + MAX_AHEAD)
    }
  })
  it('빠른 다운로드에서는 줍기 전환이 순서대로 큐에 쌓인다', () => {
    let state: StageState = { stage: 0, queue: [] }
    let props = fresh()
    const seen: string[] = []
    for (let i = 0; i <= 100; i++) {
      const r = stepScene(state, props, i, 2, 0.1, CHAR_X)
      state = r.state
      props = r.props
      while (state.queue.length) seen.push(state.queue.shift() as string)
    }
    expect(seen).toEqual(['pickup_suit', 'pickup_bag', 'look_up'])
  })
})

describe('잔동작 — 구간이 길 때 끼어든다', () => {
  it('다음 예정 시각은 15~25초 뒤다', () => {
    expect(nextIdleAt(1000, () => 0)).toBe(1000 + IDLE_GAP[0])
    expect(nextIdleAt(1000, () => 1)).toBe(1000 + IDLE_GAP[1])
  })
  it('그 구간에 정의된 잔동작만 고른다', () => {
    const bag = STAGES.find((s) => s.walk === 'walk_suit_bag')!
    expect(bag.idles).toContain(pickIdle(bag, () => 0) as string)
  })
  it('잔동작이 없는 구간은 null을 준다', () => {
    expect(pickIdle(STAGES[0], () => 0)).toBeNull()
  })
  it('진행률이 멈춰 있어도 일정은 시간으로만 돈다', () => {
    const t = nextIdleAt(0, () => 0)
    expect(t).toBeGreaterThan(0)
    expect(t).toBeLessThanOrEqual(IDLE_GAP[1])
  })
})

describe('지나가는 소품', () => {
  it('오른쪽 화면 밖에서 생긴다', () => {
    const p = spawnProp(320, () => 0)
    expect(p.x).toBeGreaterThanOrEqual(320)
    expect(PROP_KEYS).toContain(p.key)
  })
  it('바닥과 같은 속도로 왼쪽으로 흐른다', () => {
    expect(stepProps([{ key: 'cat', x: 200 }], 0.5, 40, 320)[0].x).toBe(180)
  })
  it('화면 왼쪽으로 나가면 사라진다', () => {
    expect(stepProps([{ key: 'cat', x: -64 }], 0.1, 40, 320)).toEqual([])
  })
  it('탭 복귀로 dt가 커져도 화면을 한 번에 가로지르지 않는다', () => {
    const out = stepProps([{ key: 'cat', x: 300 }], 5, 40, 320)
    expect(300 - out[0].x).toBeLessThanOrEqual(320)
  })
  it('간격은 3~7초다', () => {
    expect(PROP_GAP).toEqual([3000, 7000])
  })
})
