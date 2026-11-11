import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TopBar from './TopBar.vue'
import { useAccountStore, setAccountApi } from '@/stores/account'
import { useInterviewStore } from '@/stores/interview'
import { useArchiveViewStore } from '@/stores/archiveView'
import { makeMockAccount } from '@/services/accountMock'

const bar = () => mount(TopBar, { attachTo: document.body })

/** 그림문자 한 자라도 있으면 기종마다 모양이 달라진다 — 픽셀 UI에서는 쓰지 않는다 */
const EMOJI = /\p{Extended_Pictographic}/u

/** onMounted의 load()는 0ms 타이머를 거친다 — flushPromises만으로는 안 끝난다 */
const settle = async () => {
  await new Promise((r) => setTimeout(r, 0))
  await flushPromises()
}

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  setActivePinia(createPinia())
  setAccountApi(makeMockAccount({ delayMs: 0 }))
})

describe('TopBar — 등급별로 보이는 것', () => {
  it('비로그인은 로그인 버튼만 있다', async () => {
    const w = bar()
    await flushPromises()
    expect(w.find('[data-test=top-login]').exists()).toBe(true)
    for (const k of ['top-me', 'top-archive', 'top-premium'])
      expect(w.find(`[data-test=${k}]`).exists()).toBe(false)
  })

  it('로그인하면 프리미엄·보관함·내정보가 나온다', async () => {
    const w = bar()
    await useAccountStore().signUp('a@b.com', 'pw123456', '이우진')
    await flushPromises()
    expect(w.find('[data-test=top-login]').exists()).toBe(false)
    for (const k of ['top-premium', 'top-archive', 'top-me'])
      expect(w.find(`[data-test=${k}]`).exists()).toBe(true)
  })

  it('프리미엄이면 램프에 불이 들어온다', async () => {
    const w = bar()
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456', '이우진')
    await a.purchasePremium()
    await flushPromises()
    expect(w.get('[data-test=top-premium]').classes()).toContain('lit')
  })

  it('프리미엄이 아니면 램프가 꺼져 있다', async () => {
    const w = bar()
    await useAccountStore().signUp('a@b.com', 'pw123456', '이우진')
    await flushPromises()
    expect(w.get('[data-test=top-premium]').classes()).not.toContain('lit')
  })

  it('프리미엄은 보관함 왼쪽에 놓인다', async () => {
    const w = bar()
    await useAccountStore().signUp('a@b.com', 'pw123456', '이우진')
    await flushPromises()
    // 오른쪽 묶음의 순서를 본다 — 왼쪽 이름(top-brand)은 이제 늘 있어 섞이면 안 된다
    const keys = [...w.element.querySelectorAll('.side [data-test^=top-]')].map(
      (e) => (e as HTMLElement).dataset.test,
    )
    expect(keys).toEqual(['top-premium', 'top-tickets', 'top-divider', 'top-archive', 'top-me'])
  })

  it('상태(프리미엄·티켓)와 이동(보관함·내정보)을 세로줄로 가른다', async () => {
    const w = bar()
    await useAccountStore().signUp('a@b.com', 'pw123456', '이우진')
    await flushPromises()
    expect(w.find('[data-test=top-divider]').exists()).toBe(true)
  })

  it('좁은 화면에서 글자를 떼도 이름이 남게 그림 버튼에 라벨을 단다', async () => {
    const w = bar()
    await useAccountStore().signUp('a@b.com', 'pw123456', '이우진')
    await flushPromises()
    for (const [key, name] of [
      ['top-archive', '보관함'],
      ['top-me', '내정보'],
    ]) {
      const b = w.get(`[data-test=${key}]`)
      expect(b.attributes('aria-label')).toBe(name)
      expect(b.find('svg').exists()).toBe(true)
      expect(b.find('.label').text()).toBe(name)
    }
  })

  it('왼쪽 묶음은 맨 위에서도 보인다 — 바 배경만 투명해지고 이름은 남는다 (2026-11-08)', async () => {
    const w = bar()
    await useAccountStore().signUp('a@b.com', 'pw123456', '이우진')
    await flushPromises()
    expect(w.find('[data-test=top-brand]').exists()).toBe(true)
    expect(w.find('[data-test=topbar]').classes()).not.toContain('docked')
  })

  it('센티넬이 화면에서 벗어나면 판을 깐다 — scrollTop을 읽지 않는다', async () => {
    let fire: (e: Pick<IntersectionObserverEntry, 'isIntersecting'>[]) => void = () => {}
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(fn: typeof fire) {
          fire = fn
        }
        observe() {}
        disconnect() {}
      },
    )
    const w = bar()
    await useAccountStore().signUp('a@b.com', 'pw123456', '이우진')
    await flushPromises()
    fire([{ isIntersecting: false }])
    await flushPromises()
    expect(w.find('[data-test=topbar]').classes()).toContain('docked')
    expect(w.find('[data-test=top-brand]').exists()).toBe(true)
    fire([{ isIntersecting: true }])
    await flushPromises()
    expect(w.find('[data-test=topbar]').classes()).not.toContain('docked')
    vi.unstubAllGlobals()
  })

  it('티켓은 이모지가 아니라 픽셀 아이콘으로 그린다 — 기종마다 모양이 달라진다', async () => {
    const w = bar()
    await useAccountStore().signUp('a@b.com', 'pw123456', '이우진')
    await flushPromises()
    const t = w.get('[data-test=top-tickets]')
    expect(t.text()).not.toMatch(EMOJI)
    expect(t.find('svg').exists()).toBe(true)
  })

  it('뜰 때 저장된 세션을 되찾는다', async () => {
    await useAccountStore().signUp('a@b.com', 'pw123456', '이우진')
    setActivePinia(createPinia())
    const w = bar()
    await settle()
    expect(w.find('[data-test=top-me]').exists()).toBe(true)
  })
})

