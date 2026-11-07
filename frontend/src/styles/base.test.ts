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

  it('섹션을 한 화면에 가두지 않는다 — 내용이 길면 그냥 더 스크롤된다', () => {
    // 100vh + mandatory 스냅이면 섹션이 화면보다 길 때 아랫부분에 닿을 방법이 없다
    expect(block('.snap')).not.toMatch(/min-height/)
    expect(base).not.toMatch(/scroll-snap-type:\s*y/)
  })

  it('스크롤러는 문서 하나다 — 요소 스크롤러를 두면 스크롤바가 둘이 된다', () => {
    // 안쪽 스크롤러가 있으면 내용은 (뷰포트 − 스크롤바) 안에서 가운데 정렬되는데,
    // 바깥의 fixed 가이드 바는 뷰포트 기준이라 스크롤바 폭의 **절반**만큼 어긋난다
    expect(block('.snap-root')).not.toMatch(/overflow-y:\s*auto/)
    expect(block('.snap-root')).not.toMatch(/height:\s*100vh/)
  })

  it('앵커로 이동할 때 상단바에 가리지 않게 문서가 자리를 비운다', () => {
    expect(block('html')).toMatch(/scroll-padding-top/)
  })

  it('크롬에서만 도는 스크롤 타임라인을 기본 경험에 두지 않는다', () => {
    // animation-timeline: view()는 크롬 계열 전용이다. 사파리·파이어폭스에서는
    // 아무 일도 일어나지 않아 브라우저마다 다른 화면이 된다
    expect(base).not.toMatch(/animation-timeline/)
    expect(base).not.toMatch(/animation-range/)
  })

  it('스크롤을 재촉하는 바닥 화살표를 두지 않는다', () => {
    expect(base).not.toMatch(/@keyframes bob/)
  })

  it('스크롤바도 각진 어법을 따른다 — 둥근 기본 막대는 픽셀 창과 따로 논다', () => {
    expect(block('::-webkit-scrollbar-thumb')).not.toMatch(/border-radius/)
  })
})
