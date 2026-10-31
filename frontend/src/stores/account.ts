/** 계정 상태. 서비스를 감싸 화면이 볼 것만 남긴다 (spec 8절).
 *
 * 모든 action은 오류를 **던지지 않고 `error`에 담는다** — 화면마다 try/catch를 두지 않기 위해서다.
 * 화면은 `error.code`로 분기하고 `error.message`를 그대로 보여 준다.
 */
import { defineStore } from 'pinia'
import { account as defaultApi } from '@/services/accountMock'
import {
  AccountError,
  type AccountApi,
  type ArchiveDetail,
  type ArchiveDraft,
  type ArchiveEntry,
  type Profile,
  type RecordingRef,
  type ResumeDraft,
  type ResumeKind,
  type ResumeSlot,
  type Session,
  type CodeSent,
  type SignupOptions,
} from '@/services/account'
import { isFull } from '@/utils/archive'

let api: AccountApi = defaultApi
/** 테스트·실제 API 전환용 */
export function setAccountApi(next: AccountApi): void {
  api = next
}

/** 진행 중인 load() — 같은 스토어에서 겹쳐 부르면 한 번만 읽는다(TopBar·AdminView) */
const loading = new WeakMap<object, Promise<void>>()

export const useAccountStore = defineStore('account', {
  state: () => ({
    session: null as Session | null,
    resumes: [] as ResumeSlot[],
    archive: [] as ArchiveEntry[],
    loading: false,
    error: null as AccountError | null,
    /** 서버가 가입 이메일 인증을 쓰는가(2026-10-27). 물어보기 전에는 false */
    emailVerify: false,
    /** 서버가 약관 동의를 받는가(2026-10-28). 물어보기 전에는 false */
    termsRequired: false,
  }),
  getters: {
    signedIn: (s) => s.session !== null,
    tier: (s) => s.session?.tier ?? null,
    tickets: (s) => s.session?.tickets ?? 0,
    isPremium: (s) => s.session?.tier === 'premium',
    profile: (s): Profile => s.session?.profile ?? { name: null, age: null },
    slotsOf: (s) => (kind: ResumeKind) => s.resumes.filter((r) => r.kind === kind),
    archiveFull: (s) => isFull(s.archive),
  },
  actions: {
    /** 모든 호출의 공통 껍데기 — loading을 켜고 오류를 담는다. 성공하면 값, 실패하면 null */
    async run<T>(fn: () => Promise<T>): Promise<T | null> {
      this.loading = true
      this.error = null
      try {
        return await fn()
      } catch (e) {
        this.error =
          e instanceof AccountError ? e : new AccountError('network', '연결하지 못했습니다')
        return null
      } finally {
        this.loading = false
      }
    },

    load(): Promise<void> {
      const running = loading.get(this)
      if (running) return running
      const p = (async () => {
        const s = await this.run(() => api.me())
        this.session = s ?? null
        if (s) {
          await this.refreshResumes()
          await this.refreshArchive()
        }
      })().finally(() => loading.delete(this))
      loading.set(this, p)
      return p
    },

    /** 폼 안내용 — 실패해도 error를 건드리지 않는다 */
    async emailTaken(email: string): Promise<boolean> {
      try {
        return await api.emailTaken(email)
      } catch {
        return false
      }
    },

    /** 가입 화면이 열릴 때 한 번. 못 물어보면 인증을 끈 것으로 본다 —
     *  옛 서버(엔드포인트 없음)에서도 가입이 막히지 않아야 한다 */
    async loadSignupConfig(): Promise<void> {
      try {
        const c = await api.signupConfig()
        this.emailVerify = c.emailVerify
        this.termsRequired = c.termsRequired === true
      } catch {
        this.emailVerify = false
        this.termsRequired = false
      }
    },

    /** 인증번호 보내기. 성공하면 두 시간을 돌려주고, 실패는 error에 담는다 */
    async sendSignupCode(email: string): Promise<CodeSent | null> {
      return await this.run(() => api.sendSignupCode(email))
    },

    async signUp(email: string, password: string, name: string, opts?: SignupOptions) {
      const s = await this.run(() => api.signUp(email, password, name, opts))
      if (s) {
        this.session = s
        this.resumes = []
        this.archive = []
      }
    },

    async signIn(email: string, password: string) {
      const s = await this.run(() => api.signIn(email, password))
      if (s) {
        this.session = s
        await this.refreshResumes()
        await this.refreshArchive()
      }
    },

    async signInWithGoogle(email?: string) {
      const s = await this.run(() => api.signInWithGoogle(email))
      if (s) {
        this.session = s
        await this.refreshResumes()
        await this.refreshArchive()
      }
    },

    async signOut() {
      await this.run(() => api.signOut())
      // 실패해도 화면에서는 내보낸다 — 남겨 두는 쪽이 더 위험하다
      this.session = null
      this.resumes = []
      this.archive = []
    },

    async saveProfile(profile: Profile) {
      const s = await this.run(() => api.saveProfile(profile))
      if (s) this.session = s
    },

    async refreshResumes() {
      const list = await this.run(() => api.listResumes())
      if (list) this.resumes = list
    },

    async saveResume(draft: ResumeDraft): Promise<ResumeSlot | null> {
      const slot = await this.run(() => api.saveResume(draft))
      if (slot) await this.refreshResumes()
      return slot
    },

    async deleteResume(id: string) {
      const done = await this.run(() => api.deleteResume(id))
      if (done !== null) await this.refreshResumes()
    },

    async refreshArchive() {
      const list = await this.run(() => api.listArchive())
      if (list) this.archive = list
    },

    /** 돌려주는 `evicted`는 **밀려난 기록의 id** — 화면이 "하나가 사라졌습니다"를 말할 근거다 */
    async saveArchive(
      draft: ArchiveDraft,
    ): Promise<{ entry: ArchiveEntry; evicted: string[] } | null> {
      const saved = await this.run(() => api.saveArchive(draft))
      if (saved) await this.refreshArchive()
      return saved
    },

    /** 목록은 가벼우니 상세는 누를 때 받는다 */
    async getArchive(id: string): Promise<ArchiveDetail | null> {
      return await this.run(() => api.getArchive(id))
    },

    async deleteArchive(id: string) {
      const done = await this.run(() => api.deleteArchive(id))
      if (done !== null) await this.refreshArchive()
    },

    /** 녹음 한 조각. 기록을 만든 뒤라야 받는다 */
    async uploadRecording(
      archiveId: string,
      turn: number,
      clip: Blob,
      durationSec?: number,
    ): Promise<RecordingRef | null> {
      return await this.run(() => api.uploadRecording(archiveId, turn, clip, durationSec))
    },

    async purchasePremium() {
      const s = await this.run(() => api.purchasePremium())
      if (s) this.session = s
    },
  },
})
