import { describe, expect, it } from 'vitest'
import { joinTextItems, type TextItemLike } from './pdfText'

/** pdf.js getTextContent 아이템 흉내: x·폭·높이·EOL만 */
const it_ = (str: string, x: number, width: number, hasEOL = false): TextItemLike => ({
  str,
  width,
  height: 12,
  transform: [12, 0, 0, 12, x, 0],
  hasEOL,
})

describe('joinTextItems', () => {
  it('공백 아이템과 EOL을 그대로 쓰고, 아이템 사이에 공백을 끼워 넣지 않는다', () => {
    // 실제 덤프: "공개" "/" "노출" "," "변조" … "위협으" EOL "로부터"
    const items = [
      it_('공개', 0, 48),
      it_('/', 48, 9.5),
      it_('노출', 57.5, 48),
      it_(',', 105.5, 5.3),
      it_('변조', 110.8, 48),
      it_(' ', 158.8, 8.5),
      it_('위협으', 167.3, 72),
      it_('', 0, 0, true),
      it_('로부터', 0, 72),
    ]
    expect(joinTextItems(items)).toBe('공개/노출,변조 위협으\n로부터')
  })

  it('공백 아이템 없이 x 간격만 벌어진 단어 사이에는 공백을 넣는다', () => {
    const items = [it_('Hello', 0, 30), it_('World', 40, 30)]
    expect(joinTextItems(items)).toBe('Hello World')
  })

  it('붙어 있는 조각은 그대로 잇는다 (글리프 단위로 쪼개진 폰트)', () => {
    const items = [it_('안', 0, 12), it_('녕', 12, 12), it_('하', 24, 12)]
    expect(joinTextItems(items)).toBe('안녕하')
  })

  it('EOL 뒤 첫 아이템은 x가 되돌아가도 공백을 넣지 않는다', () => {
    const items = [it_('끝', 300, 12, true), it_('처음', 0, 24)]
    expect(joinTextItems(items)).toBe('끝\n처음')
  })

  it('연속 공백·빈 줄은 하나로 줄이고 앞뒤를 다듬는다', () => {
    const items = [
      it_(' ', 0, 5),
      it_('a', 5, 5),
      it_(' ', 10, 5),
      it_(' ', 15, 5),
      it_('b', 20, 5, true),
      it_('', 0, 0, true),
      it_('c', 0, 5),
    ]
    expect(joinTextItems(items)).toBe('a b\nc')
  })
})
