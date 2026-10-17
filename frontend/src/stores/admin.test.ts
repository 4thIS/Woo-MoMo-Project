import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { AdminError, adminApi } from '@/services/adminApi'
import { useAdminStore } from './admin'

const page = (n: number) => ({ page: n, pageSize: 50, total: 0, items: [] })

beforeEach(() => {
  setActivePinia(createPinia())
  vi.restoreAllMocks()
})

describe('admin 스토어', () => {
  it('탭을 열면 그 탭 데이터를 읽는다', async () => {
    const ov = vi.spyOn(adminApi, 'overview').mockResolvedValue({ users: { total: 1 } } as never)
    const s = useAdminStore()
    await s.loadTab('overview')
    expect(s.tab).toBe('overview')
    expect(ov).toHaveBeenCalled()
    expect(s.overview).toEqual({ users: { total: 1 } })
    expect(s.loading).toBe(false)
  })

  it('사용량·감사 탭', async () => {
    const us = vi.spyOn(adminApi, 'usage').mockResolvedValue({ byDay: [] } as never)
    const au = vi.spyOn(adminApi, 'audit').mockResolvedValue(page(1) as never)
    const s = useAdminStore()
    await s.loadTab('usage')
    expect(us).toHaveBeenCalledWith(30)
    await s.loadTab('audit')
    expect(au).toHaveBeenCalledWith(1)
  })

  it('검색하면 1페이지로 돌아간다', async () => {
    const us = vi.spyOn(adminApi, 'users').mockResolvedValue(page(1) as never)
    const s = useAdminStore()
    await s.loadTab('users')
    await s.goPage(3)
    expect(us).toHaveBeenLastCalledWith('', 3)
    await s.searchUsers('kim')
    expect(s.page).toBe(1)
    expect(s.query).toBe('kim')
    expect(us).toHaveBeenLastCalledWith('kim', 1)
  })

  it('goPage는 감사 탭에서 감사 로그를 읽는다', async () => {
    const au = vi.spyOn(adminApi, 'audit').mockResolvedValue(page(2) as never)
    const s = useAdminStore()
    await s.loadTab('audit')
    await s.goPage(2)
    expect(au).toHaveBeenLastCalledWith(2)
  })

  it('사용자 열기·닫기', async () => {
    vi.spyOn(adminApi, 'user').mockResolvedValue({ user: { id: 'u_1' } } as never)
    const s = useAdminStore()
    await s.openUser('u_1')
    expect(s.detail).toEqual({ user: { id: 'u_1' } })
    s.closeUser()
    expect(s.detail).toBeNull()
  })

  it('티켓 조정 성공 뒤 상세와 목록을 다시 읽는다', async () => {
    const adj = vi.spyOn(adminApi, 'adjustTickets').mockResolvedValue(8)
    const detail = vi.spyOn(adminApi, 'user').mockResolvedValue({ user: { id: 'u_1' } } as never)
    const users = vi.spyOn(adminApi, 'users').mockResolvedValue(page(1) as never)
    const s = useAdminStore()
    await s.openUser('u_1')
    detail.mockClear()
    const ok = await s.adjustTickets(5, '보상')
    expect(ok).toBe(true)
    expect(adj).toHaveBeenCalledWith('u_1', 5, '보상')
    expect(detail).toHaveBeenCalledWith('u_1')
    expect(users).toHaveBeenCalledWith('', 1)
  })

  it('티켓 조정 실패는 error 문구에 담고 다시 읽지 않는다', async () => {
    vi.spyOn(adminApi, 'adjustTickets').mockRejectedValue(
      new AdminError('insufficient_tickets', '회수할 티켓이 부족합니다'),
    )
    const detail = vi.spyOn(adminApi, 'user').mockResolvedValue({ user: { id: 'u_1' } } as never)
    const s = useAdminStore()
    await s.openUser('u_1')
    detail.mockClear()
    const ok = await s.adjustTickets(-99, '회수')
    expect(ok).toBe(false)
    expect(s.error).toBe('회수할 티켓이 부족합니다')
    expect(detail).not.toHaveBeenCalled()
  })

  it('읽기 오류도 error에 담고 던지지 않는다', async () => {
    vi.spyOn(adminApi, 'overview').mockRejectedValue(
      new AdminError('admin_required', '관리자만 볼 수 있습니다'),
    )
    const s = useAdminStore()
    await s.loadTab('overview')
    expect(s.error).toBe('관리자만 볼 수 있습니다')
    expect(s.loading).toBe(false)
  })

  it('사용량 기간을 바꾸면 다시 읽는다', async () => {
    const us = vi.spyOn(adminApi, 'usage').mockResolvedValue({ byDay: [] } as never)
    const s = useAdminStore()
    await s.setUsageDays(7)
    expect(s.usageDays).toBe(7)
    expect(us).toHaveBeenCalledWith(7)
  })
})
