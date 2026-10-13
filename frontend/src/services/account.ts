/** 계정 서버 접점 하나 (spec 2026-10-13-accounts-premium-design 9절).
 *
 * 이 인터페이스 뒤에 목업(`accountMock`)과 실제 fetch 구현을 갈아 끼운다.
 * 화면은 구현을 모르므로 API가 없는 동안에도 전부 만들 수 있다.
 */

export type Tier = 'member' | 'premium'
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

export type AccountErrorCode =
  | 'email_taken'
  | 'weak_password'
  | 'bad_credentials'
  | 'unauthorized'
  | 'no_tickets'
  | 'slot_full'
  | 'network'

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

export interface AccountApi {
  /** 비로그인은 오류가 아니라 null이다 */
  me(): Promise<Session | null>
  emailTaken(email: string): Promise<boolean>
  signUp(email: string, password: string): Promise<Session>
  signIn(email: string, password: string): Promise<Session>
  /** 실제 구현은 리다이렉트. 목업은 이메일을 직접 받는다 */
  signInWithGoogle(email?: string): Promise<Session>
  signOut(): Promise<void>
  saveProfile(profile: Profile): Promise<Session>

  listResumes(): Promise<ResumeSlot[]>
  saveResume(draft: ResumeDraft): Promise<ResumeSlot>
  deleteResume(id: string): Promise<void>

  purchasePremium(): Promise<Session>
  spendTicket(): Promise<Session>
}

export const PASSWORD_MIN = 8
/** 종류(대입·회사)마다 이 개수까지 */
export const RESUME_SLOTS = 3
export const PREMIUM_TICKETS = 10