describe('TopBar — 보이는 화면', () => {
  it('면접 화면에서는 숨는다', async () => {
    const w = bar()
    useInterviewStore().phase = 'interview'
    await flushPromises()
    expect(w.find('[data-test=topbar]').exists()).toBe(false)
  })

  it.each(['landing', 'prepare', 'report'] as const)('%s 화면에서는 보인다', async (phase) => {
    const w = bar()
    useInterviewStore().phase = phase
    await flushPromises()
    expect(w.find('[data-test=topbar]').exists()).toBe(true)
  })
})

describe('TopBar — 모달', () => {
  it('로그인 버튼이 모달을 연다', async () => {
    const w = bar()
    await flushPromises()
    await w.get('[data-test=top-login]').trigger('click')
    expect(document.querySelector('[data-test=modal]')).not.toBeNull()
  })

  it('한 번에 하나만 열린다', async () => {
    const w = bar()
    await useAccountStore().signUp('a@b.com', 'pw123456', '이우진')
    await flushPromises()
    await w.get('[data-test=top-me]').trigger('click')
    await w.get('[data-test=top-premium]').trigger('click')
    expect(document.querySelectorAll('[data-test=modal]')).toHaveLength(1)
  })

  it('모달이 닫히면 사라진다', async () => {
    const w = bar()
    await flushPromises()
    await w.get('[data-test=top-login]').trigger('click')
    document.querySelector<HTMLButtonElement>('[data-test=modal-close]')!.click()
    await flushPromises()
    expect(document.querySelector('[data-test=modal]')).toBeNull()
  })

  it('면접이 시작되면 열려 있던 모달도 닫힌다', async () => {
    const w = bar()
    await flushPromises()
    await w.get('[data-test=top-login]').trigger('click')
    useInterviewStore().phase = 'interview'
    await flushPromises()
    expect(document.querySelector('[data-test=modal]')).toBeNull()
  })
})

