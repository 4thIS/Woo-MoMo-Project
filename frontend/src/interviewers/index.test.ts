import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import voices from './voices.json'
import legacyManifest from '../../public/sprites/interviewers/manifest.json'
import { PERSONAS } from '@/prompts/personas'
import {
  CENTER_FRAME_PX,
  CENTER_ROLES,
  DEFAULT_INTERVIEWER,
  INTERVIEWERS,
  LEFT_ROLES,
  LEGACY_CENTER,
  LEGACY_SIDE,
  RIGHT_ROLES,
  SIDE_SPRITES,
  SPRITE_ROOT,
  interviewerById,
  type CenterSprites,
  type SideSprites,
} from './index'

type Entry = { file: string; frames: number; w: number; h: number }
const PUBLIC = join(__dirname, '../../public')
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as Record<string, Entry>
/** PNG IHDR의 가로·세로(px) */
function pngSize(p: string): [number, number] {
  const b = readFileSync(p)
  return [b.readUInt32BE(16), b.readUInt32BE(20)]
}
const legacy = legacyManifest as Record<string, { frames: number }>

/** 시트 하나가 실제 에셋과 맞는지: 파일 존재, 폴더 manifest의 frames와 같음, PNG가 92 × frames 가로 × 92 */
function expectSheetMatchesAsset(
  sheet: { file: string; frames: number },
  folder: string,
  key: string,
) {
  const man = readJson(join(PUBLIC, `sprites/interviewers64/${folder}/manifest.json`))
  const e = man[key]
  expect(e, `${folder}/${key}`).toBeDefined()
  expect(sheet.file).toBe(`${SPRITE_ROOT}/${folder}/${e.file}`)
  expect(sheet.frames, `${folder}/${key}`).toBe(e.frames)
  expect([e.w, e.h]).toEqual([CENTER_FRAME_PX, CENTER_FRAME_PX])
  const png = join(PUBLIC, sheet.file)
  expect(existsSync(png), png).toBe(true)
  expect(pngSize(png), png).toEqual([CENTER_FRAME_PX * e.frames, CENTER_FRAME_PX])
}

