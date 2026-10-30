import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PixelAudio from './PixelAudio.vue'

/** jsdom에는 재생 기능이 없다 — 호출됐는지만 본다 */
const play = vi.fn(() => Promise.resolve())
const pause = vi.fn()

beforeEach(() => {
  play.mockClear()
  pause.mockClear()
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { value: play, configurable: true })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { value: pause, configurable: true })
})

const player = (src = '/clip.webm') =>
  mount(PixelAudio, { props: { src, label: '답변 1 녹음' }, attachTo: document.body })

/** 메타데이터가 도착한 것처럼 꾸민다 */
function withDuration(w: ReturnType<typeof player>, seconds: number) {
  const el = w.get('audio').element as HTMLAudioElement
  Object.defineProperty(el, 'duration', { value: seconds, configurable: true })
  el.dispatchEvent(new Event('loadedmetadata'))
}

describe('PixelAudio', () => {
  it('브라우저 기본 재생바를 쓰지 않는다 — controls 없이 직접 그린다', () => {
    const w = player()
    expect(w.get('audio').attributes('controls')).toBeUndefined()
    expect(w.find('[data-test=audio-toggle]').exists()).toBe(true)
    expect(w.find('[data-test=audio-bar]').exists()).toBe(true)
  })

  it('미리 받아 두지 않는다 — 보관함에 기록이 여럿이다', () => {
    expect(player().get('audio').attributes('preload')).toBe('none')
  })

  it('누르면 재생하고, 다시 누르면 멈춘다', async () => {
    const w = player()
    await w.get('[data-test=audio-toggle]').trigger('click')
    expect(play).toHaveBeenCalled()
    w.get('audio').element.dispatchEvent(new Event('play'))
    await w.vm.$nextTick()
    await w.get('[data-test=audio-toggle]').trigger('click')
    expect(pause).toHaveBeenCalled()
  })

  it('길이를 알면 0:00 / 0:47처럼 보여 준다', async () => {
    const w = player()
    withDuration(w, 47)
    await w.vm.$nextTick()
    expect(w.get('[data-test=audio-time]').text()).toBe('00:00 / 00:47')
  })

  it('막대를 누르면 그 지점으로 옮긴다', async () => {
    const w = player()
    withDuration(w, 100)
    await w.vm.$nextTick()
    const bar = w.get('[data-test=audio-bar]')
    bar.element.getBoundingClientRect = () =>
      ({ left: 0, width: 200, top: 0, height: 4, right: 200, bottom: 4, x: 0, y: 0 }) as DOMRect
    // vue-test-utils는 clientX를 넣지 못한다(읽기 전용) — 이벤트를 직접 만든다
    bar.element.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, bubbles: true }))
    await w.vm.$nextTick()
    expect((w.get('audio').element as HTMLAudioElement).currentTime).toBe(50)
  })

  it('다른 클립을 재생하면 앞의 것이 멈춘다', async () => {
    const a = player('/a.webm')
    const b = player('/b.webm')
    const aEl = a.get('audio').element as HTMLAudioElement
    const aPause = vi.spyOn(aEl, 'pause')
    await a.get('[data-test=audio-toggle]').trigger('click')
    aEl.dispatchEvent(new Event('play'))
    await b.get('[data-test=audio-toggle]').trigger('click')
    expect(aPause).toHaveBeenCalled()
    a.unmount()
    b.unmount()
  })

  it('읽어 줄 이름이 붙는다', () => {
    expect(player().get('[data-test=audio-toggle]').attributes('aria-label')).toContain(
      '답변 1 녹음',
    )
  })
})

describe('PixelAudio — 미리 받은 길이', () => {
  const withDur = (sec: number | null) =>
    mount(PixelAudio, { props: { src: '/clip.webm', duration: sec }, attachTo: document.body })

  it('길이를 받으면 재생 전부터 보여 준다 — webm은 끝까지 읽어야 길이를 안다', () => {
    expect(withDur(47).get('[data-test=audio-time]').text()).toBe('00:00 / 00:47')
  })

  it('길이를 모르면 --:-- 로 둔다 — 00:00은 길이가 0인 것처럼 보인다', () => {
    expect(withDur(null).get('[data-test=audio-time]').text()).toBe('00:00 / --:--')
  })

  it('메타데이터가 진짜 길이를 알려 주면 그 값을 쓴다', async () => {
    const w = withDur(47)
    const el = w.get('audio').element as HTMLAudioElement
    Object.defineProperty(el, 'duration', { value: 50, configurable: true })
    el.dispatchEvent(new Event('loadedmetadata'))
    await w.vm.$nextTick()
    expect(w.get('[data-test=audio-time]').text()).toBe('00:00 / 00:50')
  })

  it('메타데이터가 Infinity면 받아 둔 길이를 지킨다', async () => {
    const w = withDur(47)
    const el = w.get('audio').element as HTMLAudioElement
    Object.defineProperty(el, 'duration', { value: Infinity, configurable: true })
    el.dispatchEvent(new Event('loadedmetadata'))
    await w.vm.$nextTick()
    expect(w.get('[data-test=audio-time]').text()).toBe('00:00 / 00:47')
  })
})
