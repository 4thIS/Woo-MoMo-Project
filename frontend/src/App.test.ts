import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from './App.vue'
import { isAdminPath } from '@/services/route'
import { useArchiveViewStore } from '@/stores/archiveView'
import { useModalStore } from '@/stores/modal'

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

describe('App — 보관함으로 돌아가기 (2026-11-08)', () => {
  const detail = { id: 'a1', report: [], messages: [], recordings: [] }
  /** 상세를 띄운 App. 자식은 stub한다 — 화면을 다 끌고 오면 느리고 깨지기 쉽다 */
  const withDetail = () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useArchiveViewStore().$patch({ detail: detail as never })
    return mount(App, {
      global: {
        plugins: [pinia],
        stubs: { ArchiveDetailView: true, TopBar: true, HintBar: true },
      },
    })
  }
  const detailStub = (w: ReturnType<typeof mount>) => w.findComponent({ name: 'ArchiveDetailView' })

  it('상세를 닫으면 보관함 목록이 다시 열린다 — 이전 페이지로 나가지 않는다', async () => {
    const w = withDetail()
    detailStub(w).vm.$emit('back')
    await flushPromises()
    expect(useArchiveViewStore().detail).toBe(null)
    expect(useModalStore().open).toBe('archive')
  })

  it('상세를 열며 민 히스토리 항목을 되감는다 — 안 그러면 뒤로 가기가 한 번 헛돈다', async () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => {})
    const w = withDetail()
    history.pushState({ momoArchive: 'a1' }, '')
    detailStub(w).vm.$emit('back')
    await flushPromises()
    expect(back).toHaveBeenCalled()
    back.mockRestore()
  })

  it('민 항목이 없으면 되감지 않는다 — 남의 기록을 건드리면 안 된다', async () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => {})
    const w = withDetail()
    history.pushState({}, '', '/')
    detailStub(w).vm.$emit('back')
    await flushPromises()
    expect(back).not.toHaveBeenCalled()
    back.mockRestore()
  })

  it('지우고 나서도 목록으로 돌아간다', async () => {
    const w = withDetail()
    detailStub(w).vm.$emit('remove')
    await flushPromises()
    expect(useArchiveViewStore().detail).toBe(null)
    expect(useModalStore().open).toBe('archive')
  })
})
