/** 가입 비밀번호 규칙 (`docs/specs/backend/2026-10-28-signup-policy-terms-design.md`).
 *
 * **가입에만** 쓴다 — 기존 계정은 예전 규칙으로 만든 비밀번호라 로그인은 그대로 둔다.
 * 서버가 최종 판정하지만, 치는 동안 어느 조건이 남았는지 보여 주려고 같은 규칙을 여기에도 둔다.
 */

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 64

export interface PasswordCheck {
  /** 8~64자인가 */
  length: boolean
  /** 영문과 숫자가 모두 들어 있는가 */
  letterDigit: boolean
  /** 공백이 없는가 (빈 값도 공백은 없는 것으로 친다) */
  noSpace: boolean
  /** 셋 다 통과 */
  ok: boolean
}

export function checkPassword(pw: string): PasswordCheck {
  const length = pw.length >= PASSWORD_MIN && pw.length <= PASSWORD_MAX
  const letterDigit = /[A-Za-z]/.test(pw) && /\d/.test(pw)
  const noSpace = !/\s/.test(pw)
  return { length, letterDigit, noSpace, ok: length && letterDigit && noSpace }
}
