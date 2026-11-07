import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import MeModal from './MeModal.vue'
import { useAccountStore, setAccountApi } from '@/stores/account'
import { RESUME_SLOTS } from '@/services/account'
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
    await click('slot-empty')
    await set('slot-title', '한국대 컴공 지원')
    await set('slot-text', 'x'.repeat(80))
    await click('slot-save')
    expect(all('slot-card')).toHaveLength(1)
    expect(text('slot-card')).toContain('한국대 컴공 지원')
    expect(text('me-tab-admission')).toContain('1/3')
  })

  it('제목이 비면 저장하지 않는다', async () => {
    modal()
    await settle()
    await click('slot-empty')
    await set('slot-text', 'x'.repeat(80))
    await click('slot-save')
    expect(all('slot-card')).toHaveLength(0)
    expect(text('slot-error')).toContain('제목')
  })

  it('기존 슬롯을 열어 고치면 덮어쓴다 — 한도를 먹지 않는다', async () => {
    await useAccountStore().saveResume({ kind: 'admission', title: '전', text: 'x'.repeat(80) })
    modal()
    await settle()
    await click('slot-open')
    await set('slot-title', '후')
    await click('slot-save')
    expect(all('slot-card')).toHaveLength(1)
    expect(text('slot-card')).toContain('후')
  })

  it('칸이 차면 한도를 알린다 — 빈 칸 자체는 사라진다(아래 "이력서 칸"이 더 본다)', async () => {
    const a = useAccountStore()
    for (let i = 0; i < 3; i++)
      await a.saveResume({ kind: 'admission', title: `${i}`, text: 'x'.repeat(80) })
    modal()
    await settle()
    expect(text('slot-full-note')).toContain('하나를 지워야')
  })

  /* 지운 이력서는 되돌릴 수 없다 — "열기" 바로 옆이라 더욱 한 번 더 묻는다 */
  it('삭제를 눌러도 바로 지워지지 않고 한 번 더 묻는다', async () => {
    await useAccountStore().saveResume({ kind: 'admission', title: 'x', text: 'x'.repeat(80) })
    modal()
    await settle()
    await click('slot-more')
    await click('slot-delete')
    expect(all('slot-card')).toHaveLength(1)
    expect(document.querySelector('[data-test=slot-delete-confirm]')).not.toBeNull()
  })

  it('묻는 자리에서 취소하면 이력서가 남는다', async () => {
    await useAccountStore().saveResume({ kind: 'admission', title: 'x', text: 'x'.repeat(80) })
    modal()
    await settle()
    await click('slot-more')
    await click('slot-delete')
    await click('slot-delete-cancel')
    expect(all('slot-card')).toHaveLength(1)
    expect(document.querySelector('[data-test=slot-delete-confirm]')).toBeNull()
  })

  it('확인하고 지우면 자리가 난다', async () => {
    await useAccountStore().saveResume({ kind: 'admission', title: 'x', text: 'x'.repeat(80) })
    modal()
    await settle()
    await click('slot-more')
    await click('slot-delete')
    await click('slot-delete-confirm')
    expect(all('slot-card')).toHaveLength(0)
  })

  it('한 줄에서 묻는 동안 다른 줄은 그대로다', async () => {
    const a = useAccountStore()
    await a.saveResume({ kind: 'admission', title: '첫째', text: 'x'.repeat(80) })
    await a.saveResume({ kind: 'admission', title: '둘째', text: 'x'.repeat(80) })
    modal()
    await settle()
    all('slot-more')[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    q('slot-delete').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    expect(all('slot-delete-confirm')).toHaveLength(1)
  })

  it('탭을 바꾸면 그 종류만 보인다', async () => {
    const a = useAccountStore()
    await a.saveResume({ kind: 'admission', title: '자소서', text: 'x'.repeat(80) })
    await a.saveResume({ kind: 'company', title: '이력서', text: 'x'.repeat(80) })
    modal()
    await settle()
    expect(text('slot-card')).toContain('자소서')
    await click('me-tab-company')
    expect(text('slot-card')).toContain('이력서')
  })

  it('탭을 바꾸면 쓰던 편집기는 닫힌다 — 종류가 섞이지 않게', async () => {
    modal()
    await settle()
    await click('slot-empty')
    expect(document.querySelector('[data-test=slot-title]')).not.toBeNull()
    await click('me-tab-company')
    expect(document.querySelector('[data-test=slot-title]')).toBeNull()
  })

  it('새로 만들 때 탭에 맞는 종류로 저장된다', async () => {
    modal()
    await settle()
    await click('me-tab-company')
    await click('slot-empty')
    await set('slot-title', '백엔드 이력서')
    await set('slot-text', 'x'.repeat(80))
    await click('slot-save')
    expect(useAccountStore().slotsOf('company')).toHaveLength(1)
    expect(useAccountStore().slotsOf('admission')).toHaveLength(0)
  })

  it('닫았다 열면 편집기가 닫혀 있다', async () => {
    const w = modal()
    await settle()
    await click('slot-empty')
    await w.setProps({ open: false })
    await w.setProps({ open: true })
    await settle()
    expect(document.querySelector('[data-test=slot-title]')).toBeNull()
  })
})

