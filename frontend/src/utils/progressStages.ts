export type WalkAnim = 'walk_underwear' | 'walk_suit' | 'walk_suit_bag'
export type OnceAnim = 'pickup_suit' | 'pickup_bag' | 'look_up'
export type ItemSprite = 'suit_ground' | 'bag_ground'

export interface Stage {
  at: number
  walk: WalkAnim | null
  once?: OnceAnim
  item?: ItemSprite
  caption: string
}

export const STAGES: readonly Stage[] = [
  { at: 0, walk: 'walk_underwear', caption: '출근 준비 중…' },
  {
    at: 30,
    walk: 'walk_suit',
    once: 'pickup_suit',
    item: 'suit_ground',
    caption: '양복은 챙겼습니다. 가방을 찾는 중…',
  },
  {
    at: 70,
    walk: 'walk_suit_bag',
    once: 'pickup_bag',
    item: 'bag_ground',
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

/* ---------- 장면 스크롤 (#25): 바닥·물건·건물이 같은 월드 좌표를 쓴다 ---------- */
/** 출발 → 회사 앞까지의 월드 거리(px). 진행률 1% = 20px — 건물(가로 320px 화면)이 약 87%부터, 즉 TTS 다운로드 구간에 보인다 */
export const TRACK = 2000
/** 회사 앞 도착 지점(%). 그 뒤(TTS 초기화·워밍업)는 서서 기다린다 */
export const ARRIVE_AT = STAGES[STAGES.length - 1].at
/** 장면이 따라가는 최대 속도(px/s). 다운로드가 튀어도 화면은 이 속도로 걷는다 (전 구간 약 33초) */
export const SCROLL_MAX = 60

/** 진행률(0~100, 소수 가능)에 해당하는 목표 스크롤 */
export function targetScroll(progress: number): number {
  return (Math.min(Math.max(progress, 0), ARRIVE_AT) / 100) * TRACK
}

/** 한 프레임 이동: 일정 속도로 목표를 향해 가고 목표에서 멈춘다. 뒤로는 가지 않는다 */
export function followScroll(scroll: number, target: number, dt: number, max = SCROLL_MAX): number {
  const gap = target - scroll
  if (gap <= 0) return scroll
  return scroll + Math.min(gap, max * dt)
}

/** 스크롤 → 진행률(%). 물건 줍기·도착 전환은 이 값으로 판정해 위치와 어긋나지 않게 한다 */
export function scrollProgress(scroll: number): number {
  return (scroll / TRACK) * 100
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
