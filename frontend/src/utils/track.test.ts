import { describe, it, expect } from 'vitest'
import { trackOf, canStartWith } from './track'

describe('trackOf — 고른 면접관이 트랙을 정한다', () => {
  it.each([
    ['m1', 'company'],
    ['f2', 'company'],
    ['f3', 'admission'],
  ] as const)('%s는 %s', (id, want) => {
    expect(trackOf(id, null)).toBe(want)
  })

  it('벤은 고를 때까지 트랙이 없다 — 둘 다 보기 때문이다', () => {
    expect(trackOf('m2', null)).toBeNull()
  })

  it('벤은 사용자가 고른 쪽을 따른다', () => {
    expect(trackOf('m2', 'admission')).toBe('admission')
    expect(trackOf('m2', 'company')).toBe('company')
  })

  it('벤이 아니면 고른 값을 무시한다 — 올리비아는 늘 대입이다', () => {
    expect(trackOf('f3', 'company')).toBe('admission')
  })

  it('면접관을 안 골랐으면 트랙도 없다', () => {
    expect(trackOf(null, null)).toBeNull()
    expect(trackOf(null, 'company')).toBeNull()
  })

  it('없는 id면 트랙도 없다', () => {
    expect(trackOf('없는사람', 'company')).toBeNull()
  })
})

describe('canStartWith — 트랙별 시작 조건', () => {
  const base = { modelReady: true, resumeDone: true }
  const company = { ...base, track: 'company' as const, field: 'it', job: '백엔드 개발자' }
  const admission = {
    ...base,
    track: 'admission' as const,
    name: '홍길동',
    age: 19,
    university: '한국대학교',
    department: '컴퓨터공학과',
  }

  it('회사는 분야·직무·이력서가 차면 시작한다', () => {
    expect(canStartWith(company)).toBe(true)
  })

  it('회사는 분야가 없으면 못 시작한다', () => {
    expect(canStartWith({ ...company, field: null })).toBe(false)
  })

  it('회사는 직무가 공백뿐이면 못 시작한다', () => {
    expect(canStartWith({ ...company, job: '   ' })).toBe(false)
  })

  it('대입은 다섯 칸이 다 차야 시작한다', () => {
    expect(canStartWith(admission)).toBe(true)
  })

  it.each(['name', 'university', 'department'] as const)('대입은 %s가 비면 못 시작한다', (k) => {
    expect(canStartWith({ ...admission, [k]: '' })).toBe(false)
  })

  it('대입은 나이가 없으면 못 시작한다', () => {
    expect(canStartWith({ ...admission, age: null })).toBe(false)
  })

  it('대입에서 회사 칸은 보지 않는다 — 트랙을 바꿔도 앞 입력이 통과시키지 않는다', () => {
    const leftover = { ...admission, name: '', field: 'it', job: '백엔드 개발자' }
    expect(canStartWith(leftover)).toBe(false)
  })

  it('회사에서 대입 칸은 보지 않는다', () => {
    const leftover = {
      ...company,
      job: '',
      name: '홍길동',
      university: '한국대',
      department: '컴공',
    }
    expect(canStartWith(leftover)).toBe(false)
  })

  it('트랙이 없으면 못 시작한다 — 벤을 고르고 트랙을 안 골랐을 때', () => {
    expect(canStartWith({ ...company, track: null })).toBe(false)
  })

  it('모델이 안 됐으면 못 시작한다', () => {
    expect(canStartWith({ ...company, modelReady: false })).toBe(false)
  })

  it('이력서가 없으면 못 시작한다', () => {
    expect(canStartWith({ ...admission, resumeDone: false })).toBe(false)
  })
})
