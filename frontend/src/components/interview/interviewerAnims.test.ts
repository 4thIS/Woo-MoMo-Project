import { describe, expect, it } from 'vitest'
import {
  CENTER_FRAME_PX,
  DEFAULT_INTERVIEWER,
  LEGACY_CENTER,
  LEGACY_SIDE,
  SIDE_SPRITES,
  interviewerById,
} from '@/interviewers'
import * as anims from './interviewerAnims'
import {
  ANIMS,
  CANDIDATE_BACK,
  CANDIDATE_SCALE,
  DESK_OVERLAP,
  overlapFor,
  scaleFor,
  FRAME_PAD,
  LIFE,
  SCALE,
  baseAnims,
  sheetFor,
  speechClip,
  watchAnim,
  type AnimName,
} from './interviewerAnims'

describe('interviewerAnims', () => {
  it('대기·듣기·생각 중 기본은 idle 셋', () => {
    for (const st of ['waiting', 'listening', 'thinking', 'idle'] as const)
      expect(baseAnims(st)).toEqual({
        left: 'left_idle',
        center: 'center_idle',
        right: 'right_idle',
      })
  })
  it('질문 중엔 가운데가 question을 반복(loop)한다 — 집어 들기·내려놓기(in·out)는 1회', () => {
    expect(baseAnims('speaking').center).toBe('center_question')
    expect(ANIMS.center_question.loop).toBe(true)
    expect(ANIMS.center_question_in.loop).toBe(false)
    expect(ANIMS.center_question_out.loop).toBe(false)
  })
  it('말하기 경계: 들어갈 때 question_in, 나올 때 question_out, 그 밖엔 없음', () => {
    expect(speechClip('thinking', 'speaking')).toBe('center_question_in')
    expect(speechClip('waiting', 'speaking')).toBe('center_question_in')
    expect(speechClip('speaking', 'waiting')).toBe('center_question_out')
    expect(speechClip('speaking', 'idle')).toBe('center_question_out')
    expect(speechClip('speaking', 'speaking')).toBeNull()
    expect(speechClip('waiting', 'listening')).toBeNull()
    expect(speechClip(undefined, 'speaking')).toBeNull() // 처음 그릴 때는 이미 말하는 중으로 본다
  })
  it('좋은 답변 반응(REACT)과 끄덕임(nod)은 없다', () => {
    expect('REACT' in anims).toBe(false)
    expect(Object.keys(ANIMS).some((n) => n.includes('nod'))).toBe(false)
  })
  it('답변 지연은 시계와 펜 톡톡을 번갈아', () => {
    expect(watchAnim(1)).toEqual({ char: 'center', anim: 'center_watch' })
    expect(watchAnim(2)).toEqual({ char: 'right', anim: 'right_pentap' })
    expect(watchAnim(3).anim).toBe('center_watch')
  })
  it('평시 잔동작은 전부 1회성이고 간격은 5초 이상, 말하는 중엔 없다', () => {
    for (const perChar of Object.values(LIFE))
      for (const cfg of Object.values(perChar)) {
        for (const a of cfg.anims) expect(ANIMS[a].loop).toBe(false)
        expect(cfg.every[0]).toBeGreaterThanOrEqual(5_000)
        expect(cfg.every[1]).toBeGreaterThan(cfg.every[0])
      }
    expect(LIFE.listening?.center?.anims).toEqual(['center_lookside', 'center_armscross'])
    expect(LIFE.listening?.left?.anims).toEqual(['left_pageflip'])
    expect(LIFE.listening?.right?.anims).toEqual(['right_writing'])
    expect(LIFE.speaking).toBeUndefined()
  })
  it('idle과 question만 loop', () => {
    for (const [name, a] of Object.entries(ANIMS))
      expect(a.loop, name).toBe(name.endsWith('_idle') || name === 'center_question')
  })
  it('면접관은 프레임 92 × 3 = 276px, 지원자 뒷모습은 32 × 6 = 192px 그대로', () => {
    expect(SCALE).toBe(3)
    expect(CENTER_FRAME_PX * SCALE).toBe(276)
    expect([CANDIDATE_BACK.w, CANDIDATE_BACK.h]).toEqual([32, 32])
    expect(CANDIDATE_BACK.w * CANDIDATE_SCALE).toBe(192)
  })

  it('창이 높으면 크게, 낮으면 작게 — 정수 배율로만 내린다', () => {
    expect(scaleFor(1000)).toBe(4)
    expect(scaleFor(900)).toBe(4)
    expect(scaleFor(860)).toBe(3)
    expect(scaleFor(760)).toBe(3)
    expect(scaleFor(700)).toBe(2)
    expect(scaleFor(500)).toBe(2)
  })

  it('어떤 높이에서도 정수다', () => {
    for (let h = 400; h <= 1400; h += 37)
      expect(Number.isInteger(scaleFor(h)), String(h)).toBe(true)
  })

  it('겹침 폭은 배율을 따라간다 — 배율이 바뀌면 책상도 같이 맞아야 한다', () => {
    expect(overlapFor(2)).toBe(FRAME_PAD * 2)
    expect(overlapFor(4)).toBe(FRAME_PAD * 4)
  })

  it('배율은 정수다 — 픽셀 그림은 반 칸으로 늘리면 뭉개진다', () => {
    expect(Number.isInteger(SCALE)).toBe(true)
    expect(Number.isInteger(CANDIDATE_SCALE)).toBe(true)
  })

  it('프레임 양옆 빈 칸만큼 겹쳐야 세 책상이 맞붙는다', () => {
    // 92px 프레임에서 그림은 x 14~78 — 양옆 14px이 비어 있다.
    // 그대로 늘어놓으면 책상 사이가 그 두 배만큼 벌어진다
    expect(FRAME_PAD).toBe(14)
    expect(FRAME_PAD * 2 + 64).toBe(CENTER_FRAME_PX)
    expect(DESK_OVERLAP).toBe(FRAME_PAD * SCALE)
  })
})

