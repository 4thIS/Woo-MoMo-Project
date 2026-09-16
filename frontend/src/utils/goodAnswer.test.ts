import { expect, it } from 'vitest'
import { isGoodAnswer } from './goodAnswer'

const long = '저는 백엔드 개발자로 3년간 일했습니다. '.repeat(7) // 161자, 문장 7개
it('150자 이상 + 문장 2개 이상이면 true', () => expect(isGoodAnswer(long)).toBe(true))
it('짧으면 false', () => expect(isGoodAnswer('네. 그렇습니다.')).toBe(false))
it('길어도 문장 1개면 false', () => expect(isGoodAnswer('가'.repeat(200))).toBe(false))
