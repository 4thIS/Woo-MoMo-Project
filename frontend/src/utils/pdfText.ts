/** pdf.js `TextItem`에서 이 함수가 쓰는 필드만 */
export interface TextItemLike {
  str: string
  width: number
  height: number
  transform: number[]
  hasEOL: boolean
}

/** 앞 아이템 끝과 다음 아이템 시작 사이가 글자 높이의 이 비율보다 벌어지면 단어 사이로 본다 */
const GAP_RATIO = 0.2

/**
 * getTextContent 아이템을 문서 텍스트로 잇는다.
 * pdf.js는 공백을 " " 아이템으로, 줄바꿈을 hasEOL로 주므로 아이템 사이에 임의로 공백을 넣지 않는다.
 * 공백 글리프가 없는 폰트를 위해 같은 줄에서 x 간격이 벌어진 곳에만 공백을 보탠다.
 */
export function joinTextItems(items: TextItemLike[]): string {
  let out = ''
  let prev: TextItemLike | null = null
  for (const it of items) {
    if (prev && !prev.hasEOL && it.str && prev.str) {
      const gap = it.transform[4] - (prev.transform[4] + prev.width)
      const h = Math.max(it.height, Math.abs(it.transform[3]), 1)
      if (gap > h * GAP_RATIO && !/\s$/.test(out) && !/^\s/.test(it.str)) out += ' '
    }
    out += it.str
    if (it.hasEOL) out += '\n'
    prev = it
  }
  return out
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}
