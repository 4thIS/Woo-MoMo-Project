/** 면접의 갈래 (spec 5절).
 *
 * **트랙은 고른 면접관이 정한다.** 둘 다 보는 벤만 사용자가 고른다.
 * 스토어에 트랙을 따로 들고 있지 않는다 — 두 군데에 있으면 어긋난다.
 */
import type { Track } from '@/services/account'
import { interviewerById } from '@/interviewers'

export function trackOf(id: string | null | undefined, chosen: Track | null): Track | null {
  const iv = interviewerById(id)
  if (!iv) return null
  // 벤(track: null)만 고른 값을 쓴다. 나머지는 자기 트랙이 이긴다
  return iv.track ?? chosen
}

export interface StartContext {
  track: Track | null
  modelReady: boolean
  resumeDone: boolean
  /** track === 'company' */
  field?: string | null
  job?: string
  /** track === 'admission' */
  name?: string
  age?: number | null
  university?: string
  department?: string
}

const filled = (v?: string) => (v ?? '').trim().length > 0

/** 트랙이 보는 칸만 센다 — 트랙을 바꿔도 앞 트랙의 입력이 통과시키지 않는다 */
export function canStartWith(c: StartContext): boolean {
  if (!c.track || !c.modelReady || !c.resumeDone) return false
  if (c.track === 'company') return Boolean(c.field) && filled(c.job)
  return (
    filled(c.name) &&
    c.age !== null &&
    c.age !== undefined &&
    filled(c.university) &&
    filled(c.department)
  )
}
