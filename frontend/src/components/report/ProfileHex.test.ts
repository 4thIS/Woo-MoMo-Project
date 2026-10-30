import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ProfileHex from './ProfileHex.vue'
import type { ProfileAxis } from '@/utils/reportV2'

const KEYS = ['content', 'speed', 'fluency', 'response', 'confidence', 'clarity'] as const
const LABELS = ['답변 내용', '말 속도', '쉼·유창성', '순발력', '자신감', '발음·명료도']

const axes = (levels: (number | null)[]): ProfileAxis[] =>
  KEYS.map((key, i) => ({
    key,
    label: LABELS[i],
    level: levels[i],
    comment: levels[i] === null ? null : `${LABELS[i]} 설명`,
  }))

const hex = (levels: (number | null)[]) => mount(ProfileHex, { props: { profile: axes(levels) } })

describe('ProfileHex — 육각형 그래프', () => {
  it('라이브러리 없이 SVG로 그린다', () => {
    expect(hex([3, 3, 3, 3, 3, 3]).find('svg').exists()).toBe(true)
  })

  it('꼭짓점은 배열 순서 그대로 여섯 개다', () => {
    const w = hex([1, 2, 3, 4, 5, 3])
    expect(w.findAll('[data-test=hex-axis-label]').map((e) => e.text())).toEqual(LABELS)
  })

  it('눈금은 1~5 다섯 겹이다', () => {
    expect(hex([3, 3, 3, 3, 3, 3]).findAll('[data-test=hex-ring]')).toHaveLength(5)
  })

  it('값 다각형의 꼭짓점도 여섯 개다', () => {
    const pts = hex([1, 2, 3, 4, 5, 3]).get('[data-test=hex-shape]').attributes('points') ?? ''
    expect(pts.trim().split(/\s+/)).toHaveLength(6)
  })

  it('측정이 없는 축은 중심에 두고 이름을 흐리게 — 0점이 아니라 모르는 것이다', () => {
    const w = hex([4, 3, 3, 3, null, null])
    const dim = w.findAll('[data-test=hex-axis-label]').filter((e) => e.classes().includes('none'))
    expect(dim.map((e) => e.text())).toEqual(['자신감', '발음·명료도'])
  })

  it('읽어 줄 설명이 붙는다 — 그림만으로는 읽을 수 없다', () => {
    const w = hex([4, 3, 2, 1, null, 5])
    const label = w.get('svg').attributes('aria-label') ?? ''
    expect(label).toContain('답변 내용')
    expect(label).toContain('측정 없음')
  })
})

describe('ProfileHex — 축 목록', () => {
  it('단계를 말로 바꿔 보여 준다', () => {
    const rows = hex([1, 2, 3, 4, 5, null]).findAll('[data-test=hex-row]')
    const said = rows.map((r) => r.text())
    expect(said[0]).toContain('아쉬워요')
    expect(said[1]).toContain('조금 부족해요')
    expect(said[2]).toContain('보통이에요')
    expect(said[3]).toContain('좋아요')
    expect(said[4]).toContain('아주 좋아요')
    expect(said[5]).toContain('측정 없음')
  })

  it('코멘트를 함께 보여 주고, 측정 없는 축에는 없다', () => {
    const rows = hex([4, 3, 3, 3, null, 3]).findAll('[data-test=hex-row]')
    expect(rows[0].text()).toContain('답변 내용 설명')
    expect(rows[4].text()).not.toContain('설명')
  })
})
