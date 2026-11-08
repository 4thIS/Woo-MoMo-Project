import { describe, expect, it } from 'vitest'
import { digitsOnly, plainName } from './inputFilter'

describe('digitsOnly — 나이 칸', () => {
  it('숫자만 남긴다', () => {
    expect(digitsOnly('27')).toBe('27')
    expect(digitsOnly('2a7')).toBe('27')
  })

  it('특수문자를 지운다', () => {
    expect(digitsOnly('2!7')).toBe('27')
    expect(digitsOnly('-19')).toBe('19')
    expect(digitsOnly('1.5')).toBe('15')
    expect(digitsOnly('2e5')).toBe('25') // type=number가 받아 주던 지수 표기
  })

  it('한글·공백도 지운다 — 나이에 들어갈 수 없는 것은 전부 지운다', () => {
    expect(digitsOnly('스물일곱')).toBe('')
    expect(digitsOnly(' 2 7 ')).toBe('27')
  })

  it('붙여넣기처럼 통째로 들어와도 숫자만 남는다', () => {
    expect(digitsOnly('나이: 27세(만 26)')).toBe('2726')
  })

  it('빈 글자는 빈 글자다', () => {
    expect(digitsOnly('')).toBe('')
  })
})

describe('plainName — 이름·대학·학과 칸', () => {
  it('한글·영문·숫자·공백은 남긴다', () => {
    expect(plainName('홍길동')).toBe('홍길동')
    expect(plainName('한국대학교 컴퓨터공학과')).toBe('한국대학교 컴퓨터공학과')
    expect(plainName('Hong Gildong 2')).toBe('Hong Gildong 2')
  })

  it('특수문자를 지운다', () => {
    expect(plainName('홍길동!')).toBe('홍길동')
    expect(plainName('한국대(관악)')).toBe('한국대관악')
    expect(plainName('컴퓨터·AI공학부')).toBe('컴퓨터AI공학부')
    expect(plainName('<script>')).toBe('script')
  })

  it('조합 중인 한글 낱자는 남긴다 — 지우면 한글을 칠 수 없다', () => {
    expect(plainName('ㅎ')).toBe('ㅎ')
    expect(plainName('홍ㄱ')).toBe('홍ㄱ')
    expect(plainName('ㅏ')).toBe('ㅏ')
  })

  it('빈 글자는 빈 글자다', () => {
    expect(plainName('')).toBe('')
  })
})
