import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import PixelModal from './PixelModal.vue'

const open = (props = {}) =>
  mount(PixelModal, {
    props: { open: true, title: '내정보', ...props },
    slots: { default: '<button data-test="inner">안쪽</button>' },
    attachTo: document.body,
  })

beforeEach(() => {
  document.body.innerHTML = ''
  document.body.style.overflow = ''
})

describe('PixelModal', () => {
  it('open이 false면 그리지 않는다', () => {
    mount(PixelModal, { props: { open: false }, attachTo: document.body })
    expect(document.querySelector('[data-test=modal]')).toBeNull()
  })

  it('제목과 내용을 보여 준다', () => {
    open()
    const box = document.querySelector('[data-test=modal]')!
    expect(box.textContent).toContain('내정보')
    expect(box.querySelector('[data-test=inner]')).not.toBeNull()
  })

  it('닫기 버튼이 close를 낸다', async () => {
    const w = open()
    document.querySelector<HTMLButtonElement>('[data-test=modal-close]')!.click()
    await w.vm.$nextTick()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('바깥(덮개)을 누르면 닫힌다', async () => {
    const w = open()
    const veil = document.querySelector('[data-test=modal-veil]')!
    veil.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await w.vm.$nextTick()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('안쪽을 눌러도 닫히지 않는다', async () => {
    const w = open()
    document.querySelector<HTMLButtonElement>('[data-test=inner]')!.click()
    await w.vm.$nextTick()
    expect(w.emitted('close')).toBeUndefined()
  })

  it('Esc로 닫힌다', async () => {
    const w = open()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.vm.$nextTick()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('Esc를 두 번 눌러도 close는 한 번이다 — 닫는 중에는 무시한다', async () => {
    const w = open()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.vm.$nextTick()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('덮개를 빠르게 두 번 눌러도 close는 한 번이다', async () => {
    const w = open()
    const veil = document.querySelector('[data-test=modal-veil]')!
    veil.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    veil.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await w.vm.$nextTick()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('열려 있는 동안 뒤 페이지가 스크롤하지 않는다', async () => {
    const w = open()
    expect(document.body.style.overflow).toBe('hidden')
    await w.setProps({ open: false })
    expect(document.body.style.overflow).toBe('')
  })

  it('닫히면 Esc 리스너도 사라진다', async () => {
    const w = open()
    await w.setProps({ open: false })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.vm.$nextTick()
    expect(w.emitted('close')).toBeUndefined()
  })

  it('다시 열면 또 닫을 수 있다 — 닫기 가드가 풀린다', async () => {
    const w = open()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.setProps({ open: false })
    await w.setProps({ open: true })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.vm.$nextTick()
    expect(w.emitted('close')).toHaveLength(2)
  })

  it('사라질 때 뒤 스크롤을 되돌린다', () => {
    const w = open()
    w.unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('wide는 넓은 칸을 쓴다', () => {
    open({ width: 'wide' })
    expect(document.querySelector('[data-test=modal]')!.classList).toContain('wide')
  })

  it('role과 aria가 붙는다', () => {
    open()
    const el = document.querySelector('[data-test=modal]')!
    expect(el.getAttribute('role')).toBe('dialog')
    expect(el.getAttribute('aria-modal')).toBe('true')
  })
})
