/** 관리자 API (`docs/API.md` 2026-10-17 "관리자").
 *
 * 응답 형태는 계약 그대로다 — 변환하지 않는다. 세션은 HttpOnly 쿠키라 `credentials: 'include'`.
 * 서버 오류 본문은 `{"error": code}`뿐이라 사람이 읽을 문구는 여기서 붙인다.
 * 이력서·대화·리포트·녹음 본문과 계정 등급(`tier`)은 응답에 없다.
 */

export interface AdminOverview {
  users: {
    total: number
    last7Days: number
    last30Days: number
    withTickets: number
    admins: number
  }
  tickets: { outstanding: number }
  ben: { today: number; dailyLimit: number; byDay: { date: string; count: number }[] }
  archive: { entries: number; ben: number }
  recordings: { count: number; bytes: number }
  briefings: { cached: number }
  weakEmergencyPassword: boolean
}

export interface AdminUserRow {
  id: string
  email: string
  name: string | null
  createdAt: string
  tickets: number
  isAdmin: boolean
  archiveCount: number
  benCount: number
  lastActiveAt: string | null
}

export interface AdminUserPage {
  page: number
  pageSize: number
  total: number
  items: AdminUserRow[]
}

export interface AdminUserDetail {
  user: AdminUserRow
  ben: {
    id: string
    createdAt: string
    track: string
    status: 'active' | 'done'
    modelTurns: number
    briefingStatus: string
  }[]
  archive: {
    id: string
    startedAt: string
    interviewerId: string
    premium: boolean
    track: string
    questionCount: number
    hasRecording: boolean
  }[]
  ticketLog: { at: string; adminEmail: string | null; delta: number; reason: string }[]
}

export interface AdminUsageDay {
  date: string
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  webSearches: number
  errors: number
  refusals: number
  costUsd: number
}

export interface AdminUsage {
  pricing: {
    model: string
    inputPerMTok: number
    outputPerMTok: number
    cacheReadPerMTok: number
    cacheWritePerMTok: number
    webSearch: number
  }
  since: string | null
  byDay: AdminUsageDay[]
  byKind: { kind: 'turn' | 'report' | 'research'; calls: number; costUsd: number }[]
  topInterviews: { interviewId: string; userEmail: string | null; calls: number; costUsd: number }[]
}

export interface AdminAuditPage {
  page: number
  pageSize: number
  total: number
  items: {
    at: string
    adminEmail: string | null
    action: string
    targetUserId: string | null
    targetEmail: string | null
    delta: number | null
    reason: string | null
  }[]
}

export type AdminErrorCode =
  | 'unauthorized'
  | 'admin_required'
  | 'insufficient_tickets'
  | 'invalid'
  | 'not_found'
  | 'network'
  | 'unknown'

export class AdminError extends Error {
  constructor(
    readonly code: AdminErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AdminError'
  }
}

const BASE = '/api/admin'

const MESSAGES: Record<AdminErrorCode, string> = {
  unauthorized: '로그인이 필요합니다',
  admin_required: '관리자만 볼 수 있습니다',
  insufficient_tickets: '회수할 티켓이 부족합니다',
  invalid: '입력한 값을 다시 확인해 주세요',
  not_found: '없는 사용자입니다',
  network: '연결하지 못했습니다',
  unknown: '요청을 처리하지 못했습니다',
}

function toError(body: unknown): AdminError {
  const raw = (body as { error?: unknown } | null | undefined)?.error
  const code: AdminErrorCode =
    typeof raw === 'string' && Object.hasOwn(MESSAGES, raw) && raw !== 'network'
      ? (raw as AdminErrorCode)
      : 'unknown'
  return new AdminError(code, MESSAGES[code])
}

async function call<T>(path: string, method = 'GET', body?: Record<string, unknown>): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: 'include',
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
  } catch {
    throw new AdminError('network', MESSAGES.network)
  }
  const parsed = await res.json().catch(() => undefined)
  if (!res.ok) throw toError(parsed)
  return parsed as T
}

export const adminApi = {
  overview: () => call<AdminOverview>('/overview'),

  users: (q: string, page: number) =>
    call<AdminUserPage>(`/users?q=${encodeURIComponent(q)}&page=${page}`),

  user: (id: string) => call<AdminUserDetail>(`/users/${encodeURIComponent(id)}`),

  /** 조정 뒤 남은 티켓 수 */
  async adjustTickets(id: string, delta: number, reason: string): Promise<number> {
    const r = await call<{ tickets: number }>(`/users/${encodeURIComponent(id)}/tickets`, 'POST', {
      delta,
      reason,
    })
    return r.tickets
  },

  usage: (days: number) => call<AdminUsage>(`/usage?days=${days}`),

  audit: (page: number) => call<AdminAuditPage>(`/audit?page=${page}`),
}
