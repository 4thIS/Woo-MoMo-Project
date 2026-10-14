/** SSE(Server-Sent Events) 줄 파서 — 순수 함수 (`docs/API.md` 벤 면접 3단계).
 *
 * 네트워크는 줄 단위로 오지 않는다. 조각을 넣는 대로 모아 두었다가 **빈 줄**이 나올 때
 * 이벤트 하나를 낸다. `:`로 시작하는 주석(맨 앞 `: ping`)은 버린다.
 */

export interface SseEvent {
  /** `event:`가 없으면 SSE 기본값인 'message' */
  event: string
  /** `data:` 줄을 줄바꿈으로 이은 것 */
  data: string
}

export class SseParser {
  private buf = ''
  private event = ''
  private data: string[] = []

  constructor(private readonly onEvent: (e: SseEvent) => void) {}

  push(chunk: string): void {
    this.buf += chunk
    let at: number
    // 줄 끝은 \n으로 맞춘다 — 프록시가 CRLF로 바꿔 놓기도 한다
    while ((at = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, at).replace(/\r$/, '')
      this.buf = this.buf.slice(at + 1)
      this.line(line)
    }
  }

  private line(line: string): void {
    if (line === '') return this.flush()
    if (line.startsWith(':')) return // 주석
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    // 콜론 뒤 공백은 **하나만** 뗀다(SSE 규약). 더 떼면 데이터가 바뀐다
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') this.event = value
    else if (field === 'data') this.data.push(value)
    // id·retry 등 나머지 필드는 쓰지 않는다
  }

  private flush(): void {
    if (!this.data.length && !this.event) return
    this.onEvent({ event: this.event || 'message', data: this.data.join('\n') })
    this.event = ''
    this.data = []
  }
}
