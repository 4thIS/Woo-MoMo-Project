import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ReportV2Cards from './ReportV2Cards.vue'
import type { Measurements, ReportV2, ReportV2Item, Voice } from '@/utils/reportV2'

const item = (p: Partial<ReportV2Item> = {}): ReportV2Item => ({
  id: 'Q1',
  parent: null,
  answer: 1,
  kind: 'main',
  question: '간단히 자기소개를 해주세요.',
  answerSummary: '5년 차 백엔드 개발자',
  feedback: '**수치**를 들어 말한 점이 좋습니다',
  delivery: null,
  measurements: null,
  profile: null,
  ...p,
})

const measurements = (p: Partial<Measurements> = {}): Measurements => ({
  syllablesPerMin: 300,
  speed: '빠름',
  longPauses: 1,
  pausesPerMin: 1,
  pause: '적음',
  longestPauseSec: 2.5,
  firstWordSec: 1.5,
  firstWord: '보통',
  filler: { level: '적음', count: 3, examples: ['음'] },
  voice: null,
  insufficient: false,
  ...p,
})

const report = (p: Partial<ReportV2> = {}): ReportV2 => ({
  version: 2,
  items: [item()],
  summary: { strengths: [], improvements: [], delivery: null, postingFit: null },
  ...p,
})

const mountIt = (r: ReportV2) => mount(ReportV2Cards, { props: { report: r } })

const voice = (p: Partial<Voice> = {}): Voice => ({
  confidence: { level: '보통', reason: '고른 음량' },
  tone: { level: '차분', reason: '일정한 속도' },
  tremor: { present: false, reason: '고른 음높이' },
  trailingOff: { present: false, reason: '끝까지 또렷' },
  clarity: { level: '좋음', reason: '자음이 또렷함' },
  ...p,
})
const withVoice = (v: Partial<Voice> = {}) =>
  report({ items: [item({ measurements: measurements({ voice: voice(v) }) })] })

describe('ReportV2Cards — 측정값 접기 (2026-11-07)', () => {
  it('눈에 띄는 축은 근거까지 펼치고, 보통인 축은 이름만 한 줄로', () => {
    const w = mountIt(
      withVoice({
        tone: { level: '긴장', reason: '첫 문장에서 호흡이 짧음' },
        trailingOff: { present: true, reason: '문장 끝 음량이 떨어짐' },
      }),
    )
    const flags = w.findAll('[data-test=voice-flag]')
    expect(flags).toHaveLength(2)
    expect(w.text()).toContain('첫 문장에서 호흡이 짧음')
    expect(w.text()).toContain('문장 끝 음량이 떨어짐')
    // 나머지 셋은 이름만, 근거는 접힌 채
    expect(w.get('[data-test=voice-plain]').text()).toContain('자신감 보통')
    expect(w.get('[data-test=voice-plain]').text()).toContain('발음 좋음')
  })

  it('접는 것은 보통인 축뿐이다 — "자신감 낮음"만 보이고 근거가 접히면 고칠 수가 없다', () => {
    const w = mountIt(withVoice({ confidence: { level: '낮음', reason: '수치를 말한 뒤 작아짐' } }))
    expect(w.text()).toContain('수치를 말한 뒤 작아짐')
  })

  it('떨림·끝 흐려짐은 "있음"일 때만 눈에 띄는 축이다', () => {
    const off = mountIt(withVoice())
    expect(off.findAll('[data-test=voice-flag]')).toHaveLength(0)
    const on = mountIt(withVoice({ tremor: { present: true, reason: '음높이가 흔들림' } }))
    expect(on.findAll('[data-test=voice-flag]')).toHaveLength(1)
  })

  it('측정 숫자는 카드 바닥 한 줄로 편다 — 프로필 육각형이 있을 때', () => {
    const w = mountIt(
      report({
        items: [
          item({
            measurements: measurements(),
            profile: [{ key: 'content', label: '답변 내용', level: 4, comment: '좋아요' }],
          }),
        ],
      }),
    )
    const line = w.get('[data-test=measure-line]').text()
    expect(line).toContain('300')
    expect(line).toContain('적음')
  })

  it('예전에 저장된 리포트(프로필 없음)는 지금처럼 측정값 표를 그린다', () => {
    const w = mountIt(report({ items: [item({ profile: null, measurements: measurements() })] }))
    expect(w.find('[data-test=measure-rows]').exists()).toBe(true)
  })
})