describe('TopBar — 관리자 진입', () => {
  const asUser = (isAdmin: boolean) => {
    setAccountApi({
      ...makeMockAccount({ delayMs: 0 }),
      me: async () => ({
        userId: 'u_1',
        email: 'a@b.com',
        tier: 'member' as const,
        tickets: 0,
        isAdmin,
        profile: { name: 'x', age: null },
        createdAt: '2026-10-01T00:00:00Z',
      }),
    })
  }

  it('관리자 링크는 상단바에 두지 않는다 — 쓰는 사람이 둘뿐이라 내정보 안으로 옮겼다', async () => {
    asUser(true)
    const w = bar()
    await settle()
    expect(w.find('[data-test=top-admin]').exists()).toBe(false)
  })

  it('일반 로그인 사용자에게는 없다', async () => {
    asUser(false)
    const w = bar()
    await settle()
    expect(w.find('[data-test=top-me]').exists()).toBe(true)
    expect(w.find('[data-test=top-admin]').exists()).toBe(false)
  })

  it('비로그인에게는 없다', async () => {
    const w = bar()
    await settle()
    expect(w.find('[data-test=top-admin]').exists()).toBe(false)
  })

  it('/admin 화면에서는 모모로 링크가 대신 나온다', async () => {
    history.pushState({}, '', '/admin')
    try {
      asUser(true)
      const w = bar()
      await settle()
      expect(w.get('[data-test=top-home]').attributes('href')).toBe('/')
      expect(w.find('[data-test=top-admin]').exists()).toBe(false)
    } finally {
      history.pushState({}, '', '/')
    }
  })
})

describe('TopBar — 보유 티켓', () => {
  const withTickets = (tickets: number, tier: 'member' | 'premium' = 'premium') => {
    setAccountApi({
      ...makeMockAccount({ delayMs: 0 }),
      me: async () => ({
        userId: 'u_1',
        email: 'a@b.com',
        tier,
        tickets,
        isAdmin: false,
        profile: { name: 'x', age: null },
        createdAt: '2026-10-01T00:00:00Z',
      }),
    })
  }

  it('비로그인에는 없다', async () => {
    const w = bar()
    await flushPromises()
    expect(w.find('[data-test=top-tickets]').exists()).toBe(false)
  })

  it('로그인하면 보유 수를 보여 준다', async () => {
    withTickets(7)
    const w = bar()
    await settle()
    expect(w.get('[data-test=top-tickets]').text()).toContain('7')
  })

  it('0장이면 흐리게 — 없다는 것도 보여 줘야 한다', async () => {
    withTickets(0)
    const w = bar()
    await settle()
    expect(w.get('[data-test=top-tickets]').classes()).toContain('empty')
  })

  it('누르는 곳이 아니다 — 요금제는 "모모 프리미엄"으로만 연다', async () => {
    withTickets(0)
    const w = bar()
    await settle()
    const el = w.get('[data-test=top-tickets]')
    expect(el.element.tagName).toBe('SPAN')
    await el.trigger('click')
    await flushPromises()
    expect(document.querySelector('[data-test=plan-card]')).toBeNull()
  })

  it('세션의 티켓이 바뀌면 따라 바뀐다', async () => {
    withTickets(3)
    const w = bar()
    await settle()
    expect(w.get('[data-test=top-tickets]').text()).toContain('3')
    useAccountStore().session!.tickets = 2
    await flushPromises()
    expect(w.get('[data-test=top-tickets]').text()).toContain('2')
  })
})

