import voices from './voices.json'

/**
 * 면접관 정의 — 순수 데이터(spec 4.1·11.1). 페르소나 문구는 prompts/personas.ts.
 * 면접관 id(캐릭터·목소리)와 페르소나 id(말투)는 따로다 — 같은 페르소나를 여러 면접관이 쓴다.
 */
export type InterviewerId = 'm1' | 'f3' | 'm2' | 'f2'
export type PersonaId = 'gentle' | 'standard' | 'sharp'
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
  /** PERSONAS의 키 — 프롬프트·리포트 말투 */
  persona: PersonaId
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
/** 스프라이트 프레임 한 변(px, spec 11.2). 무대·고르기 카드가 이 크기에 배율을 곱해 그린다 */
export const CENTER_FRAME_PX = 64

const sheets = (dir: string): CenterSprites =>
  Object.fromEntries(
    CENTER_ROLES.map((r) => [r, { file: `${dir}/center_${r}.png`, frames: CENTER_FRAMES[r] }]),
  ) as CenterSprites

/** 기존 가운데 캐릭터(32×32, 라인업에서 빠진 M2). 면접관 파일이 하나라도 안 뜨면 6개 모두 이걸로 그린다(spec 11.2) */
export const LEGACY_CENTER: CenterSprites = sheets('/sprites/interviewers')

const make = (
  id: InterviewerId,
  name: string,
  tagline: string,
  persona: PersonaId,
): Interviewer => ({
  id,
  name,
  tagline,
  persona,
  voiceId: voices[id].voice,
  preview: { text: voices[id].text, src: `/voices/preview/${id}.ogg` },
  sprites: sheets(`/sprites/interviewers/${id}`),
})

/** 이 순서가 고르기 카드 순서다 */
export const INTERVIEWERS: readonly Interviewer[] = [
  make('m1', '기본 면접관(남)', '차분하게 진행합니다', 'standard'),
  make('f3', '기본 면접관(여)', '차분하게 진행합니다', 'standard'),
  make('m2', '압박 면접관(남)', '근거를 보여 주세요', 'sharp'),
  make('f2', '압박 면접관(여)', '근거를 보여 주세요', 'sharp'),
]

export const DEFAULT_INTERVIEWER: InterviewerId = 'f3'

export function interviewerById(id: string | null | undefined): Interviewer | null {
  return INTERVIEWERS.find((iv) => iv.id === id) ?? null
}
