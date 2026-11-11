import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ContactModal from './ContactModal.vue'

let mounted: ReturnType<typeof mount> | null = null
const open = () => {
  mounted = mount(ContactModal, { props: { open: true }, attachTo: document.body })
  return mounted as ReturnType<typeof mount<typeof ContactModal>>
}
const q = (key: string) => document.querySelector(`[data-test=${key}]`)
const all = (key: string) => [...document.querySelectorAll(`[data-test=${key}]`)]
const text = () => document.body.textContent ?? ''

/** 그림문자 한 자라도 있으면 기종마다 모양이 달라진다 — 픽셀 UI에서는 쓰지 않는다 */
const EMOJI = /\p{Extended_Pictographic}/u

beforeEach(() => {
  document.body.innerHTML = ''
  setActivePinia(createPinia())
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

describe('ContactModal — 기업에 제안하는 것', () => {
  it('닫혀 있으면 아무것도 그리지 않는다', async () => {
    mounted = mount(ContactModal, { props: { open: false }, attachTo: document.body })
    await flushPromises()
    expect(q('contact-doc')).toBeNull()
  })

  it('제공하는 것 네 가지를 보여 준다', async () => {
    open()
    await flushPromises()
    expect(all('contact-offer')).toHaveLength(4)
    for (const w of ['전용 면접관', '노출', '리포트', '후원 티켓']) expect(text()).toContain(w)
  })

  it('각 항목은 회사가 얻는 것을 함께 적는다 — 무엇을 주는지만으로는 제안이 안 된다', async () => {
    open()
    await flushPromises()
    expect(all('contact-gain')).toHaveLength(4)
  })

  it('진행 단계 네 개와 가격을 보여 준다', async () => {
    open()
    await flushPromises()
    expect(all('contact-step')).toHaveLength(4)
    expect(all('contact-price-row').length).toBeGreaterThanOrEqual(4)
  })

  it('가격이 확정이 아니라 제안임을 밝힌다 — 공적인 자료에서 넘겨짚지 않는다', async () => {
    open()
    await flushPromises()
    expect(q('contact-price-note')?.textContent).toContain('제안')
  })

  it('아직 준비 단계임을 먼저 밝힌다 — 운영 중인 것처럼 읽히면 안 된다', async () => {
    open()
    await flushPromises()
    expect(q('contact-stage')).not.toBeNull()
    expect(q('contact-stage')?.textContent).toMatch(/계획|준비/)
  })

  it('데이터 원칙 네 가지를 적는다 — 회사가 가장 먼저 묻는 것이다', async () => {
    open()
    await flushPromises()
    expect(all('contact-vow')).toHaveLength(4)
    expect(text()).toContain('출제 문항')
    expect(text()).toContain('익명')
  })

  it('연락할 곳이 있다', async () => {
    open()
    await flushPromises()
    expect(q('contact-foot')).not.toBeNull()
  })

  it('닫기를 누르면 close를 emit한다', async () => {
    const w = open()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-test=modal-close]')!.click()
    await flushPromises()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('그림문자를 쓰지 않는다', async () => {
    open()
    await flushPromises()
    expect(text()).not.toMatch(EMOJI)
  })
})
