import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/llm', () => ({ startSession: vi.fn() }))
vi.mock('@/services/api', () => ({ getQuestions: vi.fn(), getManifest: vi.fn() }))
import { useInterviewStore } from '@/stores/interview'
import ReportView from './ReportView.vue'

beforeEach(() => setActivePinia(createPinia()))

const items = [
  { question: 'Q1', answerSummary: 'A1', feedback: '좋았지만 **근거**가 필요합니다.' },
  { question: 'Q2', answerSummary: 'A2', feedback: 'F2' },
]

describe('ReportView', () => {
  it('생성 중 문구', () => {
    useInterviewStore().$patch({
      phase: 'report',
      reportStatus: 'writing',
      profile: { field: 'it', job: '백엔드' },
    })
    expect(mount(ReportView).text()).toContain('리포트를 쓰는 중')
  })
  it('카드와 강조 span, 질문·꼬리질문 수', () => {
    useInterviewStore().$patch({
      phase: 'report',
      reportStatus: 'done',
      report: items,
      profile: { field: 'it', job: '백엔드' },
      messages: [
        { role: 'model', text: 'q1' },
        { role: 'user', text: 'a' },
        { role: 'model', text: 'q1-1' },
        { role: 'user', text: 'a' },
        { role: 'model', text: 'q2' },
      ],
    })
    const w = mount(ReportView)
    expect(w.findAll('[data-test="card"]')).toHaveLength(2)
    expect(w.find('.strong').text()).toBe('근거')
    expect(w.text()).toContain('질문 2 · 꼬리질문 1')
  })
  it('파싱 실패면 원문 창 하나', () => {
    useInterviewStore().$patch({
      phase: 'report',
      reportStatus: 'done',
      report: null,
      reportRaw: '원문',
      profile: { field: 'it', job: 'j' },
    })
    const w = mount(ReportView)
    expect(w.findAll('[data-test="card"]')).toHaveLength(0)
    expect(w.find('[data-test="raw"]').text()).toContain('원문')
  })
  it('복사 버튼은 텍스트를 클립보드에 쓰고 2초간 복사됨', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    useInterviewStore().$patch({
      phase: 'report',
      reportStatus: 'done',
      report: items,
      profile: { field: 'it', job: '백엔드' },
    })
    const w = mount(ReportView)
    await w.find('[data-test="copy"]').trigger('click')
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Q1. Q1'))
    await Promise.resolve()
    expect(w.find('[data-test="copy"]').text()).toBe('복사됨')
  })
  it('다시 면접 보기는 reset', async () => {
    const s = useInterviewStore()
    s.$patch({
      phase: 'report',
      reportStatus: 'done',
      report: items,
      profile: { field: 'it', job: 'j' },
    })
    const reset = vi.spyOn(s, 'reset').mockResolvedValue()
    await mount(ReportView).find('[data-test="restart"]').trigger('click')
    expect(reset).toHaveBeenCalled()
  })
})

describe('ReportView — PDF 저장', () => {
  it('완료 전엔 비활성, 완료 후 클릭하면 제목을 바꿔 print하고 afterprint에 복원한다', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T10:00:00'))
    const print = vi.fn()
    vi.stubGlobal('print', print)
    document.title = '모두의 모의면접'
    useInterviewStore().$patch({
      phase: 'report',
      reportStatus: 'writing',
      profile: { field: 'it', job: '백엔드 개발자' },
    })
    const w = mount(ReportView)
    expect((w.find('[data-test="print"]').element as HTMLButtonElement).disabled).toBe(true)
    useInterviewStore().$patch({ reportStatus: 'done', report: items })
    await w.vm.$nextTick()
    await w.find('[data-test="print"]').trigger('click')
    expect(document.title).toBe('모의면접 리포트 - 백엔드 개발자 - 2026-09-16')
    expect(print).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('afterprint'))
    expect(document.title).toBe('모두의 모의면접')
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
})
