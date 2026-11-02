import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import PixelModal from './PixelModal.vue'

// 열린 모달은 **모듈 스코프 목록**에 자기를 올려 둔다(겹쳐 열릴 때 맨 위를 가리기 위해).
// 테스트가 끝날 때 거두지 않으면 그 목록이 다음 테스트로 새어 간다
enableAutoUnmount(afterEach)

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

  it('chrome이 false면 판을 뺀다 — 내용이 이미 카드 묶음일 때 쓴다', () => {
    open({ chrome: false })
    expect(document.querySelector('[data-test=modal]')!.classList).toContain('bare')
  })

  it('기본은 판이 있다', () => {
    open()
    expect(document.querySelector('[data-test=modal]')!.classList).not.toContain('bare')
  })

  /* 겹쳐 열릴 때 — 가입 폼 위에 약관을 띄우는 자리가 있다.
     Esc 한 번에 둘 다 닫히면 적던 입력이 통째로 사라진다 */
  it('모달이 겹쳐 열리면 Esc는 위의 하나만 닫는다', async () => {
    const under = open({ title: '회원가입' })
    const over = open({ title: '이용약관' })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await over.vm.$nextTick()
    expect(over.emitted('close')).toHaveLength(1)
    expect(under.emitted('close')).toBeUndefined()
  })

  it('위를 닫은 뒤의 Esc는 아래를 닫는다', async () => {
    const under = open({ title: '회원가입' })
    const over = open({ title: '이용약관' })
    await over.setProps({ open: false })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await under.vm.$nextTick()
    expect(under.emitted('close')).toHaveLength(1)
  })

  it('위가 닫혀도 아래가 남아 있으면 뒤 페이지는 계속 잠겨 있다', async () => {
    open({ title: '회원가입' })
    const over = open({ title: '이용약관' })
    await over.setProps({ open: false })
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('마지막 하나까지 닫히면 뒤 페이지가 풀린다', async () => {
    const under = open({ title: '회원가입' })
    const over = open({ title: '이용약관' })
    await over.setProps({ open: false })
    await under.setProps({ open: false })
    expect(document.body.style.overflow).toBe('')
  })

  it('role과 aria가 붙는다', () => {
    open()
    const el = document.querySelector('[data-test=modal]')!
    expect(el.getAttribute('role')).toBe('dialog')
    expect(el.getAttribute('aria-modal')).toBe('true')
  })
})
