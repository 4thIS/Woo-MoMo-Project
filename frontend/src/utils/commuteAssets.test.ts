import { describe, expect, it } from 'vitest'
import {
  COMMUTE_IDS,
  REQUIRED_KEYS,
  isComplete,
  resolveInterviewer,
  sheetPath,
} from './commuteAssets'

describe('에셋 해석', () => {
  it('아는 면접관은 그대로 쓴다', () => {
    expect(resolveInterviewer('m2')).toBe('m2')
  })
  it('아직 안 골랐으면 기본 면접관으로 떨어진다', () => {
    expect(resolveInterviewer(null)).toBe('f3')
    expect(resolveInterviewer(undefined)).toBe('f3')
  })
  it('모르는 값(옛 localStorage)도 기본 면접관으로 떨어진다', () => {
    expect(resolveInterviewer('gentle')).toBe('f3')
    expect(resolveInterviewer('')).toBe('f3')
  })
  it('경로는 면접관 폴더 아래다', () => {
    expect(sheetPath('m1', 'walk')).toBe('/sprites/commute/m1/walk.png')
  })
  it('필요한 동작이 하나라도 빠지면 그 세트는 쓰지 않는다', () => {
    const full = Object.fromEntries(
      REQUIRED_KEYS.map((k) => [k, { file: `${k}.png`, frames: 12, w: 64, h: 64 }]),
    )
    expect(isComplete(full)).toBe(true)
    const missing = { ...full }
    delete missing.walk
    expect(isComplete(missing)).toBe(false)
    expect(isComplete(null)).toBe(false)
  })
  it('면접관 4명이 전부 정의돼 있다', () => {
    expect(COMMUTE_IDS).toEqual(['m1', 'f3', 'm2', 'f2'])
  })
})