describe('ReportV2Cards — 종합', () => {
  it('강점·개선점을 근거 항목과 함께 보여 준다', () => {
    const w = mountIt(
      report({
        summary: {
          strengths: [{ point: '수치로 말한다', refs: ['Q1', 'Q1-1'] }],
          improvements: [{ point: '주어가 빠진다', refs: ['Q2'] }],
          delivery: null,
          postingFit: null,
        },
      }),
    )
    const s = w.find('[data-test=summary]')
    expect(s.text()).toContain('수치로 말한다')
    expect(s.text()).toContain('주어가 빠진다')
    // 근거는 그 항목으로 가는 링크다
    expect(s.find('a[href="#item-Q1-1"]').exists()).toBe(true)
  })

  it('근거가 없는 강점은 링크 없이 글만 보여 준다', () => {
    const w = mountIt(
      report({
        summary: {
          strengths: [{ point: '차분하다', refs: [] }],
          improvements: [],
          delivery: null,
          postingFit: null,
        },
      }),
    )
    expect(w.find('[data-test=summary]').text()).toContain('차분하다')
  })

  it('전달력 종합은 있을 때만 나온다', () => {
    expect(mountIt(report()).find('[data-test=summary-delivery]').exists()).toBe(false)
    const w = mountIt(
      report({
        summary: {
          strengths: [],
          improvements: [],
          delivery: '전반적으로 빠릅니다',
          postingFit: null,
        },
      }),
    )
    expect(w.find('[data-test=summary-delivery]').text()).toContain('전반적으로 빠릅니다')
  })

  it('공고 적합도는 공고를 넣은 면접에만 나온다', () => {
    expect(mountIt(report()).find('[data-test=posting-fit]').exists()).toBe(false)
    const w = mountIt(
      report({
        summary: {
          strengths: [],
          improvements: [],
          delivery: null,
          postingFit: { met: ['Kafka 경험'], gaps: ['Kubernetes'] },
        },
      }),
    )
    const t = w.find('[data-test=posting-fit]').text()
    expect(t).toContain('Kafka 경험')
    expect(t).toContain('Kubernetes')
  })

  it('종합에 아무것도 없으면 그 칸을 띄우지 않는다', () => {
    expect(mountIt(report()).find('[data-test=summary]').exists()).toBe(false)
  })
})

describe('ReportV2Cards — 항목', () => {
  it('질문·답변 요약·피드백을 보여 주고 강조를 굵게 그린다', () => {
    const w = mountIt(report())
    const card = w.find('[data-test=v2-card]')
    expect(card.text()).toContain('간단히 자기소개를 해주세요.')
    expect(card.text()).toContain('5년 차 백엔드 개발자')
    expect(card.find('.strong').text()).toBe('수치')
    // 별표는 글자로 남지 않는다
    expect(card.text()).not.toContain('**')
  })

  it('꼬리질문은 부모 바로 뒤에 들여써서 놓는다', () => {
    const w = mountIt(
      report({
        items: [
          item({ id: 'Q1', answer: 1 }),
          item({ id: 'Q2', answer: 3 }),
          item({ id: 'Q1-1', parent: 'Q1', answer: 2, kind: 'follow' }),
        ],
      }),
    )
    const cards = w.findAll('[data-test=v2-card]')
    expect(cards.map((c) => c.attributes('id'))).toEqual(['item-Q1', 'item-Q1-1', 'item-Q2'])
    expect(cards[1].classes()).toContain('follow')
  })

  it('전달력 문장은 있을 때만 나온다', () => {
    expect(mountIt(report()).find('[data-test=v2-delivery]').exists()).toBe(false)
    const w = mountIt(report({ items: [item({ delivery: '조금 빠릅니다' })] }))
    expect(w.find('[data-test=v2-delivery]').text()).toContain('조금 빠릅니다')
  })
})

