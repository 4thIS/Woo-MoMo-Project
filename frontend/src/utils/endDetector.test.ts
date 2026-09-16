import { expect, it } from 'vitest'
import { END_PHRASE, hasEndPhrase } from './endDetector'

it('종료 문장을 감지한다', () => {
  expect(hasEndPhrase(`수고하셨습니다. ${END_PHRASE}.`)).toBe(true)
})
it('없으면 false', () => expect(hasEndPhrase('다음 질문입니다.')).toBe(false))
it('공백 변형도 감지한다', () => expect(hasEndPhrase('면접을  마치겠습니다')).toBe(true))
