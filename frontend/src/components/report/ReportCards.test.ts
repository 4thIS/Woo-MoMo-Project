import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ReportCards from './ReportCards.vue'

const report = [
  { question: '지원 동기는?', answerSummary: '동아리 경험', feedback: '구체적입니다' },
  { question: '어려웠던 점은?', answerSummary: '일정 지연', feedback: '본인 역할이 흐립니다' },
]
const answers = [['동아리에서 웹을 만들었습니다'], []]
const w = () => mount(ReportCards, { props: { report, answers } })

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
