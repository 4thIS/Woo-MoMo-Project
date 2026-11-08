import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ReportRail from './ReportRail.vue'
import type { ReportV2Summary } from '@/utils/reportV2'

const items = [
  { id: 'q1', question: '자기소개', ms: 52_000, follow: false },
  { id: 'q2', question: '어려웠던 기술적 도전', ms: 78_000, follow: false },
  { id: 'q2-1', question: '팀 성과인가 본인 성과인가', ms: 95_000, follow: true },
]
const summary: ReportV2Summary = {
  strengths: [{ point: '수치로 성과를 말함', refs: ['q1', 'q2'] }],
  improvements: [{ point: '본인 기여를 먼저', refs: ['q2-1'] }],
  delivery: '숫자 앞에서 빨라지는 경향',
  postingFit: { met: ['대용량 트래픽'], gaps: ['Kafka'] },
}

const rail = (over: Partial<Record<string, unknown>> = {}) =>
  mount(ReportRail, {
    props: { items, summary, read: new Set<string>(), ...over },
  })

describe('ReportRail', () => {
  it('문항 목차를 진짜 링크로 만든다 — Tab 차례와 뒤로 가기가 거저 따라온다', () => {
    const a = rail().findAll('[data-test=toc-item]')
    expect(a).toHaveLength(3)
    expect(a[0].element.tagName).toBe('A')
    expect(a[0].attributes('href')).toBe('#q1')
  })

  it('꼬리질문은 들여쓴다 — 16개가 평평하게 늘어서지 않게', () => {
    expect(rail().findAll('[data-test=toc-item].follow')).toHaveLength(1)
  })

  it('60초를 넘은 문항은 빨강으로, 개수는 목차 머리에 한 줄로', () => {
    const w = rail()
    expect(w.get('[data-test=toc-over]').text()).toContain('2')
    expect(w.findAll('[data-test=toc-item] .over')).toHaveLength(2)
  })

  it('읽은 문항을 표시하고 몇 개까지 읽었는지 적는다 — 끝이 보이면 덜 지친다', () => {
    const w = rail({ read: new Set(['q1']) })
    expect(w.get('[data-test=toc-read]').text()).toContain('1')
    expect(w.findAll('[data-test=toc-item].read')).toHaveLength(1)
  })

  it('지금 보는 문항에 aria-current를 단다', () => {
    const w = rail({ current: 'q2' })
    expect(w.findAll('[data-test=toc-item]')[1].attributes('aria-current')).toBe('true')
  })

  it('총평이 없으면 그 자리를 비운다 — 무료 리포트에는 총평이 없다', () => {
    expect(rail({ summary: null }).find('[data-test=rail-summary]').exists()).toBe(false)
  })

  it('총평은 강점·개선점·전달력·공고 적합도를 담는다', () => {
    const t = rail().get('[data-test=rail-summary]').text()
    expect(t).toContain('수치로 성과를 말함')
    expect(t).toContain('본인 기여를 먼저')
    expect(t).toContain('숫자 앞에서 빨라지는 경향')
    expect(t).toContain('Kafka')
  })

  it('머리글과 액션은 슬롯이다 — 보관함 상세가 다른 것을 끼운다', () => {
    const w = mount(ReportRail, {
      props: { items, summary: null, read: new Set<string>() },
      slots: {
        head: '<p data-test="x-head">보관함 면접</p>',
        actions: '<b data-test="x-act">지우기</b>',
      },
    })
    expect(w.get('[data-test=x-head]').text()).toBe('보관함 면접')
    expect(w.get('[data-test=x-act]').text()).toBe('지우기')
  })
})

describe('ReportRail — 기둥이 접히지 않는다', () => {
  const src = readFileSync(join(__dirname, 'ReportRail.vue'), 'utf8')

  it('목차의 flex-basis가 0이면 안 된다 — 높이가 auto인 기둥에서 목록이 0으로 접힌다', () => {
    expect(src).not.toMatch(/\.toc \{[^}]*flex:\s*1 1 0/)
  })

  it('버튼은 쌓는다 — 336px에 셋을 나란히 두면 글자가 세로로 쪼개진다', () => {
    expect(src).toMatch(/\.actions \{[^}]*flex-direction:\s*column/)
  })
})

describe('ReportRail — 인쇄', () => {
  const src = readFileSync(join(__dirname, 'ReportRail.vue'), 'utf8')
  const print = src.match(/@media print \{[\s\S]*?\n\}/)?.[0] ?? ''

  it('종이에는 목차도 액션도 없다 — 고정 기둥이 설 자리가 없다', () => {
    expect(print).toMatch(/\.toc/)
    expect(print).toMatch(/\.actions/)
    expect(print).toMatch(/display:\s*none/)
  })
})

describe('ReportRail — 목차는 해시를 쓰지 않는다 (2026-11-08)', () => {
  /* 해시 이동은 popstate를 쏜다(state: null). 보관함 상세는 그것을 듣고 화면을 닫으므로
     목차를 누를 때마다 상세가 통째로 닫혔다 */
  it('눌러도 해시가 바뀌지 않고, 그 문항으로 굴러간다', async () => {
    const w = rail()
    const card = document.createElement('div')
    card.id = 'q1'
    card.scrollIntoView = vi.fn()
    document.body.appendChild(card)
    const before = location.hash

    await w.get('[data-test=toc-item]').trigger('click')

    expect(location.hash).toBe(before)
    expect(card.scrollIntoView).toHaveBeenCalled()
    card.remove()
  })

  it('링크는 여전히 진짜 href다 — Tab 차례와 우클릭이 거저 따라온다', () => {
    expect(rail().get('[data-test=toc-item]').attributes('href')).toBe('#q1')
  })
})