describe('MeModal — 관리자 진입 (상단바에서 옮겨 옴)', () => {
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

  it('관리자는 내정보에서 관리자 화면으로 간다', async () => {
    asUser(true)
    await useAccountStore().load()
    modal()
    await settle()
    expect(q<HTMLAnchorElement>('me-admin').getAttribute('href')).toBe('/admin')
  })

  it('관리자가 아니면 그 링크가 없다', async () => {
    asUser(false)
    await useAccountStore().load()
    modal()
    await settle()
    expect(document.querySelector('[data-test=me-admin]')).toBeNull()
  })
})

describe('MeModal — 윗덩이 (2026-11-07)', () => {
  const src = readFileSync(join(__dirname, 'MeModal.vue'), 'utf8')

  it('이름·나이·등급이 한 줄로 흐른다 — 셋을 3분의 1씩 나누지 않는다', async () => {
    await useAccountStore().saveProfile({ name: '이우진', age: 26 })
    modal()
    await settle()
    const line = text('me-identity')
    expect(line).toContain('이우진')
    expect(line).toContain('26세')
  })

  it('이름과 나이가 둘 다 비어도 허전하지 않게 말한다 — 가입 직후다', async () => {
    await useAccountStore().saveProfile({ name: null, age: null })
    modal()
    await settle()
    expect(text('me-identity')).toContain('면접 중에 쓸 이름')
  })

  it('고치기를 눌러도 초상이 움직이지 않는다 — 두 상태가 같은 줄 높이를 쓴다', async () => {
    modal()
    await settle()
    await click('me-profile-edit')
    expect(q('me-portrait')).not.toBeNull()
    expect(src).toMatch(/\.identity \{[^}]*min-height/)
  })

  it('나이 칸은 이메일과 같은 폭을 받지 않는다 — 두 글자가 한 줄을 다 먹으면 허전하다', async () => {
    modal()
    await settle()
    await click('me-profile-edit')
    expect(q('me-age').classList.contains('age')).toBe(true)
    expect(src).toMatch(/\.age \{[^}]*width:\s*56px/)
    // 스피너가 켜져 있으면 좁은 칸에서 숫자를 밀어낸다
    expect(src).toMatch(/\.age \{[^}]*appearance:\s*textfield/)
  })

  it('티켓과 보관함 수를 숫자 칸으로 보여 준다 — 이미 있는 값만 쓴다', async () => {
    const a = useAccountStore()
    await a.purchasePremium()
    a.$patch({ archive: [{}, {}] as never })
    modal()
    await settle()
    expect(text('me-tickets')).toContain('10')
    expect(text('me-archive-count')).toContain('2')
  })

  it('지원자 초상은 2배로만 키운다 — 44px 시트라 72px은 정수 배율이 아니다', async () => {
    const w = modal()
    await settle()
    expect(w.findComponent({ name: 'SpriteFrame' }).props('scale')).toBe(2)
  })
})

describe('MeModal — 이력서 칸 (2026-11-07)', () => {
  const two = async () => {
    const a = useAccountStore()
    await a.saveResume({ kind: 'admission', title: '신입 백엔드', text: 'x'.repeat(2480) })
    await a.saveResume({ kind: 'admission', title: '포트폴리오용', text: 'y'.repeat(3120) })
    modal()
    await settle()
  }

  it('쓴 칸은 카드로, 남은 칸은 점선 하나로 보여 준다 — 빈 상자를 늘어놓지 않는다', async () => {
    await two()
    expect(all('slot-card')).toHaveLength(2)
    expect(all('slot-empty')).toHaveLength(1)
    expect(text('slot-empty')).toContain('1칸 남음')
  })

  it('카드에 글자 수를 적는다 — 제목만으로는 어느 것이 긴지 모른다', async () => {
    await two()
    expect(all('slot-card')[0].textContent).toContain('2,480자')
  })

  it('지우기는 ··· 안에 있다 — 되돌릴 수 없는 일이 열기와 같은 무게로 보이면 안 된다', async () => {
    await two()
    expect(document.querySelector('[data-test=slot-delete]')).toBeNull()
    await click('slot-more')
    expect(document.querySelector('[data-test=slot-delete]')).not.toBeNull()
  })

  it('··· 는 한 번에 하나만 열린다 — 둘이 열리면 어느 줄을 지우는지 흐려진다', async () => {
    await two()
    all('slot-more')[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    all('slot-more')[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    expect(all('slot-delete')).toHaveLength(1)
  })

  it('칸을 다 쓰면 빈 칸 자체가 없다 — 눌렀다 거절당하지 않게', async () => {
    const a = useAccountStore()
    for (let i = 0; i < RESUME_SLOTS; i++)
      await a.saveResume({ kind: 'admission', title: `이력서 ${i}`, text: 'x'.repeat(80) })
    modal()
    await settle()
    expect(document.querySelector('[data-test=slot-empty]')).toBeNull()
    expect(document.querySelector('[data-test=slot-full-note]')).not.toBeNull()
  })

  it('탭을 바꾸면 열려 있던 ··· 도 닫힌다 — 보이지 않는 줄의 메뉴가 남지 않게', async () => {
    await two()
    await click('slot-more')
    await click('me-tab-company')
    expect(document.querySelector('[data-test=slot-delete]')).toBeNull()
  })
})
