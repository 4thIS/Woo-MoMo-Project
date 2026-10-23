/** 모집공고 링크 검사 (`docs/API.md` 벤 1) `company.postingUrl`).
 *
 * 서버와 같은 규칙으로 **보내기 전에** 거른다 — 422를 받고 나서 알려 주면 티켓이 이미 빠진 뒤일 수 있다.
 * 공백 제거 후 1~500자, ASCII만, http·https 절대 주소.
 */

export type PostingUrlCheck =
  /** `url`이 null이면 비어 있다는 뜻 — 요청에 아예 넣지 않는다 */
  { ok: true; url: string | null } | { ok: false; reason: string }

const MAX = 500

export function normalizePostingUrl(raw: string): PostingUrlCheck {
  const s = raw.trim()
  if (!s) return { ok: true, url: null }

  // URL 생성자는 가운데 공백을 %20으로 바꿔 버린다. 끊어진 주소를 조용히 이어 붙이는 셈이라 먼저 막는다
  if (/\s/.test(s)) return { ok: false, reason: '주소에 공백이 있습니다' }

  let u: URL
  try {
    u = new URL(s)
  } catch {
    return { ok: false, reason: 'http:// 또는 https://로 시작하는 주소를 넣어 주세요' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    return { ok: false, reason: 'http:// 또는 https://로 시작하는 주소를 넣어 주세요' }
  if (!u.hostname) return { ok: false, reason: '주소에 사이트 이름이 없습니다' }
  if (u.username || u.password) return { ok: false, reason: '아이디·비밀번호가 들어간 주소입니다' }

  // 한글 경로는 URL이 퍼센트 인코딩해 준다. 그래도 남는 글자가 있으면 마저 바꾼다 — 서버는 ASCII만 받는다
  const url = /[^\x20-\x7e]/.test(u.href) ? encodeURI(u.href) : u.href
  if (url.length > MAX) return { ok: false, reason: `주소가 너무 깁니다 (${MAX}자까지)` }

  return { ok: true, url }
}
