/** 출근 장면 에셋 경로와 대체 규칙. 브라우저 API를 쓰지 않는 순수 모듈 */

export const COMMUTE_IDS: readonly string[] = ['m1', 'f3', 'm2', 'f2']
/** 아직 고르지 않았거나 모르는 값일 때 쓸 면접관 */
const DEFAULT_ID = 'f3'

/** 한 면접관을 그리는 데 반드시 있어야 하는 동작. 하나라도 빠지면 그 면접관은 통째로 대체한다 */
export const REQUIRED_KEYS: readonly string[] = [
  'idle_home',
  'yawn',
  'dress',
  'bag',
  'walk',
  'walk_watch',
  'arrive',
]

export type SheetSet = Record<string, { file: string; frames: number; w: number; h: number }>

export function resolveInterviewer(id: string | null | undefined): string {
  return id && COMMUTE_IDS.includes(id) ? id : DEFAULT_ID
}

export function sheetPath(interviewer: string, key: string): string {
  return `/sprites/commute/${interviewer}/${key}.png`
}

/** 동작마다 다른 캐릭터가 섞이지 않게, 세트는 전부 있거나 전부 없거나다 */
export function isComplete(set: SheetSet | null): boolean {
  if (!set) return false
  return REQUIRED_KEYS.every((k) => !!set[k])
}
