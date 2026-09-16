import { describe, expect, it } from 'vitest'
import { ThoughtFilter, stripThoughts } from './thoughts'

describe('stripThoughts', () => {
  it('완결된 thought 블록을 지운다', () => {
    expect(stripThoughts('안녕<|channel>thought 생각 중<channel|>하세요')).toBe('안녕하세요')
  })
  it('태그가 없으면 그대로', () => {
    expect(stripThoughts('그대로')).toBe('그대로')
  })
})

describe('ThoughtFilter', () => {
  it('청크 경계에 걸친 태그도 숨긴다', () => {
    const f = new ThoughtFilter()
    const out = ['안녕<|chan', 'nel>thought 숨김', ' 계속<chan', 'nel|>하세요']
      .map((c) => f.push(c))
      .join('')
    expect(out + f.flush()).toBe('안녕하세요')
  })
  it('열린 태그가 닫히지 않으면 내부는 끝까지 보류한다', () => {
    const f = new ThoughtFilter()
    expect(f.push('질문<|channel>thought 아직')).toBe('질문')
    expect(f.flush()).toBe('')
  })
  it('태그 접두처럼 보이던 문자가 태그가 아니면 내보낸다', () => {
    const f = new ThoughtFilter()
    expect(f.push('a<') + f.push('b')).toBe('a<b')
  })
})
