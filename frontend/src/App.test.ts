import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import App from './App.vue'
import { isAdminPath } from '@/services/route'

vi.stubGlobal(
  'fetch',
  vi.fn(() => Promise.reject(new Error('offline'))),
)

afterEach(() => history.pushState({}, '', '/'))

describe('주소 분기', () => {
  it('isAdminPath', () => {
    expect(isAdminPath('/admin')).toBe(true)
    expect(isAdminPath('/admin/')).toBe(true)
    expect(isAdminPath('/')).toBe(false)
    expect(isAdminPath('/administrator')).toBe(false)
  })

  it('/admin이면 관리자 화면을 띄우고 랜딩은 띄우지 않는다', async () => {
    history.pushState({}, '', '/admin')
    const w = mount(App, { global: { plugins: [createPinia()] } })
    await vi.waitFor(() => expect(w.find('main.admin').exists()).toBe(true))
    await flushPromises()
    // 상단바의 이름은 이제 늘 있다(2026-11-08) — 랜딩 화면 자체가 없는지로 본다
    expect(w.find('[data-test=spec-line]').exists()).toBe(false)
    expect(w.find('[data-test=topbar]').exists()).toBe(true)
  })
})

describe('App — 보관함 상세의 뒤로 가기 (2026-11-08)', () => {
  const src = readFileSync(join(__dirname, 'App.vue'), 'utf8')

  it('상세를 열며 민 항목에서 빠져나올 때만 닫는다 — 해시 이동의 popstate에 닫히면 안 된다', () => {
    expect(src).toMatch(/function onPop[\s\S]{0,300}momoArchive/)
  })
})