describe('TopBar — 이름을 누르면 처음으로 (2026-11-08)', () => {
  it('누르면 랜딩으로 간다', async () => {
    const s = useInterviewStore()
    s.$patch({ phase: 'prepare' })
    const w = bar()
    await flushPromises()
    await w.get('[data-test=top-brand]').trigger('click')
    expect(s.phase).toBe('landing')
  })

  it('입력한 것을 버리지 않는다 — reset이 아니라 화면만 돌린다', async () => {
    const s = useInterviewStore()
    s.$patch({ phase: 'prepare', profile: { ...s.profile, job: '백엔드 개발자' } })
    const reset = vi.spyOn(s, 'reset')
    const w = bar()
    await flushPromises()
    await w.get('[data-test=top-brand]').trigger('click')
    expect(reset).not.toHaveBeenCalled()
    expect(s.profile.job).toBe('백엔드 개발자')
  })

  it('누를 수 있는 것이므로 버튼이다 — div에 클릭만 달면 키보드로 못 간다', async () => {
    const w = bar()
    await flushPromises()
    expect(w.get('[data-test=top-brand]').element.tagName).toBe('BUTTON')
  })

  it('맨 위에서 시작한다 — 화면만 바꾸면 이전 스크롤 자리가 남는다', async () => {
    const to = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    useInterviewStore().$patch({ phase: 'prepare' })
    const w = bar()
    await flushPromises()
    await w.get('[data-test=top-brand]').trigger('click')
    expect(to).toHaveBeenCalledWith(0, 0)
    to.mockRestore()
  })

  it('보관함 상세에서 눌러도 홈으로 간다 — 상세가 phase보다 앞서 그려져 덮고 있다', async () => {
    const s = useInterviewStore()
    const v = useArchiveViewStore()
    v.$patch({ detail: { id: 'a1' } as never })
    const w = bar()
    await flushPromises()
    await w.get('[data-test=top-brand]').trigger('click')
    expect(v.detail).toBe(null)
    expect(s.phase).toBe('landing')
  })

  it('상세에서 누르면 상세가 민 히스토리 항목도 되감는다', async () => {
    const v = useArchiveViewStore()
    v.$patch({ detail: { id: 'a1' } as never })
    history.pushState({ momoArchive: 'a1' }, '')
    const back = vi.spyOn(history, 'back').mockImplementation(() => {})
    const w = bar()
    await flushPromises()
    await w.get('[data-test=top-brand]').trigger('click')
    expect(back).toHaveBeenCalled()
    back.mockRestore()
  })

  it('이미 랜딩이면 눌러도 그대로다', async () => {
    const s = useInterviewStore()
    s.$patch({ phase: 'landing' })
    const w = bar()
    await flushPromises()
    await w.get('[data-test=top-brand]').trigger('click')
    expect(s.phase).toBe('landing')
  })
})

describe('TopBar — 지금 단계 (2026-11-08)', () => {
  it('보관함 상세에서는 보관함이라 적는다 — 면접 단계와 무관한 화면이다', async () => {
    useArchiveViewStore().$patch({ detail: { id: 'a1' } as never })
    const w = bar()
    await flushPromises()
    expect(w.get('[data-test=top-brand]').text()).toContain('보관함')
  })
})

describe('TopBar — 자리지기 (2026-11-08)', () => {
  it('바가 숨는 화면에서는 자리를 비운다 — 안 비우면 면접장 맨 위에 빈 띠가 64px 남는다', async () => {
    useInterviewStore().$patch({ phase: 'interview' })
    const w = bar()
    await flushPromises()
    // scoped CSS는 jsdom에 적용되지 않으므로 클래스로 본다 (.sentinel.gone { height: 0 })
    expect(w.get('.sentinel').classes()).toContain('gone')
  })

  it('바가 보이는 화면에서는 자리를 지킨다 — 고정된 바가 내용을 덮는다', async () => {
    useInterviewStore().$patch({ phase: 'report' })
    const w = bar()
    await flushPromises()
    expect(w.get('.sentinel').classes()).not.toContain('gone')
  })

  it('숨는 화면에서도 자리지기는 남는다 — 돌아올 때 판 깔림을 다시 재야 한다', async () => {
    useInterviewStore().$patch({ phase: 'interview' })
    const w = bar()
    await flushPromises()
    expect(w.find('.sentinel').exists()).toBe(true)
  })
})
