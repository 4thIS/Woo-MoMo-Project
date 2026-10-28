import { describe, expect, it } from 'vitest'
import { checkPassword, PASSWORD_MAX, PASSWORD_MIN } from './password'

describe('checkPassword — 가입 비밀번호 규칙', () => {
  it('길이·영문숫자·공백 세 가지를 따로 알려 준다', () => {
    expect(checkPassword('abc12345')).toEqual({
      length: true,
      letterDigit: true,
      noSpace: true,
      ok: true,
    })
  })

  it('8자 미만은 길이에서 걸린다', () => {
    const r = checkPassword('abc1234')
    expect(r.length).toBe(false)
    expect(r.ok).toBe(false)
  })

  it('64자까지 받고 그 위는 막는다 — 서버와 같은 상한', () => {
    expect(checkPassword('a1'.repeat(PASSWORD_MAX / 2)).length).toBe(true)
    expect(checkPassword('a1'.repeat(PASSWORD_MAX / 2) + 'x').length).toBe(false)
  })

  it('영문만·숫자만은 통과하지 못한다', () => {
    expect(checkPassword('abcdefgh').letterDigit).toBe(false)
    expect(checkPassword('12345678').letterDigit).toBe(false)
  })

  it('공백이 하나라도 있으면 걸린다 — 가운데도, 끝도', () => {
    expect(checkPassword('abc 12345').noSpace).toBe(false)
    expect(checkPassword('abc12345 ').noSpace).toBe(false)
    expect(checkPassword('abc\t12345').noSpace).toBe(false)
  })

  it('특수문자는 넣어도 되고 안 넣어도 된다', () => {
    expect(checkPassword('abc12345!').ok).toBe(true)
    expect(checkPassword('abc12345').ok).toBe(true)
  })

  it('빈 값은 셋 다 실패 — 아직 아무것도 안 쳤을 때 전부 꺼져 보인다', () => {
    expect(checkPassword('')).toEqual({
      length: false,
      letterDigit: false,
      noSpace: true,
      ok: false,
    })
  })

  it('상한·하한 값이 서버 규칙과 같다', () => {
    expect(PASSWORD_MIN).toBe(8)
    expect(PASSWORD_MAX).toBe(64)
  })
})
