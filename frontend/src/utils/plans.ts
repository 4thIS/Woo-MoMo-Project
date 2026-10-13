/** 등급과 기능 (spec 4절). 순수 데이터 — 화면은 이걸 그리기만 한다.
 *
 * 세 등급이 **같은 목록을 같은 순서로** 보여 주고 되는 것만 불이 들어온다.
 * 그래야 카드인데도 줄이 맞아 표처럼 나란히 비교된다.
 *
 * 등급은 서로 다른 상품이 아니라 겹겹이 쌓이는 것이다 — 아래에서 되는 것은 위에서도 된다.
 */
import type { Tier } from '@/services/account'

export type PlanKey = 'guest' | 'member' | 'premium'

export interface PlanTier {
  key: PlanKey
  label: string
  price: string
}

export const PLAN_TIERS: readonly PlanTier[] = [
  { key: 'guest', label: '비로그인', price: '무료' },
  { key: 'member', label: '로그인', price: '무료' },
  { key: 'premium', label: '모모 프리미엄', price: '4,900원 · 티켓 10회' },
]

export interface PlanFeature {
  label: string
  /** 등급별로 켜지는가 */
  on: Record<PlanKey, boolean>
  /** 켜졌을 때 곁들이는 한 줄. 켜졌는데 비어 있으면 뭐가 되는지 알 수 없다 */
  note: Partial<Record<PlanKey, string>>
}

const ALL = { guest: true, member: true, premium: true }
const FROM_MEMBER = { guest: false, member: true, premium: true }
const PREMIUM_ONLY = { guest: false, member: false, premium: true }

export const PLAN_FEATURES: readonly PlanFeature[] = [
  {
    label: '무료 면접관 3명',
    on: ALL,
    note: {
      guest: '데이빗 · 쥴리 · 올리비아',
      member: '데이빗 · 쥴리 · 올리비아',
      premium: '데이빗 · 쥴리 · 올리비아',
    },
  },
  {
    label: '면접 리포트',
    on: ALL,
    note: {
      guest: '화면을 벗어나면 사라짐',
      member: '보관함에서 다시 보기',
      premium: '보관함에서 다시 보기',
    },
  },
  {
    label: '면접 기록 보관',
    on: FROM_MEMBER,
    note: { member: '최신 5개', premium: '최신 5개' },
  },
  {
    label: '이력서 미리 작성',
    on: FROM_MEMBER,
    note: { member: '대입 3 · 회사 3', premium: '대입 3 · 회사 3' },
  },
  {
    label: '어느 기기에서나',
    on: FROM_MEMBER,
    note: { member: '로그인하면 그대로', premium: '로그인하면 그대로' },
  },
  {
    label: '프리미엄 면접관 벤',
    on: PREMIUM_ONLY,
    note: { premium: '10회 · 더 전문적인 질문' },
  },
  {
    label: '내 목소리 녹음',
    on: PREMIUM_ONLY,
    note: { premium: '답변을 다시 들을 수 있음' },
  },
  {
    label: '프리미엄 기록은 한도 없음',
    on: PREMIUM_ONLY,
    note: { premium: '5개에 들어가지 않음' },
  },
]

/** 그 등급에서 몇 개가 켜지나 — 카드 머리의 눈금에 쓴다 */
export function litCount(key: PlanKey): number {
  return PLAN_FEATURES.filter((f) => f.on[key]).length
}

/** 지금 내 칸. 비로그인은 등급이 아니라 "세션이 없는 상태"라 null로 들어온다 */
export function planKeyOf(tier: Tier | null): PlanKey {
  return tier ?? 'guest'
}
