import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ReportRail from './ReportRail.vue'

const items = [
  { id: 'q1', question: '자기소개', ms: 52_000, follow: false },
  { id: 'q2', question: '어려웠던 기술적 도전', ms: 78_000, follow: false },
  { id: 'q2-1', question: '팀 성과인가 본인 성과인가', ms: 95_000, follow: true },
]

const rail = (over: Partial<Record<string, unknown>> = {}) =>
  mount(ReportRail, { props: { items, ...over } })

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

  it('읽음을 세지 않는다 — 목차는 눌러서 옮겨 다니는 자리지 진도를 세는 자리가 아니다', () => {
    const w = rail()
    expect(w.find('[data-test=toc-read]').exists()).toBe(false)
    expect(w.get('[data-test=toc-count]').text()).toContain('3')
  })

  it('지금 보는 문항에 aria-current를 단다', () => {
    const w = rail({ current: 'q2' })
    expect(w.findAll('[data-test=toc-item]')[1].attributes('aria-current')).toBe('true')
  })

  it('머리글과 액션은 슬롯이다 — 보관함 상세가 다른 것을 끼운다', () => {
    const w = mount(ReportRail, {
      props: { items },
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

describe('ReportRail — 목록을 과녁으로 (2026-11-08)', () => {
  it('줄 맨 앞은 눌리지 않는 읽음 네모가 아니라 번호 칩이다 — 본문 카드의 Q1과 짝이 맞는다', () => {
    const w = rail()
    expect(w.get('[data-test=toc-item]').get('[data-test=toc-chip]').text()).toBe('Q1')
  })

  it('과녁을 손가락 크기로 키운다 — 28px 줄은 누르기 어렵다', () => {
    const src = readFileSync(join(__dirname, 'ReportRail.vue'), 'utf8')
    const row = src.match(/\.row \{[^}]*\}/)![0]
    expect(row).toMatch(/min-height:\s*4[4-9]px/)
  })

  it('머리에 문항 수를 적는다 — 리포트와 보관함이 같은 레일을 쓴다', () => {
    expect(rail().get('[data-test=toc-count]').text()).toContain('3')
  })
})

describe('ReportRail — 앞뒤로 오간다 (2026-11-08)', () => {
  const target = (id: string) => {
    const el = document.createElement('div')
    el.id = id
    el.scrollIntoView = vi.fn()
    document.body.appendChild(el)
    return el
  }

  it('다음을 누르면 그다음 문항으로 간다', async () => {
    const el = target('q2')
    const w = rail({ current: 'q1' })
    await w.get('[data-test=toc-next]').trigger('click')
    expect(el.scrollIntoView).toHaveBeenCalled()
    el.remove()
  })

  it('이전을 누르면 앞 문항으로 간다', async () => {
    const el = target('q1')
    const w = rail({ current: 'q2' })
    await w.get('[data-test=toc-prev]').trigger('click')
    expect(el.scrollIntoView).toHaveBeenCalled()
    el.remove()
  })

  it('꼬리줄은 제 카드와 id를 나눠 쓴다 — 같은 자리를 두 번 세지 않는다', async () => {
    // items: q1, q2, q2-1(꼬리) → q2에서 다음은 q2-1이 아니라 없음(끝)
    const el = target('q2-1')
    const w = rail({ current: 'q2' })
    await w.get('[data-test=toc-next]').trigger('click')
    expect(el.scrollIntoView).toHaveBeenCalled()
    el.remove()
  })

  it('첫 문항에서는 이전이 잠긴다', () => {
    const w = rail({ current: 'q1' })
    expect((w.get('[data-test=toc-prev]').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('마지막 문항에서는 다음이 잠긴다', () => {
    const w = rail({ current: 'q2-1' })
    expect((w.get('[data-test=toc-next]').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('아직 아무 데도 없으면 다음은 첫 문항으로 간다', async () => {
    const el = target('q1')
    const w = rail()
    await w.get('[data-test=toc-next]').trigger('click')
    expect(el.scrollIntoView).toHaveBeenCalled()
    el.remove()
  })
})

describe('ReportRail — 목록이 지금 자리를 따라온다 (2026-11-08)', () => {
  /* 16문항이면 목록 안에서 스크롤된다. 본문을 내려 Q12를 보고 있는데 목차는
     Q1~Q8만 보이면, 지금 어디인지 표시해 봐야 화면에 없다 */
  const spies = () => {
    const calls: { i: number; arg: unknown }[] = []
    const w = rail({ current: undefined })
    w.findAll('[data-test=toc-item]').forEach((r, i) => {
      ;(r.element as HTMLElement).scrollIntoView = (arg?: unknown) => calls.push({ i, arg })
    })
    return { w, calls }
  }

  it('지금 줄이 목록 안에서 보이게 따라온다', async () => {
    const { w, calls } = spies()
    await w.setProps({ current: 'q2-1' })
    await flushPromises()
    expect(calls.map((c) => c.i)).toEqual([2])
  })

  it('목록만 움직이고 본문은 건드리지 않는다 — block: nearest라 이미 보이면 가만히 둔다', async () => {
    const { w, calls } = spies()
    await w.setProps({ current: 'q2' })
    await flushPromises()
    expect(calls[0].arg).toEqual({ block: 'nearest' })
  })

  it('아직 아무 데도 없으면 아무 줄도 끌어오지 않는다', async () => {
    const { w, calls } = spies()
    await w.setProps({ current: undefined })
    await flushPromises()
    expect(calls).toHaveLength(0)
  })
})

describe('ReportRail — 총평을 담지 않는다 (2026-11-08)', () => {
  const src = readFileSync(join(__dirname, 'ReportRail.vue'), 'utf8')
  /** 그 선택자 블록의 본문. 묶음 선택자(`.head,
.sum,`)는 `{`가 안 붙어 걸리지 않는다 */
  const block = (sel: string) => src.match(new RegExp('[.]' + sel + ' [{][^}]*[}]'))?.[0] ?? ''

  it('총평은 본문 맨 위에 이미 있다 — 레일에도 두면 같은 글이 두 번 나오고, 길어지면 목차를 밀어낸다', () => {
    expect(rail().find('[data-test=rail-summary]').exists()).toBe(false)
    expect(src).not.toMatch(/sum-body/)
  })

  it('목차는 바닥 아래로 깎이지 않는다 — 줄 몇 개와 앞뒤 버튼은 늘 보여야 한다', () => {
    expect(block('toc')).toMatch(/min-height:\s*\d+px/)
  })
})
