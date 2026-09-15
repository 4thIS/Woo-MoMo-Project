import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })

describe('design tokens', () => {
  const tokens = readFileSync(join(__dirname, 'tokens.css'), 'utf8')

  it('필수 변수를 전부 정의한다', () => {
    for (const v of [
      '--bg',
      '--win',
      '--raise',
      '--line',
      '--text',
      '--text-2',
      '--text-3',
      '--accent',
      '--ok',
      '--danger',
      '--font-display',
      '--font-body',
      '--font-mono',
      '--content-w',
    ])
      expect(tokens, v).toMatch(new RegExp(`${v}:`))
  })

  it('tokens.css 밖에는 색 리터럴이 없다', () => {
    const offenders = walk(SRC)
      .filter(
        (p) => /\.(vue|css|ts)$/.test(p) && !p.endsWith('tokens.css') && !p.endsWith('.test.ts'),
      )
      .filter((p) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(readFileSync(p, 'utf8')))
    expect(offenders).toEqual([])
  })
})
