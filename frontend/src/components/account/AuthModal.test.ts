import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AuthModal from './AuthModal.vue'
import { useAccountStore, setAccountApi } from '@/stores/account'
import { makeMockAccount } from '@/services/accountMock'
import { AccountError } from '@/services/account'

/** Teleport로 body에 붙으므로 끝나면 반드시 거둔다 — 안 그러면 다음 테스트의 querySelector가
 *  앞 테스트의 모달을 집는다 */
let mounted: ReturnType<typeof mount> | null = null
const modal = () => {
  mounted = mount(AuthModal, { props: { open: true }, attachTo: document.body })
  return mounted as ReturnType<typeof mount<typeof AuthModal>>
}

afterEach(() => {
  mounted?.unmount()
  mounted = null
})

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  setActivePinia(createPinia())
  setAccountApi(makeMockAccount({ delayMs: 0 }))
})

const q = <T extends Element = HTMLElement>(key: string) =>
  document.querySelector<T>(`[data-test=${key}]`)!
/** 목업은 delayMs 0이라도 setTimeout을 거친다. signIn처럼 서비스를 두 번 부르는 흐름은
 *  타이머도 두 번이라 한 바퀴로는 안 끝난다 — 넉넉히 돌린다 */
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0))
    await flushPromises()
  }
}
const text = (key: string) => q(key).textContent ?? ''
const set = async (key: string, value: string) => {
  const el = q<HTMLInputElement>(key)
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
}
const click = async (key: string) => {
  q<HTMLButtonElement>(key).click()
  await settle()
}

async function fill(email: string, pw: string, pw2?: string) {
  // 가입 탭이면 이름도 채운다 — 이름은 필수라 비우면 제출 전에 막힌다
  if (document.querySelector('[data-test=auth-name]')) await set('auth-name', '이우진')
  await set('auth-email', email)
  await set('auth-password', pw)
  if (pw2 !== undefined) await set('auth-password2', pw2)
}

describe('AuthModal — 탭', () => {
  it('기본은 로그인 탭이다 — 비밀번호 확인이 없다', () => {
    modal()
    expect(document.querySelector('[data-test=auth-password2]')).toBeNull()
  })

  it('회원가입 탭에는 비밀번호 확인과 저장 동의가 있다', async () => {
    modal()
    await click('auth-tab-signup')
    expect(document.querySelector('[data-test=auth-password2]')).not.toBeNull()
    expect(text('auth-consent')).toContain('서버에 저장')
    expect(text('auth-consent')).toContain('로그인하지 않으면')
  })

  it('탭을 바꾸면 오류가 지워진다', async () => {
    modal()
    await fill('none@b.com', 'pw123456')
    await click('auth-submit')
    expect(document.querySelector('[data-test=auth-error]')).not.toBeNull()
    await click('auth-tab-signup')
    expect(document.querySelector('[data-test=auth-error]')).toBeNull()
  })
})