describe('sheetFor', () => {
  it('시트를 안 주면 기본 면접관(f3) 가운데 + 새 배석자 시트', () => {
    const f3 = interviewerById(DEFAULT_INTERVIEWER)!.sprites
    expect(sheetFor('center_idle')).toEqual({ ...f3.idle, loop: true })
    expect(sheetFor('left_pageflip')).toEqual({ ...SIDE_SPRITES.left.pageflip, loop: false })
    expect(sheetFor('right_pentap')).toEqual({ ...SIDE_SPRITES.right.pentap, loop: false })
  })
  it('가운데 동작은 고른 면접관 시트로, loop 규칙은 ANIMS를 따른다', () => {
    const sp = interviewerById('m1')!.sprites
    expect(sheetFor('center_question', sp)).toEqual({ ...sp.question, loop: true })
    expect(sheetFor('center_question_in', sp)).toEqual({ ...sp.question_in, loop: false })
    expect(sheetFor('center_question_out', sp)).toEqual({ ...sp.question_out, loop: false })
  })
  it('좌우 배석자는 가운데 시트와 무관하고, 배석자 시트(대체 포함)를 따른다', () => {
    const sp = interviewerById('m2')!.sprites
    expect(sheetFor('left_idle', sp)).toEqual({ ...SIDE_SPRITES.left.idle, loop: true })
    expect(sheetFor('right_writing', sp, LEGACY_SIDE)).toEqual({
      ...LEGACY_SIDE.right.writing,
      loop: false,
    })
  })
  it('대체 세트: question_in·out은 기존 center_idle을 1회 재생', () => {
    for (const n of ['center_question_in', 'center_question_out'] as AnimName[])
      expect(sheetFor(n, LEGACY_CENTER)).toEqual({
        file: '/sprites/interviewers/center_idle.png',
        frames: LEGACY_CENTER.idle.frames,
        loop: false,
      })
  })
})
