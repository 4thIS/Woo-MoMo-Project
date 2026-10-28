/** 진짜 서버 접점 (`docs/API.md` 2026-10-13 확정).
 *
 * `accountMock`과 같은 `AccountApi`를 구현한다 — 화면과 스토어는 둘을 구분하지 않는다.
 * 세션은 HttpOnly 쿠키라 **같은 오리진**으로 불러야 실린다. 개발은 Vite proxy가 `/api`를 넘긴다.
 *
 * 서버 오류 본문은 `{"error": code}`뿐이라 **사람이 읽을 문구는 여기서 붙인다**.
 */
import {
  AccountError,
  type AccountApi,
  type AccountErrorCode,
  type ArchiveDetail,
  type ArchiveDraft,
  type ArchiveEntry,
  type Profile,
  type RecordingRef,
  type ResumeDraft,
  type ResumeSlot,
  type Session,
  type SignupConfig,
  type SignupOptions,
  type CodeSent,
} from './account'

const BASE = '/api'

/** 코드마다 화면에 그대로 나갈 한 줄. 여기 없는 코드는 unknown으로 떨어진다 */
const MESSAGES: Record<AccountErrorCode, string> = {
  email_taken: '이미 가입된 이메일입니다',
  weak_password: '비밀번호는 8자 이상이어야 합니다',
  missing_name: '이름을 입력하세요',
  invalid_email: '이메일 형식이 올바르지 않습니다',
  consent_required: '저장 동의가 필요합니다',
  bad_credentials: '이메일 또는 비밀번호가 올바르지 않습니다',
  unauthorized: '로그인이 필요합니다',
  not_found: '없는 항목입니다',
  no_tickets: '남은 티켓이 없습니다',
  slot_full: '칸이 모두 찼습니다',
  invalid: '입력한 값을 다시 확인해 주세요',
  missing_field: '빠진 칸이 있습니다',
  rate_limited: '요청이 너무 잦습니다 — 잠시 뒤 다시 시도하세요',
  bad_origin: '허용되지 않은 접근입니다',
  premium_required: '모모 프리미엄 계정만 쓸 수 있습니다',
  purchase_disabled: '지금은 결제를 받지 않습니다',
  invalid_premium_interview: '이 면접은 보관할 수 없습니다',
  too_large: '파일이 너무 큽니다',
  unsupported_media: '지원하지 않는 형식입니다',
  code_required: '인증번호를 입력하세요',
  code_invalid: '인증번호가 맞지 않습니다',
  code_expired: '인증번호가 만료되었습니다 — 다시 받아 주세요',
  code_cooldown: '잠시 뒤에 다시 받을 수 있습니다',
  code_limit: '인증번호를 너무 많이 받았습니다 — 1시간 뒤에 다시 시도하세요',
  mail_failed: '메일을 보내지 못했습니다 — 잠시 뒤 다시 시도하세요',
  mail_unavailable: '지금은 인증 메일을 보낼 수 없습니다',
  verify_disabled: '이메일 인증을 쓰지 않는 서버입니다',
  terms_required: '이용약관에 동의해 주세요',
  network: '연결하지 못했습니다',
  unavailable: '아직 준비 중입니다',
  unknown: '요청을 처리하지 못했습니다',
}

const KNOWN = new Set(Object.keys(MESSAGES))

function toError(body: unknown): AccountError {
  const b = (body ?? {}) as {
    error?: unknown
    kind?: unknown
    field?: unknown
    retryAfterSec?: unknown
    attemptsLeft?: unknown
    rule?: unknown
  }
  const raw = typeof b.error === 'string' ? b.error : ''
  const code = (KNOWN.has(raw) ? raw : 'unknown') as AccountErrorCode
  const kind = b.kind === 'company' || b.kind === 'admission' ? b.kind : undefined
  const e = new AccountError(code, MESSAGES[code], kind)
  // 서버가 덧붙인 것들 — 화면이 칸을 짚고, 버튼을 몇 초 잠글지 정한다
  if (typeof b.field === 'string') e.field = b.field
  if (typeof b.retryAfterSec === 'number') e.retryAfterSec = b.retryAfterSec
  if (typeof b.attemptsLeft === 'number') e.attemptsLeft = b.attemptsLeft
  if (typeof b.rule === 'string') e.rule = b.rule
  return e
}

