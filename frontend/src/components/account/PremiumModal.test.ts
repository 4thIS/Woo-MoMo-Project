import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PremiumModal from './PremiumModal.vue'
import { useAccountStore, setAccountApi } from '@/stores/account'
import { makeMockAccount } from '@/services/accountMock'

let mounted: ReturnType<typeof mount> | null = null
const modal = () => {
  mounted = mount(PremiumModal, { props: { open: true }, attachTo: document.body })
  return mounted as ReturnType<typeof mount<typeof PremiumModal>>
}

const q = <T extends Element = HTMLElement>(key: string) =>
  document.querySelector<T>(`[data-test=${key}]`)!
/** 지금 내 등급 칸 */
const nowCol = () => document.querySelector('[data-test=plan-col].now')!
const all = (key: string) => [...document.querySelectorAll(`[data-test=${key}]`)]

/** 목업 타이머와 결제 목업의 대기를 모두 흘려보낸다 */
const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await vi.advanceTimersByTimeAsync(3000)
    await flushPromises()
  }
}
const click = async (key: string) => {
  q<HTMLButtonElement>(key).click()
  await settle()
}

afterEach(() => {
  mounted?.unmount()
  mounted = null
  vi.useRealTimers()
})

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  vi.useFakeTimers()
  setActivePinia(createPinia())
  setAccountApi(makeMockAccount({ delayMs: 0 }))
})

const signUp = async () => {
  const p = useAccountStore().signUp('a@b.com', 'pw123456')
  await settle()
  await p
}

describe('PremiumModal — 비교표', () => {
  it('세 칸을 그린다', () => {
    modal()
    expect(all('plan-col')).toHaveLength(3)
    expect(all('plan-row').length).toBeGreaterThan(4)
  })

  it('비로그인은 비로그인 칸이 강조된다', () => {
    modal()
    expect(nowCol().textContent).toContain('비로그인')
  })

  it('로그인하면 로그인 칸이 강조된다', async () => {
    modal()
    await signUp()
    expect(nowCol().textContent).toContain('로그인')
  })

  it('프리미엄이면 프리미엄 칸이 강조된다', async () => {
    modal()
    await signUp()
    const p = useAccountStore().purchasePremium()
    await settle()
    await p
    expect(nowCol().textContent).toContain('프리미엄')
  })
})

describe('PremiumModal — 결제 목업', () => {
  it('비로그인이 결제를 누르면 로그인을 요청한다', async () => {
    const w = modal()
    await click('premium-start')
    expect(w.emitted('need-login')).toHaveLength(1)
    expect(document.querySelector('[data-test=pay-confirm]')).toBeNull()
  })

  it('결제를 마치면 프리미엄이 되고 티켓 10장이다', async () => {
    modal()
    await signUp()
    await click('premium-start')
    await click('pay-confirm')
    const a = useAccountStore()
    expect(a.isPremium).toBe(true)
    expect(a.tickets).toBe(10)
  })

  it('성공 화면에 실제 결제가 아니라고 적는다', async () => {
    modal()
    await signUp()
    await click('premium-start')
    await click('pay-confirm')
    expect(q('pay-done').textContent).toContain('실제 결제가 아닙니다')
  })

  it('처리 중에 결제 버튼을 또 눌러도 한 번만 결제된다', async () => {
    modal()
    await signUp()
    await click('premium-start')
    q<HTMLButtonElement>('pay-confirm').click()
    q<HTMLButtonElement>('pay-confirm').click()
    await settle()
    expect(useAccountStore().tickets).toBe(10)
  })

  it('처리 중에 닫아도 티켓이 두 번 들어오지 않는다', async () => {
    const w = modal()
    await signUp()
    await click('premium-start')
    q<HTMLButtonElement>('pay-confirm').click()
    await w.setProps({ open: false })
    await settle()
    expect(useAccountStore().tickets).toBeLessThanOrEqual(10)
  })

  it('닫았다 열면 비교표부터 다시 시작한다', async () => {
    const w = modal()
    await signUp()
    await click('premium-start')
    expect(document.querySelector('[data-test=pay-confirm]')).not.toBeNull()
    await w.setProps({ open: false })
    await w.setProps({ open: true })
    expect(document.querySelector('[data-test=pay-confirm]')).toBeNull()
    expect(document.querySelector('[data-test=premium-start]')).not.toBeNull()
  })

  it('이미 프리미엄이면 티켓 더 받기로 바뀐다', async () => {
    modal()
    await signUp()
    const p = useAccountStore().purchasePremium()
    await settle()
    await p
    expect(q('premium-start').textContent).toContain('티켓 더 받기')
  })

  it('프리미엄이 또 결제하면 티켓이 더해진다', async () => {
    modal()
    await signUp()
    const p = useAccountStore().purchasePremium()
    await settle()
    await p
    await click('premium-start')
    await click('pay-confirm')
    expect(useAccountStore().tickets).toBe(20)
  })
})
