import { describe, expect, it } from 'vitest'
import { parseReport, reportToText, splitEmphasis } from './reportParser'

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
  it('복사 형식과 별표 제거', () => {
    expect(reportToText([item], 'IT', '백엔드')).toBe(
      '모두의 모의면접 리포트 · IT · 백엔드\n\nQ1. Q\n답변 요약: A\n피드백: 좋았지만 근거가 필요합니다.',
    )
  })
})
