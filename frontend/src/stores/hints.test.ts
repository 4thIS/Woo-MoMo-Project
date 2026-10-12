import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useHintsStore, SEEN_KEY, OFF_KEY } from './hints'

describe('hints 스토어', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('처음에는 켜져 있고 본 것이 없다', () => {
    const h = useHintsStore()
    expect(h.enabled).toBe(true)
    expect(h.seen).toEqual([])
  })

  it('본 키를 기록하고 저장한다', () => {
    const h = useHintsStore()
    h.markSeen('prepare-resume')
    expect(h.seen).toContain('prepare-resume')
    expect(localStorage.getItem(SEEN_KEY)).toContain('prepare-resume')
  })

  it('같은 키를 두 번 기록해도 하나다', () => {
    const h = useHintsStore()
    h.markSeen('report-read')
    h.markSeen('report-read')
    expect(h.seen.filter((k) => k === 'report-read')).toHaveLength(1)
  })

  it('저장된 것을 다음 방문에 읽어 온다', () => {
    localStorage.setItem(SEEN_KEY, JSON.stringify(['go-prepare']))
    localStorage.setItem(OFF_KEY, '1')
    const h = useHintsStore()
    expect(h.seen).toEqual(['go-prepare'])
    expect(h.enabled).toBe(false)
  })

  it('전부 끄고 다시 켤 수 있다', () => {
    const h = useHintsStore()
    h.disable()
    expect(h.enabled).toBe(false)
    expect(localStorage.getItem(OFF_KEY)).toBe('1')
    h.enable()
    expect(h.enabled).toBe(true)
    expect(localStorage.getItem(OFF_KEY)).toBe('0')
  })

  it('다시 켜면 본 기록도 비워 처음부터 다시 따라갈 수 있다', () => {
    const h = useHintsStore()
    h.markSeen('prepare-start')
    h.disable()
    h.enable()
    expect(h.seen).toEqual([])
  })

  it('저장된 값이 깨져 있어도 던지지 않는다', () => {
    localStorage.setItem(SEEN_KEY, '{not json')
    const h = useHintsStore()
    expect(h.seen).toEqual([])
  })

  it('저장된 값이 배열이 아니면 무시한다', () => {
    localStorage.setItem(SEEN_KEY, '{"a":1}')
    expect(useHintsStore().seen).toEqual([])
  })
})

describe('hints 스토어 — localStorage가 막힌 브라우저', () => {
  afterEach(() => vi.restoreAllMocks())

  it('읽기가 던져도 기본값으로 뜬다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    setActivePinia(createPinia())
    const h = useHintsStore()
    expect(h.enabled).toBe(true)
    expect(h.seen).toEqual([])
  })

  it('쓰기가 던져도 화면 상태는 바뀐다', () => {
    setActivePinia(createPinia())
    const h = useHintsStore()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => h.markSeen('x')).not.toThrow()
    expect(h.seen).toContain('x')
    expect(() => h.disable()).not.toThrow()
    expect(h.enabled).toBe(false)
  })
})