describe('interviewers', () => {
  it('4명: 데이빗·쥴리·올리비아·벤 순서(고르기 카드 순서), id 유일', () => {
    expect(INTERVIEWERS.map((i) => i.id)).toEqual(['m1', 'f2', 'f3', 'm2'])
    expect(INTERVIEWERS.map((i) => i.displayName)).toEqual(['데이빗', '쥴리', '올리비아', '벤'])
    expect(INTERVIEWERS.map((i) => i.name)).toEqual([
      '기본 면접관(남)',
      '압박 면접관(여)',
      '기본 면접관(여)',
      '압박 면접관(남)',
    ])
    expect(new Set(INTERVIEWERS.map((i) => i.id)).size).toBe(4)
  })
  it('트랙: 데이빗·쥴리는 회사, 올리비아는 대입, 벤만 둘 다라 null', () => {
    expect(INTERVIEWERS.map((i) => i.track)).toEqual(['company', 'company', 'admission', null])
  })
  it('프리미엄은 벤 하나뿐이다', () => {
    expect(INTERVIEWERS.filter((i) => i.premium).map((i) => i.displayName)).toEqual(['벤'])
  })
  it('면접관 id와 페르소나 id는 따로다: 기본 둘은 standard, 압박 둘은 sharp(gentle은 연결된 면접관 없음)', () => {
    expect(INTERVIEWERS.map((i) => i.persona)).toEqual(['standard', 'sharp', 'standard', 'sharp'])
    for (const iv of INTERVIEWERS) expect(PERSONAS[iv.persona]).toBeDefined()
  })
  it('목소리: 데이빗 M4 · 쥴리 F4 · 올리비아 F3 · 벤 M5', () => {
    expect(INTERVIEWERS.map((i) => i.voiceId)).toEqual(['M4', 'F4', 'F3', 'M5'])
  })
  it('기본값은 데이빗 — 올리비아는 대입 전용이라 회사 면접 기본이 될 수 없다', () => {
    expect(DEFAULT_INTERVIEWER).toBe('m1')
    expect(interviewerById(DEFAULT_INTERVIEWER)?.displayName).toBe('데이빗')
    expect(interviewerById(DEFAULT_INTERVIEWER)?.track).toBe('company')
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
})

describe('interviewers — 스프라이트(interviewers64 에셋)', () => {
  it('가운데 동작은 7종: idle · question_in · question · question_out · watch · lookside · armscross (nod 없음)', () => {
    expect([...CENTER_ROLES]).toEqual([
      'idle',
      'question_in',
      'question',
      'question_out',
      'watch',
      'lookside',
      'armscross',
    ])
  })
  it('스프라이트 프레임 한 변은 92px, 경로 뿌리는 /sprites/interviewers64', () => {
    expect(CENTER_FRAME_PX).toBe(92)
    expect(SPRITE_ROOT).toBe('/sprites/interviewers64')
  })
  it('면접관마다 7개 시트가 실제 파일·manifest frames·92×92 프레임과 맞는다(캐릭터마다 다른 프레임 수 포함)', () => {
    for (const iv of INTERVIEWERS)
      for (const r of CENTER_ROLES) expectSheetMatchesAsset(iv.sprites[r], iv.id, `center_${r}`)
    // 하드코딩이 아니라 manifest를 따른다: m1만 question이 8프레임
    expect(interviewerById('m1')!.sprites.question.frames).toBe(8)
    expect(interviewerById('f3')!.sprites.question.frames).toBe(12)
  })
  it('배석자: 왼쪽 sl(idle·pageflip), 오른쪽 sr(idle·writing·pentap)이 실제 에셋과 맞는다', () => {
    expect([...LEFT_ROLES]).toEqual(['idle', 'pageflip'])
    expect([...RIGHT_ROLES]).toEqual(['idle', 'writing', 'pentap'])
    for (const r of LEFT_ROLES) expectSheetMatchesAsset(SIDE_SPRITES.left[r], 'sl', `left_${r}`)
    for (const r of RIGHT_ROLES) expectSheetMatchesAsset(SIDE_SPRITES.right[r], 'sr', `right_${r}`)
  })
  it('최상위 interviewers64/manifest.json은 폴더별 manifest를 모은 것과 같다(코드는 최상위만 import)', () => {
    const top = JSON.parse(
      readFileSync(join(PUBLIC, 'sprites/interviewers64/manifest.json'), 'utf8'),
    ) as Record<string, Record<string, Entry>>
    for (const folder of ['m1', 'f3', 'm2', 'f2', 'sl', 'sr'])
      expect(top[folder], folder).toEqual(
        readJson(join(PUBLIC, `sprites/interviewers64/${folder}/manifest.json`)),
      )
  })
})

describe('interviewers — 대체(LEGACY, 기존 32×32 세트)', () => {
  it('가운데: idle·question·watch·lookside·armscross는 같은 이름, question_in·out은 center_idle(1회) — 프레임은 기존 manifest', () => {
    const map: Record<string, string> = {
      idle: 'center_idle',
      question_in: 'center_idle',
      question: 'center_question',
      question_out: 'center_idle',
      watch: 'center_watch',
      lookside: 'center_lookside',
      armscross: 'center_armscross',
    }
    const lc: CenterSprites = LEGACY_CENTER
    for (const r of CENTER_ROLES) {
      expect(lc[r].file, r).toBe(`/sprites/interviewers/${map[r]}.png`)
      expect(lc[r].frames, r).toBe(legacy[map[r]].frames)
      expect(existsSync(join(PUBLIC, lc[r].file)), lc[r].file).toBe(true)
    }
  })
  it('배석자: 기존 left_*·right_* 시트, 프레임은 기존 manifest', () => {
    const ls: SideSprites = LEGACY_SIDE
    for (const r of LEFT_ROLES) {
      expect(ls.left[r].file).toBe(`/sprites/interviewers/left_${r}.png`)
      expect(ls.left[r].frames).toBe(legacy[`left_${r}`].frames)
    }
    for (const r of RIGHT_ROLES) {
      expect(ls.right[r].file).toBe(`/sprites/interviewers/right_${r}.png`)
      expect(ls.right[r].frames).toBe(legacy[`right_${r}`].frames)
    }
  })
})
