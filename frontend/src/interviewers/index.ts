import voices from './voices.json'

/** 면접관 정의 — 순수 데이터. 페르소나 문구는 prompts/personas.ts (spec 4.1) */
export type InterviewerId = 'gentle' | 'standard' | 'sharp'
export type CenterRole = 'idle' | 'question' | 'nod' | 'watch' | 'lookside' | 'armscross'
export interface CenterSheet {
  file: string
  frames: number
}
export type CenterSprites = Record<CenterRole, CenterSheet>
export interface Interviewer {
  id: InterviewerId
  name: string
  tagline: string
  /** manifest.tts.voices의 id */
  voiceId: string
  preview: { text: string; src: string }
  sprites: CenterSprites
}

/** 가운데 동작별 프레임 수 — 기존 center_*.png와 같다(스프라이트 규격, spec 6.2) */
export const CENTER_FRAMES: Record<CenterRole, number> = {
  idle: 15,
  question: 10,
  nod: 11,
  watch: 10,
  lookside: 10,
  armscross: 28,
}
export const CENTER_ROLES = Object.keys(CENTER_FRAMES) as CenterRole[]

const sheets = (dir: string): CenterSprites =>
  Object.fromEntries(
    CENTER_ROLES.map((r) => [r, { file: `${dir}/center_${r}.png`, frames: CENTER_FRAMES[r] }]),
  ) as CenterSprites

const make = (id: InterviewerId, name: string, tagline: string, dir: string): Interviewer => ({
  id,
  name,
  tagline,
  voiceId: voices[id].voice,
  preview: { text: voices[id].text, src: `/voices/preview/${id}.ogg` },
  sprites: sheets(dir),
})

export const INTERVIEWERS: readonly Interviewer[] = [
  make('gentle', '온화한 선배', '편하게 이야기해요', '/sprites/interviewers/gentle'),
  make('standard', '기본 면접관', '차분하게 진행합니다', '/sprites/interviewers'),
  make('sharp', '날카로운 압박 면접관', '근거를 보여 주세요', '/sprites/interviewers/sharp'),
]

export const DEFAULT_INTERVIEWER: InterviewerId = 'standard'

export function interviewerById(id: string | null | undefined): Interviewer | null {
  return INTERVIEWERS.find((iv) => iv.id === id) ?? null
}
