import { describe, expect, it } from 'vitest'
import { asReportV2, itemsInOrder, reportV2ToText } from './reportV2'

const ITEM = {
  id: 'Q1',
  parent: null,
  answer: 1,
  kind: 'main' as const,
  question: '간단히 자기소개를 해주세요.',
  answerSummary: '5년 차 백엔드 개발자',
  feedback: '수치를 들어 말한 점이 좋습니다',
  delivery: null,
  measurements: null,
  profile: null,
}
const SUMMARY = { strengths: [], improvements: [], delivery: null, postingFit: null }
const OK = { version: 2, items: [ITEM], summary: SUMMARY }

describe('asReportV2', () => {
  it('서버가 준 모양 그대로 받는다', () => {
    expect(asReportV2(OK)).toEqual(OK)
  })

  it('답변이 하나도 없어 items가 비어도 리포트다 — 종합만 보여 준다', () => {
    expect(asReportV2({ ...OK, items: [] })?.items).toEqual([])
  })

  it('버전이 2가 아니면 버전 2 리포트가 아니다', () => {
    expect(asReportV2({ ...OK, version: 1 })).toBeNull()
    expect(asReportV2({ ...OK, version: undefined })).toBeNull()
  })

  it('모양이 아니면 null — 화면이 반쪽짜리를 그리지 않게', () => {
    expect(asReportV2(null)).toBeNull()
    expect(asReportV2('{}')).toBeNull()
    expect(asReportV2({ version: 2, items: [], summary: null })).toBeNull()
    expect(asReportV2({ version: 2, items: {}, summary: SUMMARY })).toBeNull()
  })

  it('항목에 필수 글이 빠져 있으면 통째로 거른다', () => {
    expect(asReportV2({ ...OK, items: [{ ...ITEM, question: 123 }] })).toBeNull()
    expect(asReportV2({ ...OK, items: [{ ...ITEM, feedback: undefined }] })).toBeNull()
  })

  it('종합의 강점·개선점이 빠져 있으면 빈 목록으로 채운다', () => {
    const r = asReportV2({ version: 2, items: [ITEM], summary: { delivery: null } })
    expect(r?.summary.strengths).toEqual([])
    expect(r?.summary.improvements).toEqual([])
    expect(r?.summary.postingFit).toBeNull()
  })
})

describe('itemsInOrder', () => {
  const main = (n: number) => ({ ...ITEM, id: `Q${n}`, answer: n, kind: 'main' as const })
  const follow = (p: number, n: number, a: number) => ({
    ...ITEM,
    id: `Q${p}-${n}`,
    parent: `Q${p}`,
    answer: a,
    kind: 'follow' as const,
  })

  it('꼬리질문을 제 부모 바로 뒤에 둔다', () => {
    const got = itemsInOrder([main(1), main(2), follow(1, 1, 3)])
    expect(got.map((i) => i.id)).toEqual(['Q1', 'Q1-1', 'Q2'])
  })

  it('부모가 없는 꼬리질문도 버리지 않고 뒤에 붙인다', () => {
    const got = itemsInOrder([main(1), follow(9, 1, 2)])
    expect(got.map((i) => i.id)).toEqual(['Q1', 'Q9-1'])
  })

  it('같은 부모의 꼬리질문은 답변 순서를 지킨다', () => {
    const got = itemsInOrder([main(1), follow(1, 2, 4), follow(1, 1, 2)])
    expect(got.map((i) => i.id)).toEqual(['Q1', 'Q1-1', 'Q1-2'])
  })
})

describe('reportV2ToText', () => {
  const base = {
    version: 2 as const,
    items: [
      { ...ITEM, feedback: '**수치**를 들어 말했습니다', delivery: '조금 빠릅니다' },
      {
        ...ITEM,
        id: 'Q1-1',
        parent: 'Q1',
        answer: 2,
        kind: 'follow' as const,
        question: '어떤 수치인가요?',
      },
    ],
    summary: {
      strengths: [{ point: '수치로 말한다', refs: ['Q1'] }],
      improvements: [{ point: '주어가 빠진다', refs: [] }],
      delivery: '전반적으로 빠릅니다',
      postingFit: { met: ['Kafka'], gaps: ['K8s'] },
    },
  }

  it('머리글·종합·항목을 차례로 담는다', () => {
    const t = reportV2ToText(base, 'IT', '백엔드 개발자')
    expect(t).toContain('IT')
    expect(t).toContain('백엔드 개발자')
    expect(t).toContain('수치로 말한다')
    expect(t).toContain('주어가 빠진다')
    expect(t).toContain('전반적으로 빠릅니다')
    expect(t).toContain('Kafka')
    expect(t).toContain('K8s')
    expect(t).toContain('Q1.')
    expect(t).toContain('Q1-1.')
    expect(t).toContain('조금 빠릅니다')
  })

  it('별표는 글자로 남기지 않는다 — 붙여 넣는 곳은 굵게를 모른다', () => {
    expect(reportV2ToText(base, 'IT', '백엔드')).not.toContain('**')
  })

  it('종합이 비어 있어도 항목은 나온다', () => {
    const t = reportV2ToText(
      { ...base, summary: { strengths: [], improvements: [], delivery: null, postingFit: null } },
      'IT',
      '백엔드',
    )
    expect(t).toContain('Q1.')
  })
})

describe('답변별 육각형 프로필 (2026-10-30)', () => {
  const axis = (key: string, level: number | null, comment: string | null = '코멘트') => ({
    key,
    label: key,
    level,
    comment: level === null ? null : comment,
  })
  const six = () =>
    ['content', 'speed', 'fluency', 'response', 'confidence', 'clarity'].map((k) => axis(k, 3))

  it('여섯 축을 그대로 읽는다', () => {
    const r = asReportV2(withProfile(six()))
    expect(r!.items[0].profile).toHaveLength(6)
    expect(r!.items[0].profile![0]).toEqual({
      key: 'content',
      label: 'content',
      level: 3,
      comment: '코멘트',
    })
  })

  it('측정이 없는 축은 level·comment가 null이다', () => {
    const axes = six()
    axes[4] = axis('confidence', null)
    const r = asReportV2(withProfile(axes))
    expect(r!.items[0].profile![4]).toMatchObject({ level: null, comment: null })
  })

  it('profile이 없는 옛 리포트는 null — 기존 측정값 표로 간다', () => {
    const r = asReportV2(withProfile(undefined))
    expect(r!.items[0].profile).toBeNull()
  })

  it('여섯 개가 아니면 통째로 버린다 — 반쪽 그래프는 틀린 그래프다', () => {
    expect(asReportV2(withProfile(six().slice(0, 4)))!.items[0].profile).toBeNull()
  })

  it('단계가 1~5를 벗어나면 버린다', () => {
    const axes = six()
    axes[1] = axis('speed', 9)
    expect(asReportV2(withProfile(axes))!.items[0].profile).toBeNull()
  })
})

/** profile만 바꿔 끼운 최소 리포트 */
function withProfile(profile: unknown) {
  return {
    version: 2,
    items: [
      {
        id: 'Q1',
        parent: null,
        answer: 1,
        kind: 'main',
        question: 'q',
        answerSummary: 'a',
        feedback: 'f',
        delivery: null,
        measurements: null,
        ...(profile === undefined ? {} : { profile }),
      },
    ],
    summary: { strengths: [], improvements: [], delivery: null, postingFit: null },
  }
}