type Body = Record<string, unknown>

async function call<T>(path: string, method = 'GET', body?: Body): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, {
      method,
      // 세션 쿠키. 빼면 로그인해도 다음 요청이 비로그인으로 간다
      credentials: 'include',
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
  } catch {
    throw new AccountError('network', MESSAGES.network)
  }
  // 204에는 본문이 없다 — 파싱하려 들면 거기서 터진다
  if (res.status === 204) return undefined as T
  const parsed = await res.json().catch(() => undefined)
  if (!res.ok) throw toError(parsed)
  return parsed as T
}

export function makeHttpAccount(): AccountApi {
  return {
    me: () => call<Session | null>('/me'),

    async emailTaken(email) {
      const r = await call<{ taken: boolean }>(
        `/auth/email-taken?email=${encodeURIComponent(email)}`,
      )
      return r.taken
    },

    signupConfig: () => call<SignupConfig>('/auth/signup/config'),

    sendSignupCode: (email) => call<CodeSent>('/auth/signup/code', 'POST', { email }),

    // code는 **문자열**로 보낸다 — 숫자로 보내면 "012345"의 앞자리 0이 사라진다.
    // 약관을 받지 않는 서버에서는 안내 문구를 읽고 누른 것으로 보아 consent를 true로 둔다(spec 7.1)
    signUp: (email, password, name, opts: SignupOptions = {}) =>
      call<Session>('/auth/signup', 'POST', {
        email,
        password,
        name,
        consent: opts.consent ?? true,
        code: opts.code ?? '',
        ...(opts.termsAgreed === undefined ? {} : { termsAgreed: opts.termsAgreed }),
      }),

    signIn: (email, password) => call<Session>('/auth/login', 'POST', { email, password }),

    signInWithGoogle() {
      // 서버에 아직 없다. 조용히 아무 일도 안 하는 것보다 준비 중이라고 말하는 쪽이 낫다
      return Promise.reject(new AccountError('unavailable', '구글 로그인은 준비 중입니다'))
    },

    signOut: () => call<void>('/auth/logout', 'POST'),

    saveProfile: (profile: Profile) => call<Session>('/profile', 'PUT', { ...profile }),

    listResumes: () => call<ResumeSlot[]>('/resumes'),

    saveResume: (draft: ResumeDraft) =>
      draft.id
        ? // kind는 서버가 무시한다 — 종류는 만들 때 정해진다
          call<ResumeSlot>(`/resumes/${draft.id}`, 'PUT', {
            title: draft.title,
            text: draft.text,
          })
        : call<ResumeSlot>('/resumes', 'POST', {
            kind: draft.kind,
            title: draft.title,
            text: draft.text,
          }),

    deleteResume: (id) => call<void>(`/resumes/${id}`, 'DELETE'),

    listArchive: () => call<ArchiveEntry[]>('/archive'),

    getArchive: (id) => call<ArchiveDetail>(`/archive/${id}`),

    // hasRecording·recordings는 서버가 정하므로 보내도 무시된다
    saveArchive: (draft: ArchiveDraft) =>
      call<{ entry: ArchiveEntry; evicted: string[] }>('/archive', 'POST', { ...draft }),

    deleteArchive: (id) => call<void>(`/archive/${id}`, 'DELETE'),

    async uploadRecording(archiveId, turn, clip) {
      const form = new FormData()
      form.append('archiveId', archiveId)
      form.append('turn', String(turn))
      form.append('clip', clip)
      let res: Response
      try {
        // Content-Type을 직접 붙이지 않는다 — 브라우저가 경계(boundary)를 넣어야 한다
        res = await fetch(`${BASE}/recordings`, {
          method: 'POST',
          credentials: 'include',
          body: form,
        })
      } catch {
        throw new AccountError('network', MESSAGES.network)
      }
      if (res.ok) return (await res.json()) as RecordingRef
      // 413은 nginx가 먼저 막아 본문이 JSON이 아닐 수 있다 — 상태로 판단한다
      if (res.status === 413) throw new AccountError('too_large', MESSAGES.too_large)
      throw toError(await res.json().catch(() => undefined))
    },

    purchasePremium: () => call<Session>('/premium/purchase', 'POST'),
  }
}

export const httpAccount = makeHttpAccount()
