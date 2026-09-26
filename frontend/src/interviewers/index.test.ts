import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import voices from './voices.json'
import { ANIMS, type AnimName } from '@/components/interview/interviewerAnims'
import {
  CENTER_FRAMES,
  CENTER_ROLES,
  DEFAULT_INTERVIEWER,
  INTERVIEWERS,
  interviewerById,
} from './index'

const centerAnim = (r: string) => ANIMS[`center_${r}` as AnimName]

describe('interviewers', () => {
  it('3명: 온화한 선배 · 기본 면접관 · 날카로운 압박 면접관 순서, id 유일', () => {
    expect(INTERVIEWERS.map((i) => i.id)).toEqual(['gentle', 'standard', 'sharp'])
    expect(INTERVIEWERS.map((i) => i.name)).toEqual([
      '온화한 선배',
      '기본 면접관',
      '날카로운 압박 면접관',
    ])
    expect(new Set(INTERVIEWERS.map((i) => i.id)).size).toBe(3)
  })
  it('기본값은 standard이고, 지금 가운데 캐릭터(스프라이트)와 목소리 M2 그대로다', () => {
    expect(DEFAULT_INTERVIEWER).toBe('standard')
    const s = interviewerById('standard')!
    expect(s.voiceId).toBe('M2')
    for (const r of CENTER_ROLES) expect(s.sprites[r].file).toBe(centerAnim(r).file)
  })
  it('가운데 동작 프레임 수는 모든 면접관이 기존 가운데 캐릭터와 같다(타이밍 코드 재사용)', () => {
    for (const r of CENTER_ROLES) expect(CENTER_FRAMES[r]).toBe(centerAnim(r).frames)
    for (const iv of INTERVIEWERS)
      for (const r of CENTER_ROLES) expect(iv.sprites[r].frames).toBe(CENTER_FRAMES[r])
  })
  it('새 면접관 스프라이트 경로는 /sprites/interviewers/{id}/center_{role}.png', () => {
    for (const id of ['gentle', 'sharp'] as const)
      for (const r of CENTER_ROLES)
        expect(interviewerById(id)!.sprites[r].file).toBe(
          `/sprites/interviewers/${id}/center_${r}.png`,
        )
  })
  it('목소리·미리 듣기는 voices.json을 따른다', () => {
    for (const iv of INTERVIEWERS) {
      expect(iv.voiceId).toBe(voices[iv.id].voice)
      expect(iv.preview).toEqual({ text: voices[iv.id].text, src: `/voices/preview/${iv.id}.ogg` })
    }
  })
  it('interviewerById: 없는 id·null·undefined는 null', () => {
    expect(interviewerById('nope')).toBeNull()
    expect(interviewerById(null)).toBeNull()
    expect(interviewerById(undefined)).toBeNull()
  })
  it('스프라이트 에셋 폴더가 있으면 manifest.json이 규격(32×32, 프레임 수)과 같다 — 에셋 PR 전에는 건너뛴다', () => {
    for (const id of ['gentle', 'sharp']) {
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
        expect([e.w, e.h]).toEqual([32, 32])
      }
    }
  })
})
