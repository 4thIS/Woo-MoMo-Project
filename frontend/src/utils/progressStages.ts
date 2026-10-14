export type WalkAnim = 'walk_underwear' | 'walk_suit' | 'walk_suit_bag'
export type OnceAnim = 'pickup_suit' | 'pickup_bag' | 'look_up'
/** 구간이 길 때 끼어드는 잔동작. 1회 재생하고 걷기로 돌아간다 */
export type IdleAnim = 'walk_watch'
export type ItemSprite = 'suit_ground' | 'bag_ground'

export interface Stage {
  at: number
  walk: WalkAnim | null
  once?: OnceAnim
  item?: ItemSprite
  /** 이 구간에서 끼어들 수 있는 잔동작 */
  idles?: readonly IdleAnim[]
  caption: string
}

export const STAGES: readonly Stage[] = [
  { at: 0, walk: 'walk_underwear', caption: '출근 준비 중…' },
  {
    at: 30,
    walk: 'walk_suit',
    once: 'pickup_suit',
    item: 'suit_ground',
    idles: ['walk_watch'],
    caption: '양복은 챙겼습니다. 가방을 찾는 중…',
  },
  {
    at: 70,
    walk: 'walk_suit_bag',
    once: 'pickup_bag',
    item: 'bag_ground',
    idles: ['walk_watch'],
    caption: '가방도 챙겼습니다. 회사가 보이기 시작했어요.',
  },
  { at: 100, walk: null, once: 'look_up', caption: '회사 앞입니다' }, // 모델+TTS를 다 받은 뒤 도착 (#26)
]

export interface StageState {
  stage: number
  queue: OnceAnim[]
}

/** 진행률이 새 구간을 넘을 때마다 그 구간의 전환 애니를 큐에 넣는다. 점프해도 순서 유지. */
export function advance(state: StageState, progress: number): StageState {
  let { stage } = state
  const queue = [...state.queue]
  while (stage + 1 < STAGES.length && progress >= STAGES[stage + 1].at) {
    stage++
    const once = STAGES[stage].once
    if (once) queue.push(once)
  }
  return { stage, queue }
}

export function stageIndexFor(progress: number): number {
  let i = 0
  while (i + 1 < STAGES.length && progress >= STAGES[i + 1].at) i++
  return i
}

export function captionFor(progress: number): string {
  return STAGES[stageIndexFor(progress)].caption
}

/* ---------- 장면 (#25): 캐릭터는 트레드밀처럼 일정 속도로 걷고, 물건·건물은 "도착 예정 시각 × 걷는 속도"만큼
 * 앞에 두어 바닥과 같은 속도로 다가온다. 진행이 멈추면(초기화 구간) 바닥·물건도 함께 멈춘다. ---------- */
/** 걷는 속도(px/s) = 바닥·물건이 흐르는 속도 */
export const SCROLL = 40
/** 진행 속도를 재는 창(ms). 이 안에서 진행률이 안 변하면 멈춘 것으로 본다 */
export const RATE_WINDOW_MS = 4000

export interface Sample {
  t: number
  p: number
}
/** 최근 창의 진행 속도(%/s). 표본이 모자라거나 진행률이 안 변했으면 0 */
export function progressRate(samples: Sample[], now: number, window = RATE_WINDOW_MS): number {
  const recent = samples.filter((s) => now - s.t <= window)
  if (recent.length < 2) return 0
  const a = recent[0]
  const b = recent[recent.length - 1]
  const dt = (b.t - a.t) / 1000
  return dt > 0 && b.p > a.p ? (b.p - a.p) / dt : 0
}

/** 물건까지 남은 거리(px): (at − 진행률) ÷ 진행 속도 × 걷는 속도. 이미 지났으면 0, 속도를 모르면 null(제자리 유지) */
export function distanceAhead(
  at: number,
  progress: number,
  ratePctPerSec: number,
  speed = SCROLL,
): number | null {
  if (progress >= at) return 0
  if (ratePctPerSec <= 0) return null
  return ((at - progress) / ratePctPerSec) * speed
}

