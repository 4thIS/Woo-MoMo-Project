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
  { at: 90, walk: null, once: 'look_up', caption: '회사 앞입니다' },
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