describe('ReportV2Cards — 측정값', () => {
  it('측정이 없으면 표를 띄우지 않는다', () => {
    expect(mountIt(report()).find('[data-test=measure]').exists()).toBe(false)
  })

  it('숫자와 판정을 함께 보여 준다', () => {
    const w = mountIt(report({ items: [item({ measurements: measurements() })] }))
    const t = w.find('[data-test=measure]').text()
    expect(t).toContain('300')
    expect(t).toContain('빠름')
    expect(t).toContain('2.5')
    expect(t).toContain('1.5')
    expect(t).toContain('음') // 군말 예시
  })

  it('측정이 모자라면 그렇게 말한다 — 빈 칸을 늘어놓지 않는다', () => {
    const w = mountIt(
      report({
        items: [
          item({
            measurements: measurements({
              insufficient: true,
              syllablesPerMin: null,
              speed: null,
              longPauses: null,
              pausesPerMin: null,
              pause: null,
              longestPauseSec: null,
              firstWordSec: null,
              firstWord: null,
              filler: null,
            }),
          }),
        ],
      }),
    )
    expect(w.find('[data-test=measure]').text()).toContain('측정 부족')
    expect(w.find('[data-test=measure-rows]').exists()).toBe(false)
  })

  it('군말을 센 적이 없으면 횟수를 지어내지 않는다', () => {
    const w = mountIt(
      report({
        items: [
          item({
            measurements: measurements({ filler: { level: '보통', count: null, examples: [] } }),
          }),
        ],
      }),
    )
    const t = w.find('[data-test=measure]').text()
    expect(t).toContain('보통')
    expect(t).not.toContain('null')
  })

  it('목소리 결과가 있으면 근거와 함께 보여 준다', () => {
    const w = mountIt(
      report({
        items: [
          item({
            measurements: measurements({
              voice: {
                confidence: { level: '높음', reason: '어미가 분명합니다' },
                tone: { level: '차분', reason: '기복이 적습니다' },
                tremor: { present: false, reason: '떨림 없음' },
                trailingOff: { present: true, reason: '문장 끝이 흐려집니다' },
                clarity: { level: '또렷', reason: '자음이 분명합니다' },
              },
            }),
          }),
        ],
      }),
    )
    // 높음·또렷·있음은 모두 눈에 띄는 축이라 근거까지 펼쳐진다 (2026-11-07)
    const t = w.text()
    expect(t).toContain('어미가 분명합니다')
    expect(t).toContain('문장 끝이 흐려집니다')
    // 차분·없음은 정상 범위라 이름만 한 줄로
    expect(w.get('[data-test=voice-plain]').text()).toContain('어조 차분')
    expect(t).not.toContain('기복이 적습니다')
  })

  it('목소리 결과가 없으면 그 줄을 비운다', () => {
    const w = mountIt(report({ items: [item({ measurements: measurements() })] }))
    expect(w.find('[data-test=voice]').exists()).toBe(false)
  })
})

describe('ReportV2Cards — 답변별 프로필', () => {
  const axes = (levels: (number | null)[]) =>
    ['content', 'speed', 'fluency', 'response', 'confidence', 'clarity'].map((key, i) => ({
      key,
      label: key,
      level: levels[i],
      comment: levels[i] === null ? null : '설명',
    }))

  it('profile이 있으면 답변마다 육각형을 그린다', () => {
    const w = mountIt(report({ items: [item({ profile: axes([4, 3, 3, 3, null, null]) })] }))
    expect(w.find('[data-test=v2-profile]').exists()).toBe(true)
    expect(w.find('[data-test=profile-hex]').exists()).toBe(true)
  })

  it('profile이 없는 옛 기록은 그리지 않는다 — 측정값 표가 그대로 남는다', () => {
    const w = mountIt(report({ items: [item({ profile: null })] }))
    expect(w.find('[data-test=v2-profile]').exists()).toBe(false)
  })
})
