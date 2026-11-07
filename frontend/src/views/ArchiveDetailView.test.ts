import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/llm', () => ({ startSession: vi.fn() }))
vi.mock('@/services/api', () => ({ getQuestions: vi.fn(), getManifest: vi.fn() }))
import ArchiveDetailView from './ArchiveDetailView.vue'
import type { ArchiveDetail } from '@/services/account'

const entry = {
  id: 'a1',
  interviewerId: 'm1',
  track: 'company',
  field: 'it',
  job: '백엔드 개발자',
  university: null,
  department: null,
  startedAt: '2026-11-01T10:00:00Z',
  endedAt: '2026-11-01T10:12:34Z',
  questionCount: 2,
  premium: false,
  hasRecording: false,
  report: [
    { question: '자기소개', answerSummary: '요약', feedback: '좋습니다' },
    { question: '어려웠던 점', answerSummary: '요약', feedback: '구체적으로' },
  ],
  messages: [
    { role: 'model', text: '자기소개' },
    { role: 'user', text: '안녕하세요 백엔드 개발자입니다' },
    { role: 'model', text: '어려웠던 점' },
    { role: 'user', text: '일정이요' },
  ],
  recordings: [],
  reportV2: null,
} as unknown as ArchiveDetail

beforeEach(() => setActivePinia(createPinia()))
const view = (over: Partial<ArchiveDetail> = {}) =>
  mount(ArchiveDetailView, { props: { entry: { ...entry, ...over } as ArchiveDetail } })

describe('ArchiveDetailView — 레일을 그대로 쓴다 (2026-11-07)', () => {
  it('리포트 화면과 같은 레일을 쓴다 — 두 벌을 만들면 둘이 어긋난다', () => {
    expect(view().find('[data-test=report-rail]').exists()).toBe(true)
  })

  it('목차가 문항 수만큼 선다', () => {
    expect(view().findAll('[data-test=toc-item]')).toHaveLength(2)
  })

  it('레일 머리에 지원 직무와 면접관, 돌아가는 길이 있다', () => {
    const w = view()
    const t = w.get('[data-test=report-rail]').text()
    expect(t).toContain('백엔드 개발자')
    expect(w.find('[data-test=archive-back]').exists()).toBe(true)
  })

  it('기본은 리포트 탭이다', () => {
    const w = view()
    expect(w.findAll('[data-test=card]')).toHaveLength(2)
    expect(w.find('[data-test=transcript]').exists()).toBe(false)
  })

  it('대화 전문 탭으로 바꾸면 대화가 나오고 카드는 사라진다', async () => {
    const w = view()
    await w.get('[data-test=tab-transcript]').trigger('click')
    expect(w.get('[data-test=transcript]').text()).toContain('안녕하세요 백엔드 개발자입니다')
    expect(w.findAll('[data-test=card]')).toHaveLength(0)
  })

  it('대화 전문에서도 같은 목차 앵커가 선다 — 탭을 바꿔도 목차가 죽지 않는다', async () => {
    const w = view()
    await w.get('[data-test=tab-transcript]').trigger('click')
    const href = w.get('[data-test=toc-item]').attributes('href')!
    expect(w.find(href).exists()).toBe(true)
  })

  it('버전 2로 남은 기록은 버전 2 카드로 그린다', () => {
    const w = view({
      reportV2: {
        version: 2,
        items: [
          {
            id: 'Q1',
            parent: null,
            answer: 1,
            kind: 'main',
            question: '버전 2 질문',
            answerSummary: '요약',
            feedback: '피드백',
            delivery: null,
            measurements: null,
            profile: null,
          },
        ],
        summary: { strengths: [], improvements: [], delivery: null, postingFit: null },
      },
    } as unknown as Partial<ArchiveDetail>)
    expect(w.findAll('[data-test=v2-card]')).toHaveLength(1)
    expect(w.findAll('[data-test=card]')).toHaveLength(0)
    expect(w.text()).toContain('버전 2 질문')
  })

  it('예전 기록에는 reportV2가 없다 — 그래도 기존 카드로 열린다', () => {
    const w = view()
    expect(w.findAll('[data-test=v2-card]')).toHaveLength(0)
    expect(w.findAll('[data-test=card]')).toHaveLength(2)
  })

  it('리포트가 남지 않은 기록도 열린다 — 빈 화면 대신 그렇다고 말한다', () => {
    expect(view({ report: [] }).text()).toContain('리포트가 남지 않았습니다')
  })

  it('돌아가기를 누르면 back을 올린다', async () => {
    const w = view()
    await w.get('[data-test=archive-back]').trigger('click')
    expect(w.emitted('back')).toBeTruthy()
  })

  it('지우기는 한 번 더 묻는다 — 되돌릴 수 없다', async () => {
    const w = view()
    await w.get('[data-test=archive-delete]').trigger('click')
    expect(w.find('[data-test=archive-delete-ask]').exists()).toBe(true)
    expect(w.emitted('remove')).toBeFalsy()
    await w.get('[data-test=archive-delete-confirm]').trigger('click')
    expect(w.emitted('remove')).toBeTruthy()
  })

  it('묻는 자리에서 취소하면 그대로 둔다', async () => {
    const w = view()
    await w.get('[data-test=archive-delete]').trigger('click')
    await w.get('[data-test=archive-delete-cancel]').trigger('click')
    expect(w.find('[data-test=archive-delete-ask]').exists()).toBe(false)
    expect(w.emitted('remove')).toBeFalsy()
  })

  it('탭에 .press를 붙이지 않는다 — hover에서만 그림자가 튀어나와 옆을 덮는다', () => {
    expect(view().get('[data-test=tab-report]').classes()).not.toContain('press')
  })
})
