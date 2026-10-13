import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAccountStore, setAccountApi } from '@/stores/account'
import { makeMockAccount } from '@/services/accountMock'
import type { ArchiveDraft } from '@/services/account'
import ArchiveModal from './ArchiveModal.vue'

const draft = (over: Partial<ArchiveDraft> = {}): ArchiveDraft => ({
  interviewerId: 'm1',
  premium: false,
  track: 'company',
  startedAt: '2026-10-09T01:00:00Z',
  endedAt: '2026-10-09T01:20:00Z',
  questionCount: 5,
  hasRecording: false,
  field: 'it',
  job: '백엔드 개발자',
  messages: [
    { role: 'model', text: '자기소개를 해 주세요' },
    { role: 'user', text: '안녕하세요 백엔드 개발자입니다' },
  ],
  report: [{ question: '지원 동기는?', answerSummary: '동아리', feedback: '구체적입니다' }],
  reportRaw: '{}',
  recordings: [],
  ...over,
})

let w: VueWrapper | null = null
/** Teleport 모달은 반드시 거둔다 — 안 그러면 다음 테스트의 querySelector가 이전 모달을 집는다 */
afterEach(() => {
  w?.unmount()
  w = null
})

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  setAccountApi(makeMockAccount({ delayMs: 0 }))
})

async function withEntries(...drafts: ArchiveDraft[]) {
  const a = useAccountStore()
  await a.signUp('a@b.com', 'pw123456')
  for (const d of drafts) await a.saveArchive(d)
  w = mount(ArchiveModal, { props: { open: true } })
  await settle()
  return a
}

/** 목업의 wait()는 delayMs:0도 setTimeout을 거친다 — flushPromises만으론 부족하다 */
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0))
    await flushPromises()
  }
}

const rows = () => document.querySelectorAll('[data-test="archive-row"]')
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)

describe('ArchiveModal — 목록', () => {
  it('탭 셋을 그리고 개수를 적는다', async () => {
    await withEntries(draft(), draft({ premium: true, interviewerId: 'm2' }))
    const tabs = document.querySelectorAll('[data-test="archive-tab"]')
    expect(tabs).toHaveLength(3)
    expect(tabs[0].textContent).toContain('2')
    expect(tabs[1].textContent).toContain('1/5')
    expect(tabs[2].textContent).toContain('1')
  })

  it('전체 탭에서 프리미엄 줄에 배지가 붙는다', async () => {
    await withEntries(draft({ premium: true, interviewerId: 'm2' }))
    expect(q('[data-test="archive-row"] [data-test="row-premium"]')).not.toBeNull()
  })

  it('일반 탭은 일반만, 프리미엄 탭은 프리미엄만 보여 준다', async () => {
    await withEntries(draft(), draft({ premium: true, interviewerId: 'm2' }))
    const tabs = document.querySelectorAll<HTMLElement>('[data-test="archive-tab"]')
    expect(rows()).toHaveLength(2)
    tabs[1].click()
    await settle()
    expect(rows()).toHaveLength(1)
    expect(q('[data-test="row-premium"]')).toBeNull()
    tabs[2].click()
    await settle()
    expect(rows()).toHaveLength(1)
    expect(q('[data-test="row-premium"]')).not.toBeNull()
  })

  it('비었으면 아직 없다고 적는다', async () => {
    await withEntries()
    expect(q('[data-test="archive-empty"]')).not.toBeNull()
    expect(rows()).toHaveLength(0)
  })

  it('프리미엄 탭이 비면 숨기지 않고 권유를 띄운다', async () => {
    await withEntries(draft())
    document.querySelectorAll<HTMLElement>('[data-test="archive-tab"]')[2].click()
    await settle()
    expect(q('[data-test="premium-cta"]')).not.toBeNull()
  })

  it('권유를 누르면 요금제를 연다', async () => {
    await withEntries(draft())
    document.querySelectorAll<HTMLElement>('[data-test="archive-tab"]')[2].click()
    await settle()
    q('[data-test="premium-cta"] button')!.click()
    await settle()
    expect(w!.emitted('need-premium')).toHaveLength(1)
  })

  it('5개가 차면 다음에 하나가 사라진다고 미리 알린다', async () => {
    await withEntries(
      ...[1, 2, 3, 4, 5].map((i) => draft({ startedAt: `2026-10-0${i}T00:00:00Z` })),
    )
    expect(q('[data-test="archive-full"]')).not.toBeNull()
  })

  it('차지 않았으면 경고하지 않는다', async () => {
    await withEntries(draft())
    expect(q('[data-test="archive-full"]')).toBeNull()
  })
})

describe('ArchiveModal — 상세', () => {
  async function openDetail() {
    const a = await withEntries(draft())
    q('[data-test="archive-row"]')!.click()
    await settle()
    return a
  }

  it('줄을 누르면 상세로 갈아 낀다 — 모달은 하나다', async () => {
    await openDetail()
    expect(document.querySelectorAll('[data-test="modal"]')).toHaveLength(1)
    expect(q('[data-test="archive-detail"]')).not.toBeNull()
    expect(rows()).toHaveLength(0)
  })

  it('상세가 리포트 카드를 그린다', async () => {
    await openDetail()
    expect(document.querySelectorAll('[data-test="card"]')).toHaveLength(1)
  })

  it('상세가 대화를 보여 준다', async () => {
    await openDetail()
    expect(q('[data-test="archive-detail"]')!.textContent).toContain(
      '안녕하세요 백엔드 개발자입니다',
    )
  })

  it('녹음이 있으면 답변 옆에서 재생할 수 있다', async () => {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456')
    await a.saveArchive(
      draft({ premium: true, hasRecording: true, recordings: [{ turn: 0, url: 'blob:x' }] }),
    )
    w = mount(ArchiveModal, { props: { open: true } })
    await settle()
    q('[data-test="archive-row"]')!.click()
    await settle()
    expect(document.querySelectorAll('[data-test="archive-clip"]')).toHaveLength(1)
  })

  it('녹음이 없으면 재생 줄을 그리지 않는다 — 빈 플레이어는 고장처럼 보인다', async () => {
    await openDetail()
    expect(q('[data-test="archive-clip"]')).toBeNull()
  })

  it('상세의 뒤로가기로 목록에 돌아온다', async () => {
    await openDetail()
    q('[data-test="archive-back"]')!.click()
    await settle()
    expect(q('[data-test="archive-detail"]')).toBeNull()
    expect(rows()).toHaveLength(1)
  })

  it('상세에서 지우면 목록으로 돌아가고 줄이 사라진다', async () => {
    await openDetail()
    q('[data-test="archive-delete"]')!.click()
    await settle()
    expect(q('[data-test="archive-detail"]')).toBeNull()
    expect(rows()).toHaveLength(0)
  })

  it('닫았다 열면 목록부터 시작한다', async () => {
    await openDetail()
    await w!.setProps({ open: false })
    await w!.setProps({ open: true })
    await settle()
    expect(q('[data-test="archive-detail"]')).toBeNull()
  })
})
