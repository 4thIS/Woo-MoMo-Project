import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/llm', () => ({ startSession: vi.fn() }))
vi.mock('@/services/api', () => ({ getQuestions: vi.fn(), getManifest: vi.fn() }))
import { useArchiveViewStore } from './archiveView'
import { useAccountStore } from './account'
import { useInterviewStore } from './interview'
import { useModalStore } from './modal'

const detail = { id: 'a1', report: [], messages: [], recordings: [] }

beforeEach(() => setActivePinia(createPinia()))

describe('archiveView', () => {
  it('열면 상세를 받아 들고 모달을 닫는다 — 한 번에 하나만 연다', async () => {
    vi.spyOn(useAccountStore(), 'getArchive').mockResolvedValue(detail as never)
    useModalStore().show('archive')
    const v = useArchiveViewStore()
    await v.open('a1')
    expect(v.detail?.id).toBe('a1')
    expect(useModalStore().open).toBe(null)
  })

  it('면접 중에는 열지 않는다 — 면접이 날아간다', async () => {
    const get = vi.spyOn(useAccountStore(), 'getArchive').mockResolvedValue(detail as never)
    useInterviewStore().$patch({ phase: 'interview' })
    const v = useArchiveViewStore()
    await v.open('a1')
    expect(v.detail).toBe(null)
    expect(get).not.toHaveBeenCalled()
  })

  it('열면 히스토리 항목을 하나 민다 — 뒤로 가기로 목록에 돌아온다', async () => {
    const push = vi.spyOn(history, 'pushState')
    vi.spyOn(useAccountStore(), 'getArchive').mockResolvedValue(detail as never)
    await useArchiveViewStore().open('a1')
    expect(push).toHaveBeenCalled()
  })

  it('URL은 건드리지 않는다 — 목차 앵커(#q4)와 해시를 다투면 서로 덮어쓴다', async () => {
    const push = vi.spyOn(history, 'pushState')
    vi.spyOn(useAccountStore(), 'getArchive').mockResolvedValue(detail as never)
    await useArchiveViewStore().open('a1')
    const url = push.mock.calls[0][2]
    expect(url === undefined || url === null || url === '').toBe(true)
  })

  it('받아 오지 못하면 열지 않는다 — 빈 화면이 뜨면 고장처럼 보인다', async () => {
    vi.spyOn(useAccountStore(), 'getArchive').mockResolvedValue(null as never)
    const v = useArchiveViewStore()
    await v.open('a1')
    expect(v.detail).toBe(null)
  })

  it('닫으면 상세를 버린다', async () => {
    vi.spyOn(useAccountStore(), 'getArchive').mockResolvedValue(detail as never)
    const v = useArchiveViewStore()
    await v.open('a1')
    v.close()
    expect(v.detail).toBe(null)
  })
})
