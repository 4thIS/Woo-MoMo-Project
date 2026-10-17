/** 관리자 대시보드 상태. 서비스를 감싸 화면이 볼 것만 남긴다.
 *
 * 모든 action은 오류를 던지지 않고 `error`(화면에 그대로 보일 문구)에 담는다.
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

export const useAdminStore = defineStore('admin', {
  state: () => ({
    tab: 'overview' as AdminTab,
    overview: null as AdminOverview | null,
    users: null as AdminUserPage | null,
    query: '',
    page: 1,
    detail: null as AdminUserDetail | null,
    usage: null as AdminUsage | null,
    usageDays: 30,
    audit: null as AdminAuditPage | null,
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

    async refreshTab() {
      switch (this.tab) {
        case 'overview': {
          const r = await this.run(() => adminApi.overview())
          if (r) this.overview = r
          break
        }
        case 'users': {
          const r = await this.run(() => adminApi.users(this.query, this.page))
          if (r) this.users = r
          break
        }
        case 'usage': {
          const r = await this.run(() => adminApi.usage(this.usageDays))
          if (r) this.usage = r
          break
        }
        case 'audit': {
          const r = await this.run(() => adminApi.audit(this.page))
          if (r) this.audit = r
          break
        }
      }
    },

    async loadTab(tab: AdminTab) {
      if (tab !== this.tab) this.page = 1
      this.tab = tab
      await this.refreshTab()
    },

    async searchUsers(q: string) {
      this.query = q
      this.page = 1
      this.tab = 'users'
      await this.refreshTab()
    },

    async goPage(n: number) {
      this.page = n
      await this.refreshTab()
    },

    async openUser(id: string) {
      const r = await this.run(() => adminApi.user(id))
      if (r) this.detail = r
    },

    closeUser() {
      this.detail = null
    },

    /** 성공하면 true — 상세와 목록을 다시 읽는다 */
    async adjustTickets(delta: number, reason: string): Promise<boolean> {
      const id = this.detail?.user.id
      if (!id) return false
      const left = await this.run(() => adminApi.adjustTickets(id, delta, reason))
      if (left === null) return false
      await this.openUser(id)
      const users = await this.run(() => adminApi.users(this.query, this.page))
      if (users) this.users = users
      return true
    },

    async setUsageDays(d: number) {
      this.usageDays = d
      this.tab = 'usage'
      await this.refreshTab()
    },
  },
})
