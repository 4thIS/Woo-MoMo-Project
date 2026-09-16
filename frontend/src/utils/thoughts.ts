const OPEN = '<|channel>thought'
const CLOSE = '<channel|>'

export function stripThoughts(text: string): string {
  return text.replace(/<\|channel>thought[\s\S]*?<channel\|>/g, '')
}

/** 스트리밍용. 열린 thought 구간은 닫힐 때까지 보류하고, 태그 접두일 수 있는 꼬리도 보류한다. */
export class ThoughtFilter {
  private buf = ''
  private inside = false

  push(delta: string): string {
    this.buf += delta
    let out = ''
    for (;;) {
      if (this.inside) {
        const end = this.buf.indexOf(CLOSE)
        if (end < 0) {
          this.buf = this.buf.slice(-(CLOSE.length - 1)) // 닫는 태그가 걸쳐 올 수 있는 꼬리만 유지
          return out
        }
        this.buf = this.buf.slice(end + CLOSE.length)
        this.inside = false
        continue
      }
      const start = this.buf.indexOf(OPEN)
      if (start >= 0) {
        out += this.buf.slice(0, start)
        this.buf = this.buf.slice(start + OPEN.length)
        this.inside = true
        continue
      }
      // 태그의 접두가 될 수 있는 꼬리('<', '<|', '<|chan'...)는 보류
      const keep = tailPrefixLength(this.buf, OPEN)
      out += this.buf.slice(0, this.buf.length - keep)
      this.buf = this.buf.slice(this.buf.length - keep)
      return out
    }
  }

  flush(): string {
    if (this.inside) {
      this.buf = ''
      return ''
    }
    const rest = this.buf
    this.buf = ''
    return rest
  }
}

function tailPrefixLength(s: string, tag: string): number {
  const max = Math.min(s.length, tag.length - 1)
  for (let n = max; n > 0; n--) if (tag.startsWith(s.slice(s.length - n))) return n
  return 0
}
