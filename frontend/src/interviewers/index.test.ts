import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import voices from './voices.json'
import { ANIMS, type AnimName } from '@/components/interview/interviewerAnims'
import { PERSONAS } from '@/prompts/personas'
import {
  CENTER_FRAME_PX,
  CENTER_FRAMES,
  CENTER_ROLES,
  DEFAULT_INTERVIEWER,
  INTERVIEWERS,
  LEGACY_CENTER,
  interviewerById,
} from './index'

const centerAnim = (r: string) => ANIMS[`center_${r}` as AnimName]

describe('interviewers', () => {
  it('4명: 기본(남·여) · 압박(남·여) 순서(고르기 카드 순서), id 유일', () => {
    expect(INTERVIEWERS.map((i) => i.id)).toEqual(['m1', 'f3', 'm2', 'f2'])
    expect(INTERVIEWERS.map((i) => i.name)).toEqual([
      '기본 면접관(남)',
      '기본 면접관(여)',
      '압박 면접관(남)',
      '압박 면접관(여)',
    ])
    expect(INTERVIEWERS.map((i) => i.tagline)).toEqual([
      '차분하게 진행합니다',
      '차분하게 진행합니다',
      '근거를 보여 주세요',
      '근거를 보여 주세요',
    ])
    expect(new Set(INTERVIEWERS.map((i) => i.id)).size).toBe(4)
  })
  it('면접관 id와 페르소나 id는 따로다: 기본 둘은 standard, 압박 둘은 sharp(gentle은 연결된 면접관 없음)', () => {
    expect(INTERVIEWERS.map((i) => i.persona)).toEqual(['standard', 'standard', 'sharp', 'sharp'])
    for (const iv of INTERVIEWERS) expect(PERSONAS[iv.persona]).toBeDefined()
  })
  it('목소리: m1 M4 · f3 F3 · m2 M5 · f2 F4', () => {
    expect(INTERVIEWERS.map((i) => i.voiceId)).toEqual(['M4', 'F3', 'M5', 'F4'])
  })
  it('기본값은 f3(기본 면접관(여))', () => {
    expect(DEFAULT_INTERVIEWER).toBe('f3')
    expect(interviewerById(DEFAULT_INTERVIEWER)?.name).toBe('기본 면접관(여)')
  })
  it('LEGACY_CENTER는 기존 가운데 캐릭터 시트(/sprites/interviewers/center_*.png) 그대로 — 대체용', () => {
    for (const r of CENTER_ROLES) {
      expect(LEGACY_CENTER[r].file).toBe(`/sprites/interviewers/center_${r}.png`)
      expect(LEGACY_CENTER[r].file).toBe(centerAnim(r).file)
      expect(LEGACY_CENTER[r].frames).toBe(centerAnim(r).frames)
    }
  })
  it('스프라이트 프레임 한 변은 64px', () => {
    expect(CENTER_FRAME_PX).toBe(64)
  })
  it('가운데 동작 프레임 수는 모든 면접관이 기존 가운데 캐릭터와 같다(타이밍 코드 재사용)', () => {
    for (const r of CENTER_ROLES) expect(CENTER_FRAMES[r]).toBe(centerAnim(r).frames)
    for (const iv of INTERVIEWERS)
      for (const r of CENTER_ROLES) expect(iv.sprites[r].frames).toBe(CENTER_FRAMES[r])
  })
  it('모든 면접관 스프라이트 경로는 /sprites/interviewers/{id}/center_{role}.png', () => {
    for (const iv of INTERVIEWERS)
      for (const r of CENTER_ROLES)
        expect(iv.sprites[r].file).toBe(`/sprites/interviewers/${iv.id}/center_${r}.png`)
  })
  it('목소리·미리 듣기는 voices.json을 따른다', () => {
    for (const iv of INTERVIEWERS) {
      expect(iv.voiceId).toBe(voices[iv.id].voice)
      expect(iv.preview).toEqual({ text: voices[iv.id].text, src: `/voices/preview/${iv.id}.ogg` })
    }
  })
  it('interviewerById: 없는 id·옛 id·null·undefined는 null', () => {
    expect(interviewerById('nope')).toBeNull()
    for (const old of ['gentle', 'standard', 'sharp']) expect(interviewerById(old), old).toBeNull()
    expect(interviewerById(null)).toBeNull()
    expect(interviewerById(undefined)).toBeNull()
  })
  it('스프라이트 에셋 폴더가 있으면 manifest.json이 규격(64×64, 프레임 수)과 같다 — 에셋 PR 전에는 건너뛴다', () => {
    for (const id of ['m1', 'f3', 'm2', 'f2']) {
      const m = join(__dirname, `../../public/sprites/interviewers/${id}/manifest.json`)
      if (!existsSync(m)) continue
      const man = JSON.parse(readFileSync(m, 'utf8')) as Record<
        string,
        { file: string; frames: number; w: number; h: number }
      >
      for (const r of CENTER_ROLES) {
        const e = man[`center_${r}`]
        expect(e, `${id}/center_${r}`).toBeDefined()
        expect(e.file).toBe(`center_${r}.png`)
        expect(e.frames).toBe(CENTER_FRAMES[r])
        expect([e.w, e.h]).toEqual([CENTER_FRAME_PX, CENTER_FRAME_PX])
      }
    }
  })
})
