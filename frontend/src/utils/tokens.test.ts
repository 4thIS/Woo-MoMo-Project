import { expect, it } from 'vitest'
import { approxTokens } from './tokens'

it('한글 1자 = 1토큰', () => expect(approxTokens('가나다')).toBe(3))
it('그 외 4자 = 1토큰(올림)', () => expect(approxTokens('abcde')).toBe(2))
it('혼합', () => expect(approxTokens('가나 ab')).toBe(2 + 1))
it('빈 문자열은 0', () => expect(approxTokens('')).toBe(0))
