import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AdminView from './AdminView.vue'
import { setAccountApi } from '@/stores/account'
import { makeMockAccount } from '@/services/accountMock'
import { AdminError, adminApi } from '@/services/adminApi'

const session = (isAdmin: boolean) => ({
  userId: 'u_1',
  email: 'boss@b.com',
  tier: 'member' as const,
  tickets: 0,
  isAdmin,
  profile: { name: 'x', age: null },
  createdAt: '2026-10-01T00:00:00Z',
})
const asSession = (s: ReturnType<typeof session> | null) =>
  setAccountApi({ ...makeMockAccount({ delayMs: 0 }), me: async () => s })

const overview = (weak = false) => ({
  users: { total: 12, last7Days: 3, last30Days: 9, withTickets: 4, admins: 1 },
  tickets: { outstanding: 17 },
  ben: { today: 2, dailyLimit: 20, byDay: [{ date: '2026-10-16', count: 3 }] },
  archive: { entries: 30, ben: 5 },
  recordings: { count: 2, bytes: 3 * 1024 * 1024 },
  briefings: { cached: 6 },
  weakEmergencyPassword: weak,
})
const row = (tickets = 3) => ({
  id: 'u_2',
  email: 'kim@b.com',
  name: '<b>김</b>',
  createdAt: '2026-10-01T00:00:00Z',
  tickets,
  isAdmin: false,
  archiveCount: 1,
  benCount: 2,
  lastActiveAt: null,
})
const userPage = (n: number) => ({ page: n, pageSize: 50, total: 120, items: [row()] })
const detail = (tickets = 3) => ({
  user: row(tickets),
  ben: [],
  archive: [],
  ticketLog: [
    { at: '2026-10-02T01:00:00Z', adminEmail: 'boss@b.com', delta: 5, reason: '<i>보상</i>' },
  ],
})

const mountView = async () => {
  const w = mount(AdminView)
  // 목업 계정 API는 타이머를 거친다 — 판정이 끝날 때까지 기다린다
  await vi.waitFor(() => expect(w.find('[data-test=admin-checking]').exists()).toBe(false))
  await flushPromises()
  return w
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.restoreAllMocks()
})

describe('AdminView — 권한', () => {
  it('세션을 읽기 전에는 확인 중', () => {
    asSession(session(true))
    const w = mount(AdminView)
    expect(w.find('[data-test=admin-checking]').exists()).toBe(true)
    // 남겨 두면 나중에 판정이 끝나 다른 테스트의 호출 기록을 어지럽힌다
    w.unmount()
  })

  it('비로그인은 막고 아무것도 읽지 않는다', async () => {
    asSession(null)
    const ov = vi.spyOn(adminApi, 'overview')
    const w = await mountView()
    expect(w.get('[data-test=admin-denied]').text()).toBe('관리자만 볼 수 있습니다')
    expect(w.find('a[href="/"]').exists()).toBe(true)
    expect(ov).not.toHaveBeenCalled()
  })

  it('세션을 읽다 연결이 끊기면 연결 오류를 보인다(관리자 아님 문구가 아니다)', async () => {
    setAccountApi({
      ...makeMockAccount({ delayMs: 0 }),
      me: async () => {
        throw new Error('offline')
      },
    })
    const ov = vi.spyOn(adminApi, 'overview')
    const w = await mountView()
    expect(w.get('[data-test=admin-connection-error]').text()).toContain('연결하지 못했습니다')
    expect(w.find('[data-test=admin-denied]').exists()).toBe(false)
    expect(ov).not.toHaveBeenCalled()
  })

  it('관리자가 아닌 로그인 사용자도 막는다', async () => {
    asSession(session(false))
    const ov = vi.spyOn(adminApi, 'overview')
    const w = await mountView()
    expect(w.find('[data-test=admin-denied]').exists()).toBe(true)
    expect(ov).not.toHaveBeenCalled()
  })

  it('관리자는 탭 4개와 개요를 본다', async () => {
    asSession(session(true))
    vi.spyOn(adminApi, 'overview').mockResolvedValue(overview())
    const w = await mountView()
    for (const t of ['overview', 'users', 'usage', 'audit'])
      expect(w.find(`[data-test=admin-tab-${t}]`).exists()).toBe(true)
    expect(w.findAll('[data-test=admin-card]').length).toBe(10)
    expect(w.text()).toContain('2 / 20')
    expect(w.text()).toContain('3.0 MB')
    expect(w.find('[data-test=admin-weak-password]').exists()).toBe(false)
  })

  it('약한 비상용 비밀번호면 경고 배너', async () => {
    asSession(session(true))
    vi.spyOn(adminApi, 'overview').mockResolvedValue(overview(true))
    const w = await mountView()
    expect(w.get('[data-test=admin-weak-password]').text()).toBe(
      '비상용 관리자 비밀번호가 12자 미만입니다 — 운영 전에 바꿔 주세요',
    )
  })
})

