/** localStorage 위의 가짜 서버 (spec 9절).
 *
 * 화면을 API 없이 완성하기 위한 것이다. 실제 API가 생기면 같은 인터페이스로 갈아 끼우고
 * 화면 코드는 건드리지 않는다.
 *
 * 저장이 막힌 브라우저(사생활 모드)에서도 던지지 않는다 — 이번 세션만 기억을 잃는다.
 */
import {
  AccountError,
  PASSWORD_MIN,
  PREMIUM_TICKETS,
  RESUME_SLOTS,
  type AccountApi,
  type Profile,
  type ResumeDraft,
  type ResumeSlot,
  type Session,
} from './account'

const KEY = 'momo.mock.account'

interface User extends Session {
  password: string
}
interface Db {
  users: User[]
  resumes: ResumeSlot[]
  /** 이력서 id → 주인 userId */
  owner: Record<string, string>
  sessionId: string | null
}

const empty = (): Db => ({ users: [], resumes: [], owner: {}, sessionId: null })

function load(): Db {
  try {
    const raw = localStorage.getItem(KEY)
    const v: unknown = raw ? JSON.parse(raw) : null
    if (!v || typeof v !== 'object') return empty()
    return { ...empty(), ...(v as Partial<Db>) }
  } catch {
    return empty()
  }
}

function save(db: Db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    /* 사생활 모드 등 — 이번 세션만 유지된다 */
  }
}

const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`
const now = () => new Date().toISOString()

/** 비밀번호를 세션 밖으로 내보내지 않는다 — 내보낼 필드를 하나씩 적는다 */
function strip(u: User): Session {
  return {
    userId: u.userId,
    email: u.email,
    tier: u.tier,
    tickets: u.tickets,
    profile: { ...u.profile },
    createdAt: u.createdAt,
  }
}

export function makeMockAccount(opts: { delayMs?: number } = {}): AccountApi {
  const delay = opts.delayMs ?? 300
  const wait = () => new Promise((r) => setTimeout(r, delay))

  /** 로그인한 사용자를 꺼낸다. 없으면 unauthorized */
  function current(db: Db): User {
    const u = db.users.find((x) => x.userId === db.sessionId)
    if (!u) throw new AccountError('unauthorized', '로그인이 필요합니다')
    return u
  }

  return {
    async me() {
      await wait()
      const db = load()
      const u = db.users.find((x) => x.userId === db.sessionId)
      return u ? strip(u) : null
    },

    async emailTaken(email) {
      await wait()
      return load().users.some((u) => u.email === email)
    },

    async signUp(email, password) {
      await wait()
      const db = load()
      if (db.users.some((u) => u.email === email))
        throw new AccountError('email_taken', '이미 가입된 이메일입니다')
      if (password.length < PASSWORD_MIN)
        throw new AccountError('weak_password', `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다`)
      const u: User = {
        userId: newId('u'),
        email,
        password,
        tier: 'member',
        tickets: 0,
        profile: { name: null, age: null },
        createdAt: now(),
      }
      db.users.push(u)
      db.sessionId = u.userId
      save(db)
      return strip(u)
    },

    async signIn(email, password) {
      await wait()
      const db = load()
      const u = db.users.find((x) => x.email === email && x.password === password)
      // 계정 없음과 비밀번호 틀림을 구분하지 않는다 — 가입 여부를 흘리지 않기 위해
      if (!u) throw new AccountError('bad_credentials', '이메일 또는 비밀번호가 올바르지 않습니다')
      db.sessionId = u.userId
      save(db)
      return strip(u)
    },

    async signInWithGoogle(email = 'google.user@gmail.com') {
      await wait()
      const db = load()
      // 같은 이메일로 이미 가입돼 있으면 그 계정에 붙인다(계정이 둘로 갈라지지 않게)
      let u = db.users.find((x) => x.email === email)
      if (!u) {
        u = {
          userId: newId('u'),
          email,
          password: '',
          tier: 'member',
          tickets: 0,
          profile: { name: null, age: null },
          createdAt: now(),
        }
        db.users.push(u)
      }
      db.sessionId = u.userId
      save(db)
      return strip(u)
    },

    async signOut() {
      await wait()
      const db = load()
      db.sessionId = null
      save(db)
    },

    async saveProfile(profile: Profile) {
      await wait()
      const db = load()
      const u = current(db)
      u.profile = { ...profile }
      save(db)
      return strip(u)
    },

    async listResumes() {
      await wait()
      const db = load()
      const u = current(db)
      return db.resumes.filter((r) => db.owner[r.id] === u.userId)
    },

    async saveResume(draft: ResumeDraft) {
      await wait()
      const db = load()
      const u = current(db)
      const mine = db.resumes.filter((r) => db.owner[r.id] === u.userId)
      if (draft.id) {
        const found = mine.find((r) => r.id === draft.id)
        if (!found) throw new AccountError('unauthorized', '없는 이력서입니다')
        found.kind = draft.kind
        found.title = draft.title
        found.text = draft.text
        found.updatedAt = now()
        save(db)
        return { ...found }
      }
      if (mine.filter((r) => r.kind === draft.kind).length >= RESUME_SLOTS)
        throw new AccountError('slot_full', `${RESUME_SLOTS}개를 모두 썼습니다`, draft.kind)
      const slot: ResumeSlot = {
        id: newId('r'),
        kind: draft.kind,
        title: draft.title,
        text: draft.text,
        updatedAt: now(),
      }
      db.resumes.push(slot)
      db.owner[slot.id] = u.userId
      save(db)
      return { ...slot }
    },

    async deleteResume(id) {
      await wait()
      const db = load()
      const u = current(db)
      if (db.owner[id] !== u.userId) throw new AccountError('unauthorized', '없는 이력서입니다')
      db.resumes = db.resumes.filter((r) => r.id !== id)
      delete db.owner[id]
      save(db)
    },

    async purchasePremium() {
      await wait()
      const db = load()
      const u = current(db)
      u.tier = 'premium'
      u.tickets += PREMIUM_TICKETS
      save(db)
      return strip(u)
    },

    async spendTicket() {
      await wait()
      const db = load()
      const u = current(db)
      if (u.tickets <= 0) throw new AccountError('no_tickets', '남은 티켓이 없습니다')
      u.tickets -= 1
      save(db)
      return strip(u)
    },
  }
}

/** 앱이 쓰는 구현. 실제 API가 생기면 여기만 갈아 끼운다 */
export const account: AccountApi = makeMockAccount()
