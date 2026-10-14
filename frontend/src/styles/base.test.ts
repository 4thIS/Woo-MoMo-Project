import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const base = readFileSync(join(__dirname, 'base.css'), 'utf8')
/** 주석은 걷어 낸다 — 규칙 앞 주석이 선택자에 붙어 이름 비교가 어긋난다 */
const bare = base.replace(/\/\*[\s\S]*?\*\//g, '')
/** 그 선택자를 포함한 **모든** 규칙의 본문을 모은다.
 *  하나만 집으면 `html, body {}`처럼 묶인 규칙을 놓쳐 통과해 버린다 */
function block(selector: string, css: string = bare): string {
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
    expect(block('body')).not.toMatch(/--hint-space/)
  })

  it('화면마다 스크롤바 모양이 다르지 않게 전역으로 한 번만 정한다', () => {
    expect(base).toMatch(/::-webkit-scrollbar\b/)
    expect(base).toMatch(/scrollbar-color:/)
  })

  it('안쪽 스크롤러는 양쪽에 같은 자리를 둔다 — 안 그러면 화면 아래 가이드가 치우친다', () => {
    // 스크롤바가 .snap-root 안에 있으면 내용은 (뷰포트 − 스크롤바) 안에서 가운데 정렬되는데,
    // 바깥의 fixed 가이드 바는 뷰포트 기준이라 스크롤바 폭의 **절반**만큼 오른쪽으로 밀린다
    expect(block('.snap-root')).toMatch(/scrollbar-gutter:\s*stable both-edges/)
  })

  it('스크롤바도 각진 어법을 따른다 — 둥근 기본 막대는 픽셀 창과 따로 논다', () => {
    expect(block('::-webkit-scrollbar-thumb')).not.toMatch(/border-radius/)
  })
})
