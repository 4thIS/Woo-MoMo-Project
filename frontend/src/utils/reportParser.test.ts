import { describe, expect, it } from 'vitest'
import { clip, parseReport, reportToText, splitEmphasis } from './reportParser'

const item = { question: 'Q', answerSummary: 'A', feedback: '좋았지만 **근거**가 필요합니다.' }

describe('parseReport', () => {
  it('코드 펜스를 벗기고 파싱한다', () => {
    const raw = '```json\n' + JSON.stringify([item]) + '\n```'
    expect(parseReport(raw)).toEqual([item])
  })
  it('앞뒤 잡담이 있어도 배열 구간만 파싱한다', () => {
    expect(parseReport('네, 리포트입니다.\n' + JSON.stringify([item]) + '\n감사합니다.')).toEqual([
      item,
    ])
  })
  it('필드가 빠지면 null', () => {
    expect(parseReport(JSON.stringify([{ question: 'Q' }]))).toBeNull()
  })
  it('배열이 아니면 null', () => expect(parseReport('{"a":1}')).toBeNull())
  it('빈 배열은 null', () => expect(parseReport('[]')).toBeNull())
  it('깨진 JSON은 null', () => expect(parseReport('[{')).toBeNull())
  it('앞뒤 잡담에 대괄호가 있어도 배열을 찾는다', () => {
    const raw = '참고 [1]: 아래와 같습니다.\n' + JSON.stringify([item]) + '\n이상입니다 (출처 [2]).'
    expect(parseReport(raw)).toEqual([item])
  })
  it('문자열 안의 대괄호는 그대로 보존한다', () => {
    const it2 = { ...item, feedback: '[참고] 근거가 필요합니다.' }
    expect(parseReport(JSON.stringify([it2]))).toEqual([it2])
  })
})

describe('splitEmphasis', () => {
  it('별표 구간을 strong으로 나눈다', () => {
    expect(splitEmphasis('a **b** c')).toEqual([
      { text: 'a ', strong: false },
      { text: 'b', strong: true },
      { text: ' c', strong: false },
    ])
  })
  it('별표가 없으면 한 조각', () => {
    expect(splitEmphasis('plain')).toEqual([{ text: 'plain', strong: false }])
  })
})

describe('reportToText', () => {
  it('복사 형식과 별표 제거 — 답변은 요약이 아니라 지원자가 입력한 원문', () => {
    expect(reportToText([item], [['제가 입력한 답']], 'IT', '백엔드')).toBe(
      '모두의 모의면접 리포트 · IT · 백엔드\n\nQ1. Q\n내 답변: 제가 입력한 답\n피드백: 좋았지만 근거가 필요합니다.',
    )
  })
  it('답변이 여럿(꼬리질문)이면 줄로 나열하고, 없으면 (답변 없음)', () => {
    expect(reportToText([item], [['답1', '답1-1']], 'IT', '백엔드')).toContain(
      'Q1. Q\n내 답변:\n- 답1\n- 답1-1\n피드백',
    )
    expect(reportToText([item], [[]], 'IT', '백엔드')).toContain('내 답변: (답변 없음)')
  })
  it('timing이 있으면 끝에 소요 시간 절을 붙인다', () => {
    const longQuestion =
      '어려웠던 문제는 무엇이었나요? 아주 긴 질문 문장이 여기에 계속 이어집니다 정말로'
    const text = reportToText([item], [['a']], 'IT', '백엔드', {
      total: 754_000,
      turns: [
        { question: '자기소개 해주세요', ms: 90_000 },
        { question: longQuestion, ms: 65_000 },
      ],
    })
    expect(text).toContain('\n\n소요 시간: 총 12분 34초\n')
    expect(text).toContain('- 1분 30초 · 자기소개 해주세요')
    expect(text).toContain(`- 1분 5초 · ${longQuestion.slice(0, 40)}…`)
  })
  it('timing이 없으면 기존 형식 그대로', () => {
    expect(reportToText([item], [['a']], 'IT', '백엔드')).not.toContain('소요 시간')
  })
})

describe('clip', () => {
  it('40자는 그대로, 41자부터 잘린다', () => {
    expect(clip('가'.repeat(40))).not.toContain('…')
    const clipped = clip('가'.repeat(41))
    expect(clipped.endsWith('…')).toBe(true)
    expect(clipped.length).toBe(41)
  })
})
