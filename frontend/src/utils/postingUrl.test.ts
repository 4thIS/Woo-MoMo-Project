import { describe, expect, it } from 'vitest'
import { normalizePostingUrl } from './postingUrl'

describe('normalizePostingUrl', () => {
  it('비어 있으면 보내지 않는다', () => {
    expect(normalizePostingUrl('')).toEqual({ ok: true, url: null })
    expect(normalizePostingUrl('   ')).toEqual({ ok: true, url: null })
  })

  it('http·https 절대 주소를 그대로 통과시킨다', () => {
    const u = 'https://careers.example.com/jobs/1234'
    expect(normalizePostingUrl(u)).toEqual({ ok: true, url: u })
    expect(normalizePostingUrl('http://example.com/a')).toEqual({
      ok: true,
      url: 'http://example.com/a',
    })
  })

  it('앞뒤 공백은 떼고 본다', () => {
    expect(normalizePostingUrl('  https://example.com/a  ')).toEqual({
      ok: true,
      url: 'https://example.com/a',
    })
  })

  it('한글이 든 주소는 퍼센트 인코딩해서 보낸다 — 서버는 ASCII만 받는다', () => {
    const r = normalizePostingUrl('https://example.com/채용/백엔드')
    expect(r.ok).toBe(true)
    expect(r.ok && r.url).toBe('https://example.com/%EC%B1%84%EC%9A%A9/%EB%B0%B1%EC%97%94%EB%93%9C')
  })

  it('이미 인코딩된 주소를 두 번 인코딩하지 않는다', () => {
    const u = 'https://example.com/%EC%B1%84%EC%9A%A9'
    expect(normalizePostingUrl(u)).toEqual({ ok: true, url: u })
  })

  it('http·https가 아니면 거부한다', () => {
    expect(normalizePostingUrl('ftp://example.com').ok).toBe(false)
    expect(normalizePostingUrl('javascript:alert(1)').ok).toBe(false)
    expect(normalizePostingUrl('example.com/jobs').ok).toBe(false)
  })

  it('호스트가 없으면 거부한다', () => {
    expect(normalizePostingUrl('https://').ok).toBe(false)
  })

  it('아이디·비밀번호가 박힌 주소는 거부한다 — 서버도 받지 않는다', () => {
    expect(normalizePostingUrl('https://user:pw@example.com/a').ok).toBe(false)
    expect(normalizePostingUrl('https://user@example.com/a').ok).toBe(false)
  })

  it('가운데 공백이 있으면 거부한다 — 주소를 임의로 이어 붙이지 않는다', () => {
    expect(normalizePostingUrl('https://example.com/a b').ok).toBe(false)
  })

  it('인코딩한 길이가 500자를 넘으면 거부한다', () => {
    const ok = 'https://example.com/' + 'a'.repeat(480)
    expect(ok.length).toBe(500)
    expect(normalizePostingUrl(ok).ok).toBe(true)
    expect(normalizePostingUrl(ok + 'a').ok).toBe(false)
  })

  it('거부할 때는 화면에 그대로 쓸 이유를 준다', () => {
    const r = normalizePostingUrl('example.com')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason.length).toBeGreaterThan(0)
  })
})
