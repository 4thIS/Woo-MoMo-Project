import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, 'tokens.css'), 'utf8')

describe('tokens.css', () => {
  it('상단바 높이는 화면 폭에 따라 흔들리지 않는다', () => {
    // 아래 화면 전부가 이 숫자를 믿고 비켜 선다. 폭마다 다르면 한 값이 두 뜻이 된다 —
    // 좁아지면 접는 대신 글자를 떼고 한 줄을 지킨다 (2026-11-07)
    expect(css.match(/--topbar-h:/g) ?? []).toHaveLength(1)
  })

  it('읽는 글의 글꼴과 줄간을 토큰으로 가진다', () => {
    expect(css).toMatch(/--font-read:/)
    expect(css).toMatch(/--lh-read:\s*1\.8/)
    expect(css).toMatch(/--gap-card:/)
  })

  it('읽는 글꼴로 새 웹폰트를 받지 않는다 — 시스템 스택만 쓴다', () => {
    // 이 제품은 이미 첫 면접 전에 3.1GB를 받으라고 한다. 본문 글꼴 하나로
    // 1MB를 더 얹지 않는다
    const read = css.match(/--font-read:([^;]+);/)?.[1] ?? ''
    expect(read).toMatch(/sans-serif/)
    expect(css).not.toMatch(/@font-face/)
  })
})