describe('AdminView — 탭·사용자', () => {
  const open = async () => {
    asSession(session(true))
    vi.spyOn(adminApi, 'overview').mockResolvedValue(overview())
    return mountView()
  }
  const toUsers = async (w: Awaited<ReturnType<typeof open>>) => {
    vi.spyOn(adminApi, 'users').mockResolvedValue(userPage(1))
    await w.get('[data-test=admin-tab-users]').trigger('click')
    await flushPromises()
  }

  it('탭을 누르면 그 탭 데이터를 읽어 보여 준다', async () => {
    const w = await open()
    const au = vi.spyOn(adminApi, 'audit').mockResolvedValue({
      page: 1,
      pageSize: 50,
      total: 1,
      items: [
        {
          at: '2026-10-02T01:00:00Z',
          adminEmail: 'boss@b.com',
          action: 'ticket_adjust',
          targetUserId: 'u_2',
          targetEmail: 'kim@b.com',
          delta: -2,
          reason: '회수',
        },
      ],
    })
    await w.get('[data-test=admin-tab-audit]').trigger('click')
    await flushPromises()
    expect(au).toHaveBeenCalledWith(1)
    expect(w.findAll('[data-test=admin-audit-row]')).toHaveLength(1)
    expect(w.get('[data-test=admin-tab-audit]').attributes('aria-selected')).toBe('true')
  })

  it('검색은 Enter와 버튼 모두 되고, 페이지를 넘긴다', async () => {
    const w = await open()
    await toUsers(w)
    const us = vi.spyOn(adminApi, 'users').mockResolvedValue(userPage(1))
    await w.get('[data-test=admin-search-input]').setValue('kim')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(us).toHaveBeenLastCalledWith('kim', 1)
    expect(w.get('[data-test=admin-page]').text()).toBe('1 / 3')
    await w.get('[data-test=admin-search]').trigger('click')
    await flushPromises()
    expect(us).toHaveBeenLastCalledWith('kim', 1)
    us.mockResolvedValue(userPage(2))
    await w.get('[data-test=admin-next]').trigger('click')
    await flushPromises()
    expect(us).toHaveBeenLastCalledWith('kim', 2)
    expect(w.get('[data-test=admin-page]').text()).toBe('2 / 3')
  })

  it('이름·사유는 텍스트로만 그려진다', async () => {
    const w = await open()
    await toUsers(w)
    vi.spyOn(adminApi, 'user').mockResolvedValue(detail())
    expect(w.find('td b').exists()).toBe(false)
    expect(w.text()).toContain('<b>김</b>')
    await w.get('[data-test=admin-user-open]').trigger('click')
    await flushPromises()
    expect(w.find('td i').exists()).toBe(false)
    expect(w.get('[data-test=admin-ticketlog-row]').text()).toContain('<i>보상</i>')
  })

  describe('티켓 조정', () => {
    const opened = async () => {
      const w = await open()
      await toUsers(w)
      vi.spyOn(adminApi, 'user').mockResolvedValue(detail())
      await w.get('[data-test=admin-user-open]').trigger('click')
      await flushPromises()
      return w
    }
    const fill = async (w: Awaited<ReturnType<typeof opened>>, d: string, r: string) => {
      await w.get('[data-test=admin-delta]').setValue(d)
      await w.get('[data-test=admin-reason]').setValue(r)
    }

    it.each([
      ['0', '사유'],
      ['101', '사유'],
      ['-101', '사유'],
      ['1.5', '사유'],
      ['', '사유'],
      ['5', '   '],
      ['5', ''],
    ])('수량 %j · 사유 %j 는 제출할 수 없다', async (d, r) => {
      const w = await opened()
      const adj = vi.spyOn(adminApi, 'adjustTickets').mockResolvedValue(1)
      await fill(w, d, r)
      expect(w.get('[data-test=admin-adjust]').attributes('disabled')).toBeDefined()
      await w.get('form').trigger('submit')
      expect(w.find('[data-test=admin-confirm-text]').exists()).toBe(false)
      expect(adj).not.toHaveBeenCalled()
    })

    it('확인 문구가 먼저 나오고, 취소하면 보내지 않는다', async () => {
      const w = await opened()
      const adj = vi.spyOn(adminApi, 'adjustTickets').mockResolvedValue(1)
      await fill(w, '-2', '회수')
      await w.get('[data-test=admin-adjust]').trigger('click')
      expect(w.get('[data-test=admin-confirm-text]').text()).toBe(
        'kim@b.com 계정에 -2장 — 진행할까요?',
      )
      expect(adj).not.toHaveBeenCalled()
      await w.get('[data-test=admin-cancel]').trigger('click')
      expect(w.find('[data-test=admin-confirm-text]').exists()).toBe(false)
      expect(adj).not.toHaveBeenCalled()
    })

    it('확인하면 보내고 상세를 다시 읽어 입력을 비운다', async () => {
      const w = await opened()
      const adj = vi.spyOn(adminApi, 'adjustTickets').mockResolvedValue(8)
      vi.spyOn(adminApi, 'user').mockResolvedValue(detail(8))
      await fill(w, '5', ' 보상 ')
      await w.get('[data-test=admin-adjust]').trigger('click')
      await w.get('[data-test=admin-confirm]').trigger('click')
      await flushPromises()
      expect(adj).toHaveBeenCalledWith('u_2', 5, '보상')
      expect(w.get('[data-test=admin-tickets]').text()).toBe('8')
      expect((w.get('[data-test=admin-delta]').element as HTMLInputElement).value).toBe('')
      expect(w.find('[data-test=admin-confirm-text]').exists()).toBe(false)
    })

    it('실패하면 오류 문구를 보이고 입력을 남긴다', async () => {
      const w = await opened()
      vi.spyOn(adminApi, 'adjustTickets').mockRejectedValue(
        new AdminError('insufficient_tickets', '회수할 티켓이 부족합니다'),
      )
      await fill(w, '-50', '회수')
      await w.get('[data-test=admin-adjust]').trigger('click')
      await w.get('[data-test=admin-confirm]').trigger('click')
      await flushPromises()
      expect(w.get('[data-test=admin-error]').text()).toBe('회수할 티켓이 부족합니다')
      expect((w.get('[data-test=admin-reason]').element as HTMLInputElement).value).toBe('회수')
    })
  })

  it('비용 탭 — 기간을 바꾸고 기록 시작일·요금표를 보인다', async () => {
    const w = await open()
    const us = vi.spyOn(adminApi, 'usage').mockResolvedValue({
      pricing: {
        model: 'Sonnet 5.5',
        inputPerMTok: 2,
        outputPerMTok: 10,
        cacheReadPerMTok: 0.2,
        cacheWritePerMTok: 2.5,
        webSearch: 0.01,
      },
      since: '2026-10-15T00:00:00Z',
      byDay: [
        {
          date: '2026-10-16',
          calls: 1,
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          webSearches: 0,
          errors: 0,
          refusals: 0,
          costUsd: 0.5,
        },
      ],
      byKind: [{ kind: 'turn', calls: 1, costUsd: 0.5 }],
      topInterviews: [{ interviewId: 'i_1', userEmail: 'kim@b.com', calls: 1, costUsd: 0.5 }],
    })
    await w.get('[data-test=admin-tab-usage]').trigger('click')
    await flushPromises()
    expect(us).toHaveBeenCalledWith(30)
    expect(w.get('[data-test=admin-since]').text()).toContain('2026-10-15')
    expect(w.findAll('[data-test=admin-kind-row]')).toHaveLength(1)
    expect(w.findAll('[data-test=admin-top-row]')).toHaveLength(1)
    expect(w.get('[data-test=admin-pricing]').text()).toContain('$0.0100')
    await w.get('[data-test=admin-days-7]').trigger('click')
    await flushPromises()
    expect(us).toHaveBeenLastCalledWith(7)
  })
})
