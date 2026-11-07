import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ReportCards from './ReportCards.vue'

const src = readFileSync(join(__dirname, 'ReportCards.vue'), 'utf8')

const report = [
  { question: '지원 동기는?', answerSummary: '동아리 경험', feedback: '구체적입니다' },
  { question: '어려웠던 점은?', answerSummary: '일정 지연', feedback: '본인 역할이 흐립니다' },
]
const answers = [['동아리에서 웹을 만들었습니다'], []]
const w = () => mount(ReportCards, { props: { report, answers } })

describe('ReportCards — 카드 속 (2026-11-07)', () => {
  it('질문이 제목 줄이 되고 시간이 그 줄 오른쪽에 붙는다 — "시간" 창이 사라지는 자리다', () => {
    const c = mount(ReportCards, { props: { report, answers, durations: [52_000, null] } })
    const head = c.get('[data-test=card-head]')
    expect(head.text()).toContain('Q1')
    expect(head.text()).toContain('지원 동기는?')
    expect(head.get('[data-test=card-time]').text()).toBe('52초')
  })

  it('시간을 안 넘기면 그 줄을 그리지 않는다 — 보관함은 아직 넘기지 않는다', () => {
    expect(w().find('[data-test=card-time]').exists()).toBe(false)
  })

  it('라벨을 본문 위로 올려 본문이 폭을 다 쓴다', () => {
    expect(src).toMatch(/line-height:\s*var\(--lh-read\)/)
    expect(src).toMatch(/max-width:\s*var\(--read-w\)/)
    expect(src).toMatch(/font-family:\s*var\(--font-read\)/)
  })

  it('강조는 카드마다 하나다 — 넷이 칠해지면 아무것도 강조되지 않는다', () => {
    const c = mount(ReportCards, {
      props: {
        report: [{ question: 'q', answerSummary: '요약', feedback: '**하나** 그리고 **둘**' }],
        answers: [[]],
      },
    })
    expect(c.findAll('.strong')).toHaveLength(1)
  })
})

describe('ReportCards', () => {
  it('문항 수만큼 카드를 그린다', () => {
    expect(w().findAll('[data-test=card]')).toHaveLength(2)
  })

  it('질문에 번호를 붙인다', () => {
    expect(w().get('[data-test=card]').text()).toContain('Q1')
  })

  it('내 답변과 피드백을 보여 준다', () => {
    const t = w().get('[data-test=card]').text()
    expect(t).toContain('동아리에서 웹을 만들었습니다')
    expect(t).toContain('구체적입니다')
  })

  it('답변이 없으면 없다고 적는다 — 빈칸이면 버그처럼 보인다', () => {
    expect(w().findAll('[data-test=card]')[1].text()).toContain('답변 없음')
  })

  it('답변 목록이 짧아도 던지지 않는다', () => {
    const short = mount(ReportCards, { props: { report, answers: [] } })
    expect(short.findAll('[data-test=card]')).toHaveLength(2)
  })
})

describe('ReportCards — 전달력 (#99)', () => {
  const withDelivery = [
    {
      question: '지원 동기는?',
      answerSummary: '동아리 경험',
      feedback: '구체적입니다',
      delivery: '분당 352음절로 빠른 편입니다. 핵심 뒤에 한 박자 쉬어 보세요.',
    },
    { question: '어려웠던 점은?', answerSummary: '일정 지연', feedback: '본인 역할이 흐립니다' },
  ]
  const m = () => mount(ReportCards, { props: { report: withDelivery, answers } })

  it('벤이 쓴 전달력 문장을 카드 안에 보여 준다', () => {
    const card = m().findAll('[data-test=card]')[0]
    expect(card.get('[data-test=delivery]').text()).toContain('분당 352음절')
  })

  it('전달력이 없는 문항에는 칸을 만들지 않는다 — 로컬 면접관 리포트는 그대로다', () => {
    expect(m().findAll('[data-test=card]')[1].find('[data-test=delivery]').exists()).toBe(false)
    expect(w().find('[data-test=delivery]').exists()).toBe(false)
  })
})
