import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ArchiveDetail from './ArchiveDetail.vue'
import type { ArchiveDetail as Detail } from '@/services/account'

const entry = (over: Partial<Detail> = {}): Detail => ({
  id: 'a1',
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

let w: ReturnType<typeof mount> | null = null
const detail = (over: Partial<Detail> = {}) => {
  w = mount(ArchiveDetail, { props: { entry: entry(over) }, attachTo: document.body })
  return w
}
afterEach(() => {
  w?.unmount()
  w = null
  vi.restoreAllMocks()
})

describe('ArchiveDetail — 녹음 재생바', () => {
  it('녹음이 없으면 그리지 않는다 — 빈 플레이어는 고장처럼 보인다', () => {
    expect(detail().find('[data-test=archive-clip]').exists()).toBe(false)
  })

  it('녹음이 있으면 사이트 재생바로 그린다 — 브라우저 기본 controls를 쓰지 않는다', () => {
    const v = detail({ hasRecording: true, recordings: [{ turn: 0, url: 'blob:x' }] })
    expect(v.find('[data-test=archive-clip]').exists()).toBe(true)
    // 직접 그린 버튼이 있고, 브라우저 기본 재생바는 꺼져 있다
    expect(v.find('[data-test=audio-toggle]').exists()).toBe(true)
    expect(v.get('audio').attributes('controls')).toBeUndefined()
  })
})

describe('ArchiveDetail — PDF 저장', () => {
  it('버튼이 있다', () => {
    expect(detail().find('[data-test=archive-print]').exists()).toBe(true)
  })

  it('누르면 인쇄 대화상자를 연다', async () => {
    const print = vi.fn()
    vi.stubGlobal('print', print)
    await detail().get('[data-test=archive-print]').trigger('click')
    expect(print).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('탭 제목을 파일명으로 잠깐 바꿨다가 되돌린다', async () => {
    const before = document.title
    vi.stubGlobal('print', vi.fn())
    await detail().get('[data-test=archive-print]').trigger('click')
    // 날짜와 면접관 이름이 파일명에 들어간다
    expect(document.title).toContain('2026-10-09')
    expect(document.title).toContain('데이빗')
    window.dispatchEvent(new Event('afterprint'))
    expect(document.title).toBe(before)
    vi.unstubAllGlobals()
  })
})
