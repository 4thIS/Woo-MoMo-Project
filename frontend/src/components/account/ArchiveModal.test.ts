import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAccountStore, setAccountApi } from '@/stores/account'
import { makeMockAccount } from '@/services/accountMock'
import type { ArchiveDraft } from '@/services/account'
import { useArchiveViewStore } from '@/stores/archiveView'
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
  await a.signUp('a@b.com', 'pw123456', '이우진')
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
    expect(q('[data-test="archive-limit"]')!.textContent).toContain('사라집니다')
  })

  it('한도는 꽉 차기 전에도 적는다 — 꽉 찼을 때만 말하면 그전까지는 한도가 있는 줄 모른다', async () => {
    await withEntries(draft())
    const t = q('[data-test="archive-limit"]')!.textContent!
    expect(t).toContain('5')
    expect(t).not.toContain('사라집니다')
  })
})

describe('ArchiveModal — 줄을 누르면', () => {
  /* 상세는 **화면으로 나갔다** (2026-11-07). 모달은 목록만 맡는다 —
     상세가 무엇을 그리는지는 ArchiveDetailView.test.ts가 본다 */
  it('상세 화면을 열고 모달은 닫힌다 — 한 번에 하나만 연다', async () => {
    await withEntries(draft())
    const open = vi.spyOn(useArchiveViewStore(), 'open').mockResolvedValue()
    q('[data-test="archive-row"]')!.click()
    await settle()
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('모달 안에는 상세를 그리지 않는다 — 같은 내용을 두 레이아웃으로 그리던 일을 끝냈다', async () => {
    await withEntries(draft())
    q('[data-test="archive-row"]')!.click()
    await settle()
    expect(q('[data-test="archive-detail"]')).toBeNull()
  })
})

describe('ArchiveModal — 한도 경고 자리', () => {
  it('프리미엄 탭에서는 일반 한도 경고를 꺼내지 않는다', async () => {
    await withEntries(
      ...[1, 2, 3, 4, 5].map((i) => draft({ startedAt: `2026-10-0${i}T00:00:00Z` })),
    )
    document.querySelectorAll<HTMLElement>('[data-test="archive-tab"]')[2].click()
    await settle()
    expect(q('[data-test="archive-limit"]')).toBeNull()
  })
})
