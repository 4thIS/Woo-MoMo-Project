import { describe, expect, it } from 'vitest'
import { answersForReport, similarity } from './reportAnswers'

const m = (role: 'user' | 'model', text: string) => ({ role, text })

describe('similarity', () => {
  it('같은 문장은 1, 전혀 다른 문장은 0에 가깝다', () => {
    expect(similarity('자기소개를 부탁드립니다.', '자기소개를 부탁드립니다.')).toBe(1)
    expect(similarity('자기소개를 부탁드립니다.', '연봉은 얼마를 원하시나요?')).toBeLessThan(0.2)
  })
  it('공백·문장부호 차이는 무시한다', () => {
    expect(similarity('자기 소개를 부탁드립니다', '자기소개를 부탁드립니다.')).toBeGreaterThan(0.8)
  })
})

describe('answersForReport', () => {
  it('카드 수 = 질문 수면 카드마다 지원자가 입력한 답변 원문 하나', () => {
    const messages = [
      m('model', '자기소개를 부탁드립니다.'),
      m('user', '저는 3년차 백엔드 개발자입니다.'),
      m('model', '장애 대응 경험을 말씀해 주세요.'),
      m('user', '결제 지연 장애를 30분 만에 복구했습니다.'),
      m('model', '수고하셨습니다. 면접을 마치겠습니다.'),
    ]
    const report = [{ question: '자기소개를 부탁드립니다.' }, { question: '장애 대응 경험' }]
    expect(answersForReport(report, messages)).toEqual([
      ['저는 3년차 백엔드 개발자입니다.'],
      ['결제 지연 장애를 30분 만에 복구했습니다.'],
    ])
  })

  it('꼬리질문 답변은 원래 질문 카드에 순서대로 함께 붙는다 (리포트가 꼬리질문을 합칠 때)', () => {
    const messages = [
      m('model', '자기소개를 부탁드립니다.'),
      m('user', '답1'),
      m('model', '그 프로젝트에서 맡은 역할은 무엇이었나요?'),
      m('user', '답1-1'),
      m('model', '장애 대응 경험을 말씀해 주세요.'),
      m('user', '답2'),
      m('model', '수고하셨습니다. 면접을 마치겠습니다.'),
    ]
    const report = [
      { question: '자기소개를 부탁드립니다' },
      { question: '장애 대응 경험을 말씀해 주세요' },
    ]
    expect(answersForReport(report, messages)).toEqual([['답1', '답1-1'], ['답2']])
  })

  it('리포트가 질문을 다르게 옮겨 적어 매칭이 안 되면 순서대로 짝짓는다', () => {
    const messages = [
      m('model', '자기소개를 부탁드립니다.'),
      m('user', '답1'),
      m('model', '장애 대응 경험을 말씀해 주세요.'),
      m('user', '답2'),
    ]
    const report = [{ question: '지원자 소개' }, { question: '문제 해결 사례' }]
    expect(answersForReport(report, messages)).toEqual([['답1'], ['답2']])
  })

  it('답이 없는 질문(중간 종료)은 빈 배열', () => {
    const messages = [
      m('model', '자기소개를 부탁드립니다.'),
      m('user', '답1'),
      m('model', '다음 질문'),
    ]
    const report = [{ question: '자기소개를 부탁드립니다.' }, { question: '다음 질문' }]
    expect(answersForReport(report, messages)).toEqual([['답1'], []])
  })

  it('카드가 질문보다 많으면 남는 카드는 빈 배열', () => {
    const messages = [m('model', 'q1'), m('user', 'a1')]
    const report = [{ question: 'q1' }, { question: 'q2' }]
    expect(answersForReport(report, messages)).toEqual([['a1'], []])
  })
})
