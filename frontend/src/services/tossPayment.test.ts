import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestPayment, TossError, PAY_ORIGIN } from './tossPayment'

/** 열린 팝업 흉내. closed를 직접 뒤집어 "사용자가 창을 닫았다"를 만든다 */
function fakeWindow() {
  return { closed: false, close: vi.fn(), focus: vi.fn() }
}

let win: ReturnType<typeof fakeWindow> | null
let opened: string[] = []

beforeEach(() => {
  vi.useFakeTimers()
  win = fakeWindow()
  opened = []
  vi.stubGlobal('open', (url: string) => {
    opened.push(url)
    return win
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** 결제창이 보내오는 메시지 */
function reply(body: Record<string, unknown>, origin = PAY_ORIGIN) {
  window.dispatchEvent(new MessageEvent('message', { data: body, origin }))
}

const req = { amount: 4900, orderName: '모모 프리미엄 티켓 10회' }

describe('requestPayment — 결제창을 띄우고 결과를 기다린다', () => {
  it('주문 번호와 금액을 결제창에 넘긴다', async () => {
    const p = requestPayment(req)
    const url = new URL(opened[0], location.origin)
    expect(url.searchParams.get('amount')).toBe('4900')
    expect(url.searchParams.get('orderName')).toBe('모모 프리미엄 티켓 10회')
    expect(url.searchParams.get('orderId')).toMatch(/^momo_/)
    reply({ source: 'momo-toss-mock', status: 'success', orderId: url.searchParams.get('orderId') })
    await expect(p).resolves.toMatchObject({ amount: 4900 })
  })

  it('주문마다 번호가 다르다 — 같은 번호면 서버가 거절한다', async () => {
    requestPayment(req)
    requestPayment(req)
    const id = (u: string) => new URL(u, location.origin).searchParams.get('orderId')
    expect(id(opened[0])).not.toBe(id(opened[1]))
  })

  it('성공하면 승인에 필요한 값 셋을 돌려준다', async () => {
    const p = requestPayment(req)
    const orderId = new URL(opened[0], location.origin).searchParams.get('orderId')
    reply({ source: 'momo-toss-mock', status: 'success', orderId })
    const r = await p
    expect(r.orderId).toBe(orderId)
    expect(r.amount).toBe(4900)
    expect(r.paymentKey).toMatch(/\S/)
  })

  it('팝업이 막히면 POPUP_BLOCKED로 알린다 — 조용히 실패하지 않는다', async () => {
    vi.stubGlobal('open', () => null)
    await expect(requestPayment(req)).rejects.toMatchObject({ code: 'POPUP_BLOCKED' })
  })

  it('사용자가 결제창을 닫으면 PAY_PROCESS_CANCELED다', async () => {
    // 거부 핸들러를 **타이머를 돌리기 전에** 붙인다 — 나중에 붙이면 그 사이에
    // unhandled rejection으로 잡혀 테스트는 통과해도 실행이 실패한다
    const p = expect(requestPayment(req)).rejects.toMatchObject({
      code: 'PAY_PROCESS_CANCELED',
    })
    win!.closed = true
    await vi.advanceTimersByTimeAsync(1000)
    await p
  })

  it('결제창이 실패를 알리면 그 코드를 그대로 전한다', async () => {
    const p = requestPayment(req)
    const orderId = new URL(opened[0], location.origin).searchParams.get('orderId')
    reply({
      source: 'momo-toss-mock',
      status: 'fail',
      orderId,
      code: 'REJECT_CARD_COMPANY',
      message: '카드사가 거절했습니다',
    })
    await expect(p).rejects.toMatchObject({ code: 'REJECT_CARD_COMPANY' })
  })

  it('다른 출처의 메시지는 무시한다', async () => {
    const p = requestPayment(req)
    const orderId = new URL(opened[0], location.origin).searchParams.get('orderId')
    reply({ source: 'momo-toss-mock', status: 'success', orderId }, 'https://evil.example')
    let settled = false
    void p.then(
      () => (settled = true),
      () => (settled = true),
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(settled).toBe(false)
    const done = expect(p).rejects.toMatchObject({ code: 'PAY_PROCESS_CANCELED' })
    win!.closed = true
    await vi.advanceTimersByTimeAsync(1000)
    await done
  })

  it('다른 주문의 메시지는 무시한다 — 앞 결제창이 늦게 보낸 것일 수 있다', async () => {
    const p = requestPayment(req)
    reply({ source: 'momo-toss-mock', status: 'success', orderId: 'momo_다른주문' })
    let settled = false
    void p.then(
      () => (settled = true),
      () => (settled = true),
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(settled).toBe(false)
  })

  it('결과가 오면 결제창을 닫는다 — 빈 창을 남기지 않는다', async () => {
    const p = requestPayment(req)
    const orderId = new URL(opened[0], location.origin).searchParams.get('orderId')
    reply({ source: 'momo-toss-mock', status: 'success', orderId })
    await p
    expect(win!.close).toHaveBeenCalled()
  })

  it('TossError는 사용자에게 보여 줄 문구를 들고 있다', async () => {
    vi.stubGlobal('open', () => null)
    const e = await requestPayment(req).catch((x) => x)
    expect(e).toBeInstanceOf(TossError)
    expect(e.message).toMatch(/\S/)
  })
})
