/** 토스페이먼츠 결제창 — **목업** (spec 7.2).
 *
 * 흐름은 실물을 그대로 따른다(개발자센터 "결제창 연동"):
 * 주문서에서 `requestPayment()` → 결제창이 뜨고 → 인증이 끝나면
 * `paymentKey`·`orderId`·`amount`가 돌아오고 → 그 셋으로 **승인**을 부른다.
 * 실물은 `successUrl`로 리다이렉트하지만, 서버가 없으니 창이 `postMessage`로 돌려준다.
 *
 * 승인(= 티켓 지급)은 여기서 하지 않는다. 이 서비스는 **인증까지**만 책임진다.
 */

/** 결제창을 띄우는 주소. 같은 오리진이라야 결과 메시지를 믿을 수 있다 */
export const PAY_PAGE = '/pay/toss-mock.html'
export const PAY_ORIGIN = typeof location === 'undefined' ? '' : location.origin
/** 닫힌 창을 알아채는 주기. 실물 SDK도 같은 식으로 취소를 감지한다 */
const CLOSE_POLL_MS = 400

export type TossErrorCode =
  'POPUP_BLOCKED' | 'PAY_PROCESS_CANCELED' | 'PAY_PROCESS_ABORTED' | 'REJECT_CARD_COMPANY'

/** 화면은 code로 분기하고 message를 그대로 보여 준다 */
export class TossError extends Error {
  constructor(
    readonly code: TossErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'TossError'
  }
}

const FALLBACK: Record<string, string> = {
  POPUP_BLOCKED: '결제창이 열리지 않았습니다 — 브라우저의 팝업 차단을 풀고 다시 시도하세요',
  PAY_PROCESS_CANCELED: '결제를 취소했습니다',
  PAY_PROCESS_ABORTED: '결제에 실패했습니다',
  REJECT_CARD_COMPANY: '카드사가 결제를 거절했습니다',
}

export interface PaymentRequest {
  amount: number
  orderName: string
  customerName?: string
}

/** 승인에 넣을 값 셋. 실물과 같은 이름을 쓴다 — 서버가 오면 그대로 보낸다 */
export interface PaymentResult {
  paymentKey: string
  orderId: string
  amount: number
}

/** 주문마다 새로. 같은 번호를 두 번 쓰면 실물 서버는 FORBIDDEN_REQUEST로 거절한다 */
function newOrderId(): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `momo_${Date.now().toString(36)}_${rand}`
}

export function requestPayment(req: PaymentRequest): Promise<PaymentResult> {
  const orderId = newOrderId()
  const url =
    `${PAY_PAGE}?orderId=${encodeURIComponent(orderId)}` +
    `&amount=${req.amount}` +
    `&orderName=${encodeURIComponent(req.orderName)}` +
    (req.customerName ? `&customerName=${encodeURIComponent(req.customerName)}` : '')

  // 결제창 크기는 실물과 비슷하게. 가운데로 띄우는 계산은 화면이 없을 수도 있어 감싼다
  const w = 480
  const h = 660
  let pos = ''
  try {
    pos = `,left=${Math.max(0, Math.round(screen.width / 2 - w / 2))},top=${Math.max(0, Math.round(screen.height / 2 - h / 2))}`
  } catch {
    /* screen이 없는 환경 */
  }
  const win = window.open(url, 'toss-payment', `width=${w},height=${h},resizable=no${pos}`)
  if (!win) return Promise.reject(new TossError('POPUP_BLOCKED', FALLBACK.POPUP_BLOCKED))

  return new Promise<PaymentResult>((resolve, reject) => {
    let settled = false

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMessage)
      clearInterval(timer)
      try {
        win.close()
      } catch {
        /* 이미 닫힌 창 */
      }
      fn()
    }

    function onMessage(e: MessageEvent) {
      // 출처와 주문 번호를 둘 다 본다 — 앞 결제창이 늦게 보낸 메시지를 이번 결과로 믿으면 안 된다
      if (e.origin !== PAY_ORIGIN) return
      const d = e.data as Record<string, unknown> | null
      if (!d || d.source !== 'momo-toss-mock' || d.orderId !== orderId) return
      if (d.status === 'success') {
        finish(() =>
          resolve({
            paymentKey: String(d.paymentKey ?? `mock_${orderId}`),
            orderId,
            amount: req.amount,
          }),
        )
        return
      }
      const code = (d.code as TossErrorCode) ?? 'PAY_PROCESS_ABORTED'
      finish(() => reject(new TossError(code, String(d.message ?? FALLBACK[code] ?? '결제 실패'))))
    }

    window.addEventListener('message', onMessage)

    // 창을 그냥 닫은 것도 취소다. 실물도 이때 PAY_PROCESS_CANCELED를 준다
    const timer = setInterval(() => {
      if (!win.closed) return
      finish(() => reject(new TossError('PAY_PROCESS_CANCELED', FALLBACK.PAY_PROCESS_CANCELED)))
    }, CLOSE_POLL_MS)
  })
}
