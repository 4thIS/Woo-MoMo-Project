import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TopBar from './TopBar.vue'
import { useAccountStore, setAccountApi } from '@/stores/account'
import { useInterviewStore } from '@/stores/interview'
import { makeMockAccount } from '@/services/accountMock'

const bar = () => mount(TopBar, { attachTo: document.body })

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
    // 목업 가입 계정은 관리자라 top-admin도 나온다 — 순서는 나머지 셋만 본다
    const keys = [...w.element.querySelectorAll('[data-test^=top-]')]
      .map((e) => (e as HTMLElement).dataset.test)
      .filter((k) => k !== 'top-admin')
    expect(keys).toEqual(['top-premium', 'top-archive', 'top-me'])
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

  it('관리자는 /admin 링크가 보인다', async () => {
    asUser(true)
    const w = bar()
    await settle()
    const a = w.get('[data-test=top-admin]')
    expect(a.attributes('href')).toBe('/admin')
    expect(a.element.tagName).toBe('A')
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
