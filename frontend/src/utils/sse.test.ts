import { describe, it, expect } from 'vitest'
import { SseParser } from './sse'

/** 넣은 조각들을 순서대로 흘려 넣고 나온 이벤트를 모은다 */
function feed(...chunks: string[]) {
  const out: { event: string; data: string }[] = []
  const p = new SseParser((e) => out.push(e))
  for (const c of chunks) p.push(c)
  return out
}

describe('SseParser', () => {
  it('event와 data를 짝지어 낸다', () => {
    expect(feed('event: delta\ndata: {"text":"안녕"}\n\n')).toEqual([
      { event: 'delta', data: '{"text":"안녕"}' },
    ])
  })

  it('조각이 줄 중간에서 끊겨도 이어 붙인다 — 스트림은 줄 단위로 오지 않는다', () => {
    expect(feed('event: del', 'ta\ndata: {"tex', 't":"안녕"}\n\n')).toEqual([
      { event: 'delta', data: '{"text":"안녕"}' },
    ])
  })

  it('주석 줄은 버린다 — 맨 앞 `: ping`이 이벤트로 새면 안 된다', () => {
    expect(feed(': ping\n\nevent: done\ndata: {}\n\n')).toEqual([{ event: 'done', data: '{}' }])
  })

  it('event가 없으면 message다 — SSE 기본값', () => {
    expect(feed('data: 하나\n\n')).toEqual([{ event: 'message', data: '하나' }])
  })

  it('data가 여러 줄이면 줄바꿈으로 잇는다', () => {
    expect(feed('data: 첫째\ndata: 둘째\n\n')).toEqual([{ event: 'message', data: '첫째\n둘째' }])
  })

  it('이벤트를 여러 개 연달아 낸다', () => {
    expect(feed('event: delta\ndata: 1\n\nevent: delta\ndata: 2\n\n')).toEqual([
      { event: 'delta', data: '1' },
      { event: 'delta', data: '2' },
    ])
  })

  it('CRLF도 받는다 — 프록시가 줄 끝을 바꿔 놓기도 한다', () => {
    expect(feed('event: done\r\ndata: {}\r\n\r\n')).toEqual([{ event: 'done', data: '{}' }])
  })

  it('콜론 뒤 공백은 하나만 뗀다 — JSON 안의 공백까지 건드리면 안 된다', () => {
    expect(feed('data:  앞에공백\n\n')).toEqual([{ event: 'message', data: ' 앞에공백' }])
  })

  it('빈 줄로 끝나지 않은 마지막 토막은 내지 않는다 — 끊긴 이벤트를 반쪽으로 쓰면 안 된다', () => {
    expect(feed('event: delta\ndata: 반쪽')).toEqual([])
  })
})
