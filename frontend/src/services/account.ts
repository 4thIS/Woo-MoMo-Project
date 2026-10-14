/** 계정 서버 접점 하나 (spec 2026-10-13-accounts-premium-design 9절).
 *
 * 이 인터페이스 뒤에 목업(`accountMock`)과 실제 fetch 구현을 갈아 끼운다.
 * 화면은 구현을 모르므로 API가 없는 동안에도 전부 만들 수 있다.
 */

import type { ReportItem } from '@/utils/reportParser'

export type Tier = 'member' | 'premium'
/** 면접의 갈래. 고른 면접관이 정한다 — 둘 다 보는 벤만 사용자가 고른다 */
export type Track = 'company' | 'admission'
export type ResumeKind = 'admission' | 'company'

/** 대입 면접에서 미리 채울 값. 내정보에서 고친다 */
export interface Profile {
  name: string | null
  age: number | null
}

export interface Session {
  userId: string
  email: string
  tier: Tier
  /** 프리미엄 면접 남은 횟수. member는 항상 0 */
  tickets: number
  /** 목업 결제를 쓸 수 있는 계정인가. 일반 계정은 false */
  isAdmin: boolean
  profile: Profile
  createdAt: string
}

export interface ResumeSlot {
  id: string
  kind: ResumeKind
  title: string
  /** company면 이력서 원문, admission이면 자기소개서 원문 */
  text: string
  updatedAt: string
}

/** id가 있으면 덮어쓰기, 없으면 새 슬롯 */
export interface ResumeDraft {
  id?: string
  kind: ResumeKind
  title: string
  text: string
}

/** 서버가 주는 코드(`docs/API.md` 공통 오류 표)와 프론트가 만드는 둘(`network`·`unavailable`).
 *  모르는 코드는 지어내지 않고 `unknown`으로 둔다 — 서버가 코드를 늘려도 화면은 버틴다 */
export type AccountErrorCode =
  | 'email_taken'
  | 'weak_password'
  | 'missing_name'
  | 'invalid_email'
  | 'consent_required'
  | 'bad_credentials'
  | 'unauthorized'
  | 'not_found'
  | 'no_tickets'
  | 'slot_full'
  | 'invalid'
  | 'missing_field'
  | 'rate_limited'
  | 'bad_origin'
  | 'premium_required'
  | 'purchase_disabled'
  | 'invalid_premium_interview'
  | 'too_large'
  | 'unsupported_media'
  /** 연결 자체가 안 됨 */
  | 'network'
  /** 아직 없는 기능(구글 로그인) */
  | 'unavailable'
  | 'unknown'

/** 화면은 code로 분기하고 message를 그대로 보여 준다 */
export class AccountError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    message: string,
    /** slot_full일 때 어느 종류가 찼는지 */
    readonly kind?: ResumeKind,
  ) {
    super(message)
    this.name = 'AccountError'
  }
}

/** 보관함 목록용 — 가볍다. 대화·리포트는 담기지 않는다 */
export interface ArchiveEntry {
  id: string
  interviewerId: string
  /** 벤으로 본 면접인가 — 보관 한도에서 빠진다 */
  premium: boolean
  track: Track
  startedAt: string
  endedAt: string
  questionCount: number
  hasRecording: boolean
  /** track === 'company'일 때만 */
  field?: string
  job?: string
  /** track === 'admission'일 때만 */
  name?: string
  age?: number
  university?: string
  department?: string
}

/** 보관함 상세 — 목록에 더해 대화와 리포트까지 */
export interface ArchiveDetail extends ArchiveEntry {
  messages: { role: 'user' | 'model'; text: string; at?: number }[]
  report: ReportItem[]
  reportRaw: string
  /** 프리미엄 면접만 */
  recordings: { turn: number; url: string }[]
}

export type ArchiveDraft = Omit<ArchiveDetail, 'id'> & {
  /** premium이면 필수 — 본인의, 리포트까지 끝난, 아직 저장 안 된 벤 면접 id */
  premiumInterviewId?: string
}

export interface AccountApi {
  /** 비로그인은 오류가 아니라 null이다 */
  me(): Promise<Session | null>
  emailTaken(email: string): Promise<boolean>
  /** 이름은 가입할 때 받는다 — 대입 면접의 이름 칸을 미리 채우는 값이다 */
  signUp(email: string, password: string, name: string): Promise<Session>
  signIn(email: string, password: string): Promise<Session>
  /** 실제 구현은 리다이렉트. 목업은 이메일을 직접 받는다 */
  signInWithGoogle(email?: string): Promise<Session>
  signOut(): Promise<void>
  saveProfile(profile: Profile): Promise<Session>

  listResumes(): Promise<ResumeSlot[]>
  saveResume(draft: ResumeDraft): Promise<ResumeSlot>
  deleteResume(id: string): Promise<void>

  listArchive(): Promise<ArchiveEntry[]>
  getArchive(id: string): Promise<ArchiveDetail>
  /** 한도는 서버가 집행한다. 밀려난 기록의 id를 함께 돌려준다 */
  saveArchive(draft: ArchiveDraft): Promise<{ entry: ArchiveEntry; evicted: string[] }>
  deleteArchive(id: string): Promise<void>

  /** 목업 결제. 서버에서는 관리자만 — 일반 계정은 `purchase_disabled` */
  purchasePremium(): Promise<Session>
}

export const PASSWORD_MIN = 8
/** 종류(대입·회사)마다 이 개수까지 */
export const RESUME_SLOTS = 3
export const PREMIUM_TICKETS = 10
