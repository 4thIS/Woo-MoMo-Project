/** 준비 화면 출근 장면: 구간 정의와 전환. 브라우저 API를 쓰지 않는 순수 모듈 */

export type SceneKind = 'indoor' | 'outdoor'

export interface CommuteStage {
  /** 이 구간이 시작되는 진행률(%) */
  at: number
  kind: SceneKind
  /** 배경 키 — commute/backgrounds/{bg}.png */
  bg: string
  /** 이 구간의 기본 루프 동작 */
  loop: string
  /** 구간에 들어설 때 한 번 재생하는 전환(이정표) */
  once?: string
  /** 이 구간에서 끼어들 수 있는 잔동작 */
  idles: readonly string[]
  caption: string
}

export const COMMUTE: readonly CommuteStage[] = [
  {
    at: 0,
    kind: 'indoor',
    bg: 'bedroom',
    loop: 'idle_home',
    idles: ['yawn'],
    caption: '막 일어났습니다…',
  },
  {
    at: 15,
    kind: 'indoor',
    bg: 'washroom',
    loop: 'idle_home',
    idles: ['yawn'],
    caption: '세수하는 중…',
  },
  {
    at: 30,
    kind: 'indoor',
    bg: 'closet',
    loop: 'idle_home',
    once: 'dress',
    idles: ['yawn'],
    caption: '양복을 챙겼습니다.',
  },
  {
    at: 45,
    kind: 'outdoor',
    bg: 'entrance',
    loop: 'walk',
    once: 'bag',
    idles: ['walk_watch'],
    caption: '가방도 챙겼습니다. 출발합니다.',
  },
  {
    at: 60,
    kind: 'outdoor',
    bg: 'alley',
    loop: 'walk',
    idles: ['walk_watch'],
    caption: '골목을 지나는 중…',
  },
  {
    at: 75,
    kind: 'outdoor',
    bg: 'street',
    loop: 'walk',
    idles: ['walk_watch'],
    caption: '큰길로 나왔습니다.',
  },
  {
    at: 88,
    kind: 'outdoor',
    bg: 'street',
    loop: 'walk',
    idles: ['walk_watch'],
    caption: '회사가 보이기 시작했어요.',
  },
  {
    at: 100,
    kind: 'outdoor',
    bg: 'street',
    loop: 'walk',
    once: 'arrive',
    idles: [],
    caption: '면접관이 자리에 앉았습니다',
  },
]

export interface StageState {
  stage: number
  /** 아직 재생하지 않은 전환 */
  queue: string[]
}

export function stageAt(progress: number): number {
  let i = 0
  while (i + 1 < COMMUTE.length && progress >= COMMUTE[i + 1].at) i++
  return i
}

/** 새 구간을 넘을 때마다 그 구간의 전환을 큐에 넣는다. 점프해도 순서를 지킨다 */
export function advanceStages(state: StageState, progress: number): StageState {
  let { stage } = state
  const queue = [...state.queue]
  while (stage + 1 < COMMUTE.length && progress >= COMMUTE[stage + 1].at) {
    stage++
    const once = COMMUTE[stage].once
    if (once) queue.push(once)
  }
  return { stage, queue }
}

export function captionAt(progress: number): string {
  return COMMUTE[stageAt(progress)].caption
}

/* ---------- 잔동작 ----------
 * 한 구간이 37초~1분 50초라 같은 루프만 보면 지루하다. 15~25초마다 하나씩 끼워 넣는다.
 * 일정은 진행률이 아니라 시간으로 돈다 — 다운로드가 멈춰도 캐릭터는 살아 있어야 한다. */

export const IDLE_GAP: readonly [number, number] = [15_000, 25_000]

/** 다음 잔동작 예정 시각(ms) */
export function nextIdleAt(now: number, rnd: () => number): number {
  const [a, b] = IDLE_GAP
  return now + a + rnd() * (b - a)
}

/** 이 구간에서 나올 잔동작 하나. 없으면 null */
export function pickIdle(stage: CommuteStage, rnd: () => number): string | null {
  if (!stage.idles.length) return null
  return stage.idles[Math.min(stage.idles.length - 1, Math.floor(rnd() * stage.idles.length))]
}
