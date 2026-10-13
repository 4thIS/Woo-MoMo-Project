import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import MeModal from './MeModal.vue'
import { useAccountStore, setAccountApi } from '@/stores/account'
import { makeMockAccount } from '@/services/accountMock'

let mounted: ReturnType<typeof mount> | null = null
const modal = () => {
  mounted = mount(MeModal, { props: { open: true }, attachTo: document.body })
  return mounted as ReturnType<typeof mount<typeof MeModal>>
}

const q = <T extends Element = HTMLElement>(key: string) =>
  document.querySelector<T>(`[data-test=${key}]`)!
const all = (key: string) => [...document.querySelectorAll(`[data-test=${key}]`)]
const text = (key: string) => q(key).textContent ?? ''

/** 목업은 delayMs 0이라도 타이머를 거치고, 흐름에 따라 여러 번 거친다 */
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0))
    await flushPromises()
  }
}
const click = async (key: string) => {
  q<HTMLButtonElement>(key).click()
  await settle()
}
const set = async (key: string, value: string) => {
  const el = q<HTMLInputElement | HTMLTextAreaElement>(key)
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
}

afterEach(() => {
  mounted?.unmount()
  mounted = null
})

beforeEach(async () => {
  localStorage.clear()
  document.body.innerHTML = ''
  setActivePinia(createPinia())
  setAccountApi(makeMockAccount({ delayMs: 0 }))
  await useAccountStore().signUp('a@b.com', 'pw123456', '이우진')
})

describe('MeModal — 계정 띠', () => {
  it('이메일과 등급을 보여 준다', async () => {
    modal()
    await settle()
    expect(text('me-account')).toContain('a@b.com')
    expect(text('me-account')).toContain('로그인')
  })

  it('프리미엄이면 남은 티켓을 보여 준다', async () => {
    await useAccountStore().purchasePremium()
    modal()
    await settle()
    expect(text('me-account')).toContain('프리미엄')
    expect(text('me-account')).toContain('10')
  })

  it('이름·나이를 고치면 저장된다 — 대입 면접에서 미리 채울 값이다', async () => {
    modal()
    await settle()
    await click('me-profile-edit')
    await set('me-name', '홍길동')
    await set('me-age', '19')
    await click('me-profile-save')
    expect(useAccountStore().profile).toEqual({ name: '홍길동', age: 19 })
  })

  it('나이를 비우면 null로 둔다', async () => {
    modal()
    await settle()
    await click('me-profile-edit')
    await set('me-name', '홍길동')
    await click('me-profile-save')
    expect(useAccountStore().profile).toEqual({ name: '홍길동', age: null })
  })

  it('로그아웃하면 닫힌다', async () => {
    const w = modal()
    await settle()
    await click('me-signout')
    expect(useAccountStore().signedIn).toBe(false)
    expect(w.emitted('close')).toHaveLength(1)
  })
})

describe('MeModal — 이력서 슬롯', () => {
  it('기본 탭은 대입이고 슬롯 수가 적힌다', async () => {
    modal()
    await settle()
    expect(text('me-tab-admission')).toContain('0/3')
    expect(text('me-tab-company')).toContain('0/3')
  })

  it('저장하면 목록에 나오고 수가 는다', async () => {
    modal()
    await settle()
    await click('slot-new')
    await set('slot-title', '한국대 컴공 지원')
    await set('slot-text', 'x'.repeat(80))
    await click('slot-save')
    expect(all('slot-row')).toHaveLength(1)
    expect(text('slot-row')).toContain('한국대 컴공 지원')
    expect(text('me-tab-admission')).toContain('1/3')
  })

  it('제목이 비면 저장하지 않는다', async () => {
    modal()
    await settle()
    await click('slot-new')
    await set('slot-text', 'x'.repeat(80))
    await click('slot-save')
    expect(all('slot-row')).toHaveLength(0)
    expect(text('slot-error')).toContain('제목')
  })

  it('기존 슬롯을 열어 고치면 덮어쓴다 — 한도를 먹지 않는다', async () => {
    await useAccountStore().saveResume({ kind: 'admission', title: '전', text: 'x'.repeat(80) })
    modal()
    await settle()
    await click('slot-open')
    await set('slot-title', '후')
    await click('slot-save')
    expect(all('slot-row')).toHaveLength(1)
    expect(text('slot-row')).toContain('후')
  })

  it('3개가 차면 새로 만들기가 잠긴다', async () => {
    const a = useAccountStore()
    for (let i = 0; i < 3; i++)
      await a.saveResume({ kind: 'admission', title: `${i}`, text: 'x'.repeat(80) })
    modal()
    await settle()
    expect(q<HTMLButtonElement>('slot-new').disabled).toBe(true)
    expect(text('slot-full-note')).toContain('하나를 지워야')
  })

  it('지우면 자리가 난다', async () => {
    await useAccountStore().saveResume({ kind: 'admission', title: 'x', text: 'x'.repeat(80) })
    modal()
    await settle()
    await click('slot-delete')
    expect(all('slot-row')).toHaveLength(0)
  })

  it('탭을 바꾸면 그 종류만 보인다', async () => {
    const a = useAccountStore()
    await a.saveResume({ kind: 'admission', title: '자소서', text: 'x'.repeat(80) })
    await a.saveResume({ kind: 'company', title: '이력서', text: 'x'.repeat(80) })
    modal()
    await settle()
    expect(text('slot-row')).toContain('자소서')
    await click('me-tab-company')
    expect(text('slot-row')).toContain('이력서')
  })

  it('탭을 바꾸면 쓰던 편집기는 닫힌다 — 종류가 섞이지 않게', async () => {
    modal()
    await settle()
    await click('slot-new')
    expect(document.querySelector('[data-test=slot-title]')).not.toBeNull()
    await click('me-tab-company')
    expect(document.querySelector('[data-test=slot-title]')).toBeNull()
  })

  it('새로 만들 때 탭에 맞는 종류로 저장된다', async () => {
    modal()
    await settle()
    await click('me-tab-company')
    await click('slot-new')
    await set('slot-title', '백엔드 이력서')
    await set('slot-text', 'x'.repeat(80))
    await click('slot-save')
    expect(useAccountStore().slotsOf('company')).toHaveLength(1)
    expect(useAccountStore().slotsOf('admission')).toHaveLength(0)
  })

  it('닫았다 열면 편집기가 닫혀 있다', async () => {
    const w = modal()
    await settle()
    await click('slot-new')
    await w.setProps({ open: false })
    await w.setProps({ open: true })
    await settle()
    expect(document.querySelector('[data-test=slot-title]')).toBeNull()
  })
})
