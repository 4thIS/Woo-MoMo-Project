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
  it('총 소요 시간 태그와 질문별 시간 표, 복사 텍스트에도 포함', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    const t0 = 1_000_000
    useInterviewStore().$patch({
      phase: 'report',
      reportStatus: 'done',
      report: items,
      profile: { field: 'it', job: '백엔드' },
      startedAt: t0,
      endedAt: t0 + 754_000,
      messages: [
        { role: 'model', text: '자기소개 해주세요', at: t0 + 10_000 },
        { role: 'user', text: 'a', at: t0 + 100_000 },
        { role: 'model', text: '어려웠던 문제는?', at: t0 + 110_000 },
        { role: 'user', text: 'b', at: t0 + 175_000 },
      ],
    })
    const w = mount(ReportView)
    expect(w.text()).toContain('총 12분 34초')
    const rows = w.findAll('[data-test="turn-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('1분 30초')
    expect(rows[0].text()).toContain('자기소개 해주세요')
    expect(w.text()).not.toMatch(/질문\s*\d\s*\/|남은/)
    await w.find('[data-test="copy"]').trigger('click')
    expect(writeText.mock.calls[0][0]).toContain('소요 시간: 총 12분 34초')
  })
  it('시각이 없으면(옛 세션) 시간 표를 그리지 않는다', () => {
    useInterviewStore().$patch({
      phase: 'report',
      reportStatus: 'done',
      report: items,
      profile: { field: 'it', job: '백엔드' },
      messages: [{ role: 'model', text: 'q' }],
    })
    const w = mount(ReportView)
    expect(w.find('[data-test="timing"]').exists()).toBe(false)
  })
  it('자연 종료면 마지막 인사 턴은 시간 표에 0초 행으로 남지 않는다', () => {
    const t0 = 1_000_000
    useInterviewStore().$patch({
      phase: 'report',
      reportStatus: 'done',
      report: items,
      profile: { field: 'it', job: '백엔드' },
      startedAt: t0,
      endedAt: t0 + 200_000,
      ended: true,
      messages: [
        { role: 'model', text: '자기소개 해주세요', at: t0 + 10_000 },
        { role: 'user', text: 'a', at: t0 + 100_000 },
        { role: 'model', text: '수고하셨습니다. 면접을 마치겠습니다.', at: t0 + 200_000 },
      ],
    })
    const w = mount(ReportView)
    const rows = w.findAll('[data-test="turn-row"]')
    expect(rows).toHaveLength(1)
    // 부분 문자열 '0초'는 "1분 30초"처럼 정상 시간에도 나타나므로 표시된 시간 값 자체로 비교한다.
    expect(rows[0].find('.dur').text()).not.toBe('0초')
  })
  it('면접 종료 버튼으로 중간에 끝냈으면(ended=false) 답 없는 마지막 질문은 endedAt까지 센다', () => {
    const t0 = 1_000_000
    useInterviewStore().$patch({
      phase: 'report',
      reportStatus: 'done',
      report: items,
      profile: { field: 'it', job: '백엔드' },
      startedAt: t0,
      endedAt: t0 + 65_000,
      ended: false,
      messages: [{ role: 'model', text: '자기소개 해주세요', at: t0 + 5_000 }],
    })
    const w = mount(ReportView)
    const rows = w.findAll('[data-test="turn-row"]')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('1분 0초')
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

describe('ReportView — 60초 제한 표시', () => {
  const t0 = 1_000_000
  const base = {
    phase: 'report' as const,
    reportStatus: 'done' as const,
    profile: { field: 'it' as const, job: '백엔드' },
    startedAt: t0,
    endedAt: t0 + 300_000,
    ended: true,
  }
  it('턴 수 = 카드 수면 카드마다 답변 시간 태그, 초과는 danger + 초과분', () => {
    useInterviewStore().$patch({
      ...base,
      report: items, // 2장
      messages: [
        { role: 'model', text: 'q1', at: t0 + 10_000 },
        { role: 'user', text: 'a', at: t0 + 100_000 }, // 90초 → 30초 초과
        { role: 'model', text: 'q2', at: t0 + 110_000 },
        { role: 'user', text: 'b', at: t0 + 152_000 }, // 42초
        { role: 'model', text: '면접을 마치겠습니다.', at: t0 + 300_000 },
      ],
    })
    const w = mount(ReportView)
    const tags = w.findAll('[data-test="answer-tag"]')
    expect(tags).toHaveLength(2)
    expect(tags[0].text()).toBe('답변 1분 30초 · 30초 초과')
    expect(tags[0].classes()).toContain('danger')
    expect(tags[1].text()).toBe('답변 42초')
    expect(tags[1].classes()).toContain('ok')
    // 시간 창: 초과 행은 붉게, 헤더 태그
    expect(w.find('[data-test="timing"]').text()).toContain('제한 60초 · 초과 1문항')
    const rows = w.findAll('[data-test="turn-row"]')
    expect(rows[0].find('.dur').classes()).toContain('over')
    expect(rows[1].find('.dur').classes()).not.toContain('over')
  })
  it('꼬리질문으로 턴 수 ≠ 카드 수면 카드 태그는 없고 시간 창만 초과를 표시한다', () => {
    useInterviewStore().$patch({
      ...base,
      report: items, // 2장
      messages: [
        { role: 'model', text: 'q1', at: t0 + 10_000 },
        { role: 'user', text: 'a', at: t0 + 100_000 },
        { role: 'model', text: 'q1-1', at: t0 + 110_000 },
        { role: 'user', text: 'a2', at: t0 + 130_000 },
        { role: 'model', text: 'q2', at: t0 + 140_000 },
        { role: 'user', text: 'b', at: t0 + 182_000 },
        { role: 'model', text: '면접을 마치겠습니다.', at: t0 + 300_000 },
      ],
    })
    const w = mount(ReportView)
    expect(w.findAll('[data-test="answer-tag"]')).toHaveLength(0)
    expect(w.find('[data-test="timing"]').text()).toContain('제한 60초 · 초과 1문항')
  })
  it('복사 텍스트의 시간 줄 끝에 초과분이 붙는다', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    useInterviewStore().$patch({
      ...base,
      report: items,
      messages: [
        { role: 'model', text: 'q1', at: t0 + 10_000 },
        { role: 'user', text: 'a', at: t0 + 100_000 },
        { role: 'model', text: '면접을 마치겠습니다.', at: t0 + 300_000 },
      ],
    })
    const w = mount(ReportView)
    await w.find('[data-test="copy"]').trigger('click')
    expect(writeText.mock.calls[0][0]).toContain('- 1분 30초 · q1 (30초 초과)')
  })
})
