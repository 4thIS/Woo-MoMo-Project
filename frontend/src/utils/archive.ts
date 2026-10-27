/** 보관함 한도 (spec 4절).
 *
 * 한도는 **일반 기록에만** 걸린다. 프리미엄 기록은 세지 않는다.
 * 지우는 주체는 서버지만, "곧 하나가 사라집니다"를 미리 보여 주려면 프론트도 같은 계산이 필요하다.
 */
import type { ArchiveEntry } from '@/services/account'

export const ARCHIVE_LIMIT = 5

export const freeEntries = (list: readonly ArchiveEntry[]): ArchiveEntry[] =>
  list.filter((e) => !e.premium)

export const premiumEntries = (list: readonly ArchiveEntry[]): ArchiveEntry[] =>
  list.filter((e) => e.premium)

export const isFull = (list: readonly ArchiveEntry[]): boolean =>
  freeEntries(list).length >= ARCHIVE_LIMIT

/** 다음 기록을 저장하면 무엇이 밀려나나. 밀려날 게 없으면 null */
export function willEvict(
  list: readonly ArchiveEntry[],
  next: { premium: boolean } = { premium: false },
): ArchiveEntry | null {
  // 프리미엄 기록은 한도를 먹지 않으니 아무것도 밀어내지 않는다
  if (next.premium || !isFull(list)) return null
  // 서버가 최신순으로 주지만 그에 기대지 않고 직접 가장 오래된 것을 고른다
  return freeEntries(list).reduce((oldest, e) => (e.startedAt < oldest.startedAt ? e : oldest))
}
