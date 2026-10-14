import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const base = readFileSync(join(__dirname, 'base.css'), 'utf8')
/** 그 선택자를 포함한 **모든** 규칙의 본문을 모은다.
 *  하나만 집으면 `html, body {}`처럼 묶인 규칙을 놓쳐 통과해 버린다 */
function block(css: string, selector: string): string {
  const out: string[] = []
  let head = ''
  let depth = 0
  let open = 0
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (c === '{') {
      if (depth === 0) open = i
      depth++
    } else if (c === '}') {
      depth--
      if (depth !== 0) continue
      const names = head.split(',').map((x) => x.trim())
      if (names.includes(selector)) out.push(css.slice(open + 1, i))
      head = ''
    } else if (depth === 0) head += c
  }
  return out.join('\n')
}

describe('base.css — 스크롤', () => {
  it('body는 힌트 바 높이를 패딩으로 먹지 않는다 — 스크롤바가 둘이 된다', () => {
    // 화면 하나가 이미 100vh 스크롤러(.snap-root·면접 화면)인데 body까지 길어지면
    // 바깥 스크롤바가 하나 더 생겨 둘이 겹친다. 자리는 **실제로 스크롤하는 쪽**이 비운다
    expect(block(base, 'body')).not.toMatch(/--hint-space/)
  })

  it('화면마다 스크롤바 모양이 다르지 않게 전역으로 한 번만 정한다', () => {
    expect(base).toMatch(/::-webkit-scrollbar\b/)
    expect(base).toMatch(/scrollbar-color:/)
  })

  it('스크롤바도 각진 어법을 따른다 — 둥근 기본 막대는 픽셀 창과 따로 논다', () => {
    expect(block(base, '::-webkit-scrollbar-thumb')).not.toMatch(/border-radius/)
  })
})
