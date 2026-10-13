/** 등급 비교표 (spec 4절). 순수 데이터 — 화면은 이걸 그리기만 한다.
 *
 * 한 곳에만 적어 두어야 모달의 표와 실제 동작이 어긋나지 않는다.
 */
import type { Tier } from '@/services/account'

export type PlanKey = 'guest' | 'member' | 'premium'

export const PLAN_COLUMNS: readonly { key: PlanKey; label: string }[] = [
  { key: 'guest', label: '비로그인' },
  { key: 'member', label: '로그인' },
  { key: 'premium', label: '모모 프리미엄' },
]

export interface PlanRow {
  label: string
  cells: Record<PlanKey, string>
}

export const PLAN_ROWS: readonly PlanRow[] = [
  {
    label: '무료 면접관 3명 (데이빗·쥴리·올리비아)',
    cells: { guest: 'O', member: 'O', premium: 'O' },
  },
  {
    label: '프리미엄 면접관 벤',
    cells: { guest: '—', member: '—', premium: '티켓 10회' },
  },
  {
    label: '면접 기록 저장',
    cells: { guest: '—', member: 'O', premium: 'O' },
  },
  {
    label: '리포트 다시 보기',
    cells: { guest: '화면을 벗어나면 사라짐', member: '보관함에서', premium: '보관함에서' },
  },
  {
    label: '이력서 미리 작성',
    cells: { guest: '—', member: '대입 3 + 회사 3', premium: '대입 3 + 회사 3' },
  },
  {
    label: '보관함 한도',
    cells: { guest: '—', member: '5개', premium: '5개 (프리미엄 기록은 제외)' },
  },
  {
    label: '내 목소리 녹음',
    cells: { guest: '—', member: '—', premium: 'O' },
  },
]

/** 지금 내 칸. 비로그인은 등급이 아니라 "세션이 없는 상태"라 null로 들어온다 */
export function planKeyOf(tier: Tier | null): PlanKey {
  return tier ?? 'guest'
}
