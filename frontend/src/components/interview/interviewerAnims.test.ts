import { describe, expect, it } from 'vitest'
import manifest from '../../../public/sprites/interviewers/manifest.json'
import { ANIMS, LIFE, REACT, baseAnims, watchAnim } from './interviewerAnims'

describe('interviewerAnims', () => {
  it('대기·듣기·생각 중 기본은 idle 셋', () => {
    for (const st of ['waiting', 'listening', 'thinking', 'idle'] as const)
      expect(baseAnims(st)).toEqual({
        left: 'left_idle',
        center: 'center_idle',
        right: 'right_idle',
      })
  })
  it('질문 중엔 가운데가 질문 제스처를 반복(loop)한다', () => {
    expect(baseAnims('speaking').center).toBe('center_question')
    expect(ANIMS.center_question.loop).toBe(true)
  })
  it('좋은 답변: 서류 확인 / 끄덕임 2회 / 필기 — 전부 1회성', () => {
    expect(REACT).toEqual({ left: 'left_pageflip', center: 'center_nod', right: 'right_writing' })
    for (const a of Object.values(REACT)) expect(ANIMS[a].loop).toBe(false)
  })
  it('답변 지연은 시계와 펜 톡톡을 번갈아', () => {
    expect(watchAnim(1)).toEqual({ char: 'center', anim: 'center_watch' })
    expect(watchAnim(2)).toEqual({ char: 'right', anim: 'right_pentap' })
    expect(watchAnim(3).anim).toBe('center_watch')
  })
  it('평시 잔동작은 전부 1회성이고 간격은 5초 이상', () => {
    for (const perChar of Object.values(LIFE))
      for (const cfg of Object.values(perChar)) {
        for (const a of cfg.anims) expect(ANIMS[a].loop).toBe(false)
        expect(cfg.every[0]).toBeGreaterThanOrEqual(5_000)
        expect(cfg.every[1]).toBeGreaterThan(cfg.every[0])
      }
    expect(LIFE.listening?.center?.anims).toContain('center_armscross')
  })
  it('프레임 수는 manifest와 같고 idle만 loop', () => {
    const m = manifest as Record<string, { frames: number }>
    for (const [name, a] of Object.entries(ANIMS)) {
      expect(m[name].frames, name).toBe(a.frames)
      if (name.endsWith('_idle')) expect(a.loop).toBe(true)
    }
    expect(m.candidate_back.frames).toBe(1)
  })
})
