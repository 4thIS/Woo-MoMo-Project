import { describe, expect, it } from 'vitest'
import { ANIMS, animsFor } from './interviewerAnims'

describe('animsFor', () => {
  it('대기: idle/idle/idle', () =>
    expect(animsFor('waiting', { react: false, watch: false })).toEqual({
      left: 'left_idle',
      center: 'center_idle',
      clerk: 'clerk_idle',
    }))
  it('질문 중: idle/talk/idle', () =>
    expect(animsFor('asking', { react: false, watch: false }).center).toBe('center_talk'))
  it('듣는 중: idle/nod/write', () =>
    expect(animsFor('listening', { react: false, watch: false })).toEqual({
      left: 'left_idle',
      center: 'center_nod',
      clerk: 'clerk_write',
    }))
  it('좋은 답변: react/react/write', () =>
    expect(animsFor('thinking', { react: true, watch: false })).toEqual({
      left: 'left_react',
      center: 'center_react',
      clerk: 'clerk_write',
    }))
  it('답변 지연: watch/watch/idle', () =>
    expect(animsFor('waiting', { react: false, watch: true })).toEqual({
      left: 'left_watch',
      center: 'center_watch',
      clerk: 'clerk_idle',
    }))
  it('프레임 수는 manifest와 같다', () => {
    expect(ANIMS.center_talk.frames).toBe(7)
    expect(ANIMS.left_react.frames).toBe(9)
    expect(ANIMS.clerk_write.frames).toBe(9)
  })
})