describe('AuthModal — 회원가입', () => {
  it('가입하면 로그인되고 닫힌다', async () => {
    const w = modal()
    await click('auth-tab-signup')
    await fill('a@b.com', 'pw123456', 'pw123456')
    await click('auth-submit')
    expect(useAccountStore().signedIn).toBe(true)
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('비밀번호 확인이 다르면 보내지 않는다', async () => {
    modal()
    await click('auth-tab-signup')
    await fill('a@b.com', 'pw123456', 'different')
    await click('auth-submit')
    expect(text('auth-error')).toContain('비밀번호가 서로 다릅니다')
    expect(useAccountStore().signedIn).toBe(false)
  })

  it('짧은 비밀번호는 서비스가 거른다', async () => {
    modal()
    await click('auth-tab-signup')
    await fill('a@b.com', 'short', 'short')
    await click('auth-submit')
    expect(text('auth-error')).toContain('8~64자')
  })

  it('이미 쓰는 이메일이면 알려 준다', async () => {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456', '이우진')
    await a.signOut()
    modal()
    await click('auth-tab-signup')
    await fill('a@b.com', 'pw123456', 'pw123456')
    await click('auth-submit')
    expect(text('auth-error')).toContain('이미 가입된')
  })

  it('입력을 떠나면 중복을 미리 알려 준다', async () => {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456', '이우진')
    await a.signOut()
    modal()
    await click('auth-tab-signup')
    await set('auth-email', 'a@b.com')
    q('auth-email').dispatchEvent(new Event('blur', { bubbles: true }))
    await settle()
    expect(text('auth-error')).toContain('이미 가입된')
  })

  it('로그인 탭에서는 중복을 미리 보지 않는다 — 가입 여부를 흘리지 않는다', async () => {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456', '이우진')
    await a.signOut()
    modal()
    await set('auth-email', 'a@b.com')
    q('auth-email').dispatchEvent(new Event('blur', { bubbles: true }))
    await settle()
    expect(document.querySelector('[data-test=auth-error]')).toBeNull()
  })
})

describe('AuthModal — 로그인', () => {
  it('로그인하면 닫힌다', async () => {
    const a = useAccountStore()
    await a.signUp('a@b.com', 'pw123456', '이우진')
    await a.signOut()
    const w = modal()
    await fill('a@b.com', 'pw123456')
    await click('auth-submit')
    expect(useAccountStore().signedIn).toBe(true)
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('실패 문구는 계정 존재 여부를 흘리지 않는다', async () => {
    modal()
    await fill('none@b.com', 'pw123456')
    await click('auth-submit')
    expect(text('auth-error')).toBe('이메일 또는 비밀번호가 올바르지 않습니다')
  })

  it('구글로 계속하기도 로그인시킨다', async () => {
    const w = modal()
    await click('auth-google')
    expect(useAccountStore().signedIn).toBe(true)
    expect(w.emitted('close')).toHaveLength(1)
  })
})

describe('AuthModal — 보내는 동안', () => {
  it('버튼이 잠긴다', async () => {
    setAccountApi(makeMockAccount({ delayMs: 20 }))
    modal()
    await fill('a@b.com', 'pw123456')
    q<HTMLButtonElement>('auth-submit').click()
    await flushPromises()
    expect(q<HTMLButtonElement>('auth-submit').disabled).toBe(true)
    await new Promise((r) => setTimeout(r, 30))
    await flushPromises()
  })

  it('빈 칸이면 보내지 않는다', async () => {
    modal()
    await click('auth-submit')
    expect(useAccountStore().loading).toBe(false)
    expect(text('auth-error')).toContain('이메일과 비밀번호')
  })
})

describe('AuthModal — 다시 열 때', () => {
  it('닫았다 열면 입력과 오류가 비어 있다', async () => {
    const w = modal()
    await fill('none@b.com', 'pw123456')
    await click('auth-submit')
    expect(document.querySelector('[data-test=auth-error]')).not.toBeNull()
    await w.setProps({ open: false })
    await w.setProps({ open: true })
    expect(document.querySelector('[data-test=auth-error]')).toBeNull()
    expect(q<HTMLInputElement>('auth-email').value).toBe('')
  })
})

describe('AuthModal — 가입할 때 이름', () => {
  it('회원가입 탭에만 이름 칸이 있다', async () => {
    modal()
    expect(document.querySelector('[data-test=auth-name]')).toBeNull()
    await click('auth-tab-signup')
    expect(document.querySelector('[data-test=auth-name]')).not.toBeNull()
  })

  it('이름이 비면 가입하지 않는다', async () => {
    modal()
    await click('auth-tab-signup')
    await set('auth-email', 'a@b.com')
    await set('auth-password', 'pw123456')
    await set('auth-password2', 'pw123456')
    await click('auth-submit')
    expect(text('auth-error')).toContain('이름')
    expect(useAccountStore().signedIn).toBe(false)
  })

  it('이름을 넣고 가입하면 프로필에 남는다', async () => {
    modal()
    await click('auth-tab-signup')
    await set('auth-name', '이우진')
    await fill('a@b.com', 'pw123456', 'pw123456')
    await click('auth-submit')
    expect(useAccountStore().profile.name).toBe('이우진')
  })

  it('탭을 바꾸면 이름 칸이 비워진다 — 남은 값이 다음 가입에 따라붙지 않게', async () => {
    modal()
    await click('auth-tab-signup')
    await set('auth-name', '이우진')
    await click('auth-tab-signin')
    await click('auth-tab-signup')
    expect(q<HTMLInputElement>('auth-name').value).toBe('')
  })
})

/** 인증을 켠 서버를 흉내 낸다 — 목업은 기본이 꺼짐이라 여기서 갈아 끼운다 */
function verifyingApi(over: Partial<Record<string, unknown>> = {}) {
  const api = makeMockAccount({ delayMs: 0 })
  return {
    ...api,
    signupConfig: async () => ({ emailVerify: true }),
    sendSignupCode: async () => ({ expiresInSec: 600, resendInSec: 60 }),
    ...over,
  }
}

describe('AuthModal — 가입 이메일 인증', () => {
  it('인증이 꺼진 서버에서는 인증번호 칸이 없다', async () => {
    modal()
    await click('auth-tab-signup')
    expect(document.querySelector('[data-test=auth-send-code]')).toBeNull()
    expect(document.querySelector('[data-test=auth-code]')).toBeNull()
  })

  it('인증이 켜지면 받기 버튼이 생기고, 누르면 6자리 칸이 열린다', async () => {
    setAccountApi(verifyingApi())
    modal()
    await click('auth-tab-signup')
    expect(q('auth-send-code')).toBeTruthy()
    expect(document.querySelector('[data-test=auth-code]')).toBeNull()

    await set('auth-email', 'a@b.com')
    await click('auth-send-code')
    expect(q('auth-code')).toBeTruthy()
    expect(text('auth-code-hint')).toContain('10:00')
  })

  it('이메일이 비면 보내지 않는다', async () => {
    setAccountApi(verifyingApi())
    modal()
    await click('auth-tab-signup')
    await click('auth-send-code')
    expect(document.querySelector('[data-test=auth-code]')).toBeNull()
    expect(text('auth-error')).toContain('이메일')
  })

  it('이메일을 바꾸면 받아 둔 인증번호를 버린다 — 다른 이메일의 PIN은 맞지 않는다', async () => {
    setAccountApi(verifyingApi())
    modal()
    await click('auth-tab-signup')
    await set('auth-email', 'a@b.com')
    await click('auth-send-code')
    await set('auth-code', '123456')
    await set('auth-email', 'c@d.com')
    expect(document.querySelector('[data-test=auth-code]')).toBeNull()
  })

  it('가입할 때 인증번호를 함께 보낸다', async () => {
    let sent: unknown = null
    setAccountApi(
      verifyingApi({
        signUp: async (...args: unknown[]) => {
          sent = args[3]
          throw new AccountError('code_invalid', '인증번호가 맞지 않습니다')
        },
      }),
    )
    modal()
    await click('auth-tab-signup')
    await fill('a@b.com', 'pw123456', 'pw123456')
    await click('auth-send-code')
    await set('auth-code', '012345')
    await click('auth-submit')
    expect(sent).toMatchObject({ code: '012345' })
  })

  it('틀리면 남은 시도 수를 알려 준다', async () => {
    const e = new AccountError('code_invalid', '인증번호가 맞지 않습니다')
    e.attemptsLeft = 3
    setAccountApi(
      verifyingApi({
        signUp: async () => {
          throw e
        },
      }),
    )
    modal()
    await click('auth-tab-signup')
    await fill('a@b.com', 'pw123456', 'pw123456')
    await click('auth-send-code')
    await set('auth-code', '111111')
    await click('auth-submit')
    expect(text('auth-error')).toContain('3번')
  })

  it('너무 빨리 다시 받으면 기다릴 초를 보여 준다', async () => {
    const e = new AccountError('code_cooldown', '잠시 뒤에 다시 받을 수 있습니다')
    e.retryAfterSec = 40
    setAccountApi(
      verifyingApi({
        sendSignupCode: async () => {
          throw e
        },
      }),
    )
    modal()
    await click('auth-tab-signup')
    await set('auth-email', 'a@b.com')
    await click('auth-send-code')
    expect(q<HTMLButtonElement>('auth-send-code').disabled).toBe(true)
    expect(text('auth-send-code')).toContain('40')
  })
})

describe('AuthModal — 비밀번호 규칙', () => {
  it('가입 탭에서만 조건 세 개를 보여 준다', async () => {
    modal()
    expect(document.querySelector('[data-test=pw-rules]')).toBeNull()
    await click('auth-tab-signup')
    expect(q('pw-rules')).toBeTruthy()
  })

  it('치는 동안 통과한 조건에 표시가 켜진다', async () => {
    modal()
    await click('auth-tab-signup')
    await set('auth-password', 'abcdefgh')
    expect(q('pw-rule-length').className).toContain('on')
    expect(q('pw-rule-letter-digit').className).not.toContain('on')
    await set('auth-password', 'abcd1234')
    expect(q('pw-rule-letter-digit').className).toContain('on')
  })

  it('공백이 있으면 공백 조건이 꺼진다', async () => {
    modal()
    await click('auth-tab-signup')
    await set('auth-password', 'abcd 1234')
    expect(q('pw-rule-no-space').className).not.toContain('on')
  })

  it('규칙을 어기면 제출을 막는다 — 서버까지 가지 않는다', async () => {
    modal()
    await click('auth-tab-signup')
    await fill('a@b.com', 'abcdefgh', 'abcdefgh')
    await click('auth-submit')
    expect(text('auth-error')).toContain('영문과 숫자')
  })

  it('서버가 준 rule별 문구를 보여 준다', async () => {
    const e = new AccountError('weak_password', '비밀번호가 규칙에 맞지 않습니다')
    e.rule = 'whitespace'
    const api = makeMockAccount({ delayMs: 0 })
    setAccountApi({
      ...api,
      signUp: async () => {
        throw e
      },
    })
    modal()
    await click('auth-tab-signup')
    await fill('a@b.com', 'abcd1234', 'abcd1234')
    await click('auth-submit')
    expect(text('auth-error')).toContain('공백')
  })

  it('로그인 탭은 규칙을 걸지 않는다 — 예전 규칙으로 만든 비밀번호가 있다', async () => {
    modal()
    await fill('a@b.com', 'short')
    await click('auth-submit')
    expect(text('auth-error')).not.toContain('영문과 숫자')
  })
})

/** 약관을 받는 서버를 흉내 낸다 */
function termsApi(over: Partial<Record<string, unknown>> = {}) {
  const api = makeMockAccount({ delayMs: 0 })
  return {
    ...api,
    signupConfig: async () => ({
      emailVerify: false,
      termsRequired: true,
      termsVersion: '2026-10-28',
    }),
    ...over,
  }
}

describe('AuthModal — 약관 동의', () => {
  it('약관을 받지 않는 서버에서는 체크박스가 없다', async () => {
    modal()
    await click('auth-tab-signup')
    expect(document.querySelector('[data-test=terms-all]')).toBeNull()
  })

  it('받는 서버에서는 전체 동의와 항목 둘이 나온다', async () => {
    setAccountApi(termsApi())
    modal()
    await click('auth-tab-signup')
    expect(q('terms-all')).toBeTruthy()
    expect(q('terms-service')).toBeTruthy()
    expect(q('terms-privacy')).toBeTruthy()
  })

  it('전체 동의가 둘을 한 번에 켜고 끈다', async () => {
    setAccountApi(termsApi())
    modal()
    await click('auth-tab-signup')
    await click('terms-all')
    expect(q<HTMLInputElement>('terms-service').checked).toBe(true)
    expect(q<HTMLInputElement>('terms-privacy').checked).toBe(true)
    await click('terms-all')
    expect(q<HTMLInputElement>('terms-service').checked).toBe(false)
  })

  it('둘 다 체크해야 가입 버튼이 열린다', async () => {
    setAccountApi(termsApi())
    modal()
    await click('auth-tab-signup')
    await fill('a@b.com', 'abcd1234', 'abcd1234')
    expect(q<HTMLButtonElement>('auth-submit').disabled).toBe(true)
    await click('terms-service')
    expect(q<HTMLButtonElement>('auth-submit').disabled).toBe(true)
    await click('terms-privacy')
    expect(q<HTMLButtonElement>('auth-submit').disabled).toBe(false)
  })

  it('체크한 값을 그대로 보낸다 — consent를 자동으로 true로 넣지 않는다', async () => {
    let got: unknown = null
    setAccountApi(
      termsApi({
        signUp: async (...args: unknown[]) => {
          got = args[3]
          throw new AccountError('terms_required', '이용약관에 동의해 주세요')
        },
      }),
    )
    modal()
    await click('auth-tab-signup')
    await fill('a@b.com', 'abcd1234', 'abcd1234')
    await click('terms-all')
    await click('auth-submit')
    expect(got).toMatchObject({ consent: true, termsAgreed: true })
  })

  it('[보기]를 누르면 약관 본문이 뜬다', async () => {
    setAccountApi(termsApi())
    modal()
    await click('auth-tab-signup')
    await click('terms-view-service')
    expect(text('terms-body')).toContain('모의면접')
  })
})