/**
 * 물건의 화면 x 한 프레임: 바닥과 같은 속도로 다가오고(−speed·dt), 예상 위치와의 오차는 서서히 좁힌다 — 점프 금지.
 * 더 가까워져야 하면 최대 3배 속도로, 더 멀어져야 하면(다운로드가 느려짐) 걷는 속도의 절반 이하로만 밀려난다.
 * target이 null(속도 모름)이면 바닥과 함께만 움직인다.
 */
export function approach(x: number, target: number | null, dt: number, speed = SCROLL): number {
  const base = x - speed * dt
  if (target === null) return base
  const err = target - base
  const step = Math.max(-3 * speed * dt, Math.min(0.5 * speed * dt, err * 0.5 * dt))
  return base + step
}

/* ---------- 전체 진행률 (#26): 모델 + TTS 합산 바이트 ---------- */
export interface DownloadParts {
  modelSize: number
  modelReceived: number
  ttsSize: number
  ttsReceived: number
}
/** 0~1. 총량이 0이면 0, 초과 수신은 1로 자른다 */
export function overallFraction(p: DownloadParts): number {
  const total = p.modelSize + p.ttsSize
  if (total <= 0) return 0
  const got = Math.min(p.modelReceived, p.modelSize) + Math.min(p.ttsReceived, p.ttsSize)
  return Math.min(1, got / total)
}

/* ---------- 장면 한 프레임 (순수) ----------
 * 컴포넌트 안에 있던 물건 이동·구간 전환을 꺼냈다. 캔버스가 없는 테스트에서도 돌릴 수 있어야
 * "느린 다운로드에서 구간이 안 올라간다" 같은 문제를 재현할 수 있다. */

/** 물건이 처음 자리 잡을 때 둘 수 있는 최대 거리(px).
 * 다운로드가 느리면 도착 예정 거리가 수천 px이 되는데, 화면 밖은 어차피 안 보이면서
 * 되돌아와 닿기까지 수십 초가 걸려 구간이 진행률을 못 따라간다. */
export const MAX_AHEAD = 640
/** 물건끼리 최소한 이만큼은 떨어뜨린다.
 * 상한만 두면 느린 다운로드에서 양복·가방·건물의 예상 거리가 **전부** 상한에 걸려
 * 한 자리에 겹쳐 선다(실제 서버 10% 언저리에서 본 뭉침). 뒤엣것을 차례로 밀어 둔다. */
export const PROP_SPACING = 140

export interface SceneProp {
  stage: number
  at: number
  gap: number
  /** 화면 x. null이면 아직 자리를 못 잡음(진행 속도를 모름) */
  x: number | null
  done: boolean
}

export interface SceneStep {
  state: StageState
  props: SceneProp[]
}

/**
 * 물건을 바닥과 같은 속도로 다가오게 하고, 닿으면 그 구간으로 전환한다.
 * 마지막에 진행률이 가리키는 구간까지 반드시 따라잡는다 — 물건이 늦어도 사실(진행률)이 장면을 끈다.
 */
