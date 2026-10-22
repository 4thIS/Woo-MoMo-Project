/** 관리자 대시보드 상태. 서비스를 감싸 화면이 볼 것만 남긴다.
 *
 * 모든 action은 오류를 던지지 않고 `error`(화면에 그대로 보일 문구)에 담는다.
 * 같은 칸(slot)을 가리키는 요청이 겹치면 가장 나중에 보낸 것만 반영한다.
 */
import { defineStore } from 'pinia'
import {
  adminApi,
  type AdminAuditPage,
  type AdminOverview,
  type AdminUsage,
  type AdminUserDetail,
  type AdminUserPage,
} from '@/services/adminApi'

export type AdminTab = 'overview' | 'users' | 'usage' | 'audit'
type Slot = AdminTab | 'detail'

/** 칸마다 마지막으로 보낸 요청 번호 */
const seq: Record<Slot, number> = { overview: 0, users: 0, usage: 0, audit: 0, detail: 0 }

export const useAdminStore = defineStore('admin', {
  state: () => ({
    tab: 'overview' as AdminTab,
    overview: null as AdminOverview | null,
    users: null as AdminUserPage | null,
    query: '',
    usersPage: 1,
    detail: null as AdminUserDetail | null,
    usage: null as AdminUsage | null,
    usageDays: 30,
    audit: null as AdminAuditPage | null,
    auditPage: 1,
    loading: false,
    error: null as string | null,
  }),
  actions: {
    /** 공통 껍데기 — loading을 켜고 오류 문구를 담는다. 성공하면 값, 실패하면 null */
    async run<T>(fn: () => Promise<T>): Promise<T | null> {
      this.loading = true
      this.error = null
      try {
        return await fn()
      } catch (e) {
        this.error = e instanceof Error ? e.message : '요청을 처리하지 못했습니다'
        return null
      } finally {
        this.loading = false
      }
    },

    /** 요청을 보내고, 그사이 같은 칸에 더 새 요청이 나갔으면 결과를 버린다(null) */
    async fetchSlot<T>(slot: Slot, fn: () => Promise<T>): Promise<T | null> {
      const mine = ++seq[slot]
      const r = await this.run(fn)
      return mine === seq[slot] ? r : null
    },

    async refreshTab() {
      switch (this.tab) {
        case 'overview': {
          const r = await this.fetchSlot('overview', () => adminApi.overview())
          if (r) this.overview = r
          break
        }
        case 'users': {
          const r = await this.fetchSlot('users', () => adminApi.users(this.query, this.usersPage))
          if (r) this.users = r
          break
        }
        case 'usage': {
          const r = await this.fetchSlot('usage', () => adminApi.usage(this.usageDays))
          if (r) this.usage = r
          break
        }
        case 'audit': {
          const r = await this.fetchSlot('audit', () => adminApi.audit(this.auditPage))
          if (r) this.audit = r
          break
        }
      }
    },

    async loadTab(tab: AdminTab) {
      this.detail = null
      seq.detail++
      this.tab = tab
      await this.refreshTab()
    },

    async searchUsers(q: string) {
      this.query = q
      this.usersPage = 1
      this.detail = null
      seq.detail++
      this.tab = 'users'
      await this.refreshTab()
    },

    /** 지금 보는 탭의 페이지를 옮긴다 */
    async goPage(n: number) {
      if (this.tab === 'users') this.usersPage = n
      else if (this.tab === 'audit') this.auditPage = n
      else return
      await this.refreshTab()
    },

    async openUser(id: string) {
      const r = await this.fetchSlot('detail', () => adminApi.user(id))
      if (r) this.detail = r
    },

    closeUser() {
      seq.detail++
      this.detail = null
    },

    /** 성공하면 true — 상세와 목록을 다시 읽는다. 다시 읽다 난 오류는 처음 것을 남긴다 */
    async adjustTickets(delta: number, reason: string): Promise<boolean> {
      const id = this.detail?.user.id
      if (!id) return false
      const left = await this.run(() => adminApi.adjustTickets(id, delta, reason))
      if (left === null) return false
      await this.openUser(id)
      const firstError = this.error
      const users = await this.fetchSlot('users', () => adminApi.users(this.query, this.usersPage))
      if (users) this.users = users
      if (firstError) this.error = firstError
      return true
    },

    async setUsageDays(d: number) {
      this.usageDays = d
      this.detail = null
      this.tab = 'usage'
      await this.refreshTab()
    },
  },
})