export function stepScene(
  state: StageState,
  props: SceneProp[],
  progress: number,
  rate: number,
  dt: number,
  charX: number,
  speed = SCROLL,
): SceneStep {
  let next = state
  const out = props.map((pr) => ({ ...pr }))
  // 아직 안 주운 것들을 가까운 순(at 오름차순)으로 보며 앞엣것 뒤에 줄 세운다.
  // 개별로 상한만 걸면 멀리 있는 것들이 모두 같은 자리에 선다
  const queue = out.filter((pr) => !pr.done).sort((a, b) => a.at - b.at)
  const targets = new Map<SceneProp, number | null>()
  /** 아직 제 거리에 못 온 물건 — 바닥과 함께 흐르지 않고 제자리에 둔다 */
  const parked = new Set<SceneProp>()
  let floor = 0
  for (const pr of queue) {
    const dist = distanceAhead(pr.at, progress, rate, speed)
    if (dist === null) {
      targets.set(pr, null)
      continue
    }
    const ahead = Math.max(Math.min(dist, MAX_AHEAD), floor)
    floor = ahead + PROP_SPACING
    targets.set(pr, charX + pr.gap + ahead)
    // 보여 주는 자리가 예상 거리와 다르면(상한에 걸렸거나 앞엣것에 막혔으면) **화면 밖에서 기다린다**.
    // 안 붙들면 바닥 속도로 끌려 들어와 10%에서 양복·가방을 다 주워 버린다
    if (ahead !== dist) parked.add(pr)
  }
  for (const pr of out) {
    if (pr.done) continue
    const target = targets.get(pr) ?? null
    if (pr.x === null) {
      if (target !== null) pr.x = target
      continue
    }
    if (parked.has(pr) && target !== null) {
      pr.x = target
      continue
    }
    pr.x = approach(pr.x, target, dt, speed)
    if (pr.x <= charX + pr.gap + 0.5) {
      pr.x = charX + pr.gap
      pr.done = true
      const once = STAGES[pr.stage].once
      next = { stage: pr.stage, queue: once ? [...next.queue, once] : next.queue }
    }
  }
  // 안전망: 물건이 못 닿아도 진행률이 가리키는 구간까지는 간다.
  // 이게 없으면 다운로드가 느려 물건이 멀리 생긴 경우 100%가 되어도 첫 구간에 머문다(속옷 차림으로만 걷는다).
  const want = stageIndexFor(progress)
  if (next.stage < want) {
    next = advance(next, progress)
    for (const pr of out) {
      if (!pr.done && pr.stage <= next.stage) {
        pr.x = charX + pr.gap
        pr.done = true
      }
    }
  }
  return { state: next, props: out }
}

/* ---------- 잔동작 ----------
 * 다운로드가 5~15분이라 한 구간을 몇 분씩 본다. 같은 걷기 루프만 돌면 지루하므로
 * 15~25초마다 하나씩 끼워 넣는다. 일정은 진행률이 아니라 시간으로 돈다 —
 * 초기화 구간처럼 진행이 멈춰도 캐릭터는 살아 있어야 한다. */

export const IDLE_GAP: readonly [number, number] = [15_000, 25_000]

/** 다음 잔동작 예정 시각(ms) */
export function nextIdleAt(now: number, rnd: () => number): number {
  const [a, b] = IDLE_GAP
  return now + a + rnd() * (b - a)
}

/** 이 구간에서 나올 잔동작 하나. 없으면 null */
export function pickIdle(stage: Stage, rnd: () => number): IdleAnim | null {
  const list = stage.idles
  if (!list || !list.length) return null
  return list[Math.min(list.length - 1, Math.floor(rnd() * list.length))]
}

/* ---------- 지나가는 소품 ----------
 * 바닥과 같은 속도로 흘러 길이 이어져 보이게 한다. */

/** 지나가는 소품. 고양이·비둘기·자판기는 뺐다 — 길가에 서 있는 것만 둔다 */
export const PROP_KEYS: readonly string[] = ['lamp', 'planter', 'signal']
export const PROP_GAP: readonly [number, number] = [3_000, 7_000]
/** 한 프레임에 소품이 움직일 수 있는 최대 거리(화면 폭). 탭 복귀로 dt가 커져도 순간이동하지 않게 */
const MAX_PROP_STEP_RATIO = 1

export interface ScenicProp {
  key: string
  x: number
}

export function spawnProp(width: number, rnd: () => number): ScenicProp {
  const key = PROP_KEYS[Math.min(PROP_KEYS.length - 1, Math.floor(rnd() * PROP_KEYS.length))]
  return { key, x: width + Math.round(rnd() * 40) }
}

/** 소품을 왼쪽으로 흘리고, 화면 밖으로 나간 것은 버린다 */
export function stepProps(
  list: ScenicProp[],
  dt: number,
  speed: number,
  width: number,
): ScenicProp[] {
  const move = Math.min(speed * dt, width * MAX_PROP_STEP_RATIO)
  return list.map((p) => ({ ...p, x: p.x - move })).filter((p) => p.x > -64)
}
