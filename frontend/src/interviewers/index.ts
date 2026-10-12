import voices from './voices.json'
import sheets64 from '../../public/sprites/interviewers64/manifest.json'
import legacyManifest from '../../public/sprites/interviewers/manifest.json'

/**
 * 면접관 정의 — 순수 데이터(spec 4.1·11.1). 페르소나 문구는 prompts/personas.ts.
 * 면접관 id(캐릭터·목소리)와 페르소나 id(말투)는 따로다 — 같은 페르소나를 여러 면접관이 쓴다.
 */
export type InterviewerId = 'm1' | 'f3' | 'm2' | 'f2'
export type PersonaId = 'gentle' | 'standard' | 'sharp'
/** 가운데 동작 7종(interviewers64 README). 질문은 집어 들기(in) → 말하는 동안 반복 → 내려놓기(out) 세 클립 */
export const CENTER_ROLES = [
  'idle',
  'question_in',
  'question',
  'question_out',
  'watch',
  'lookside',
  'armscross',
] as const
export type CenterRole = (typeof CENTER_ROLES)[number]
export const LEFT_ROLES = ['idle', 'pageflip'] as const
export const RIGHT_ROLES = ['idle', 'writing', 'pentap'] as const
export type LeftRole = (typeof LEFT_ROLES)[number]
export type RightRole = (typeof RIGHT_ROLES)[number]
export interface CenterSheet {
  file: string
  frames: number
}
export type CenterSprites = Record<CenterRole, CenterSheet>
/** 좌우 배석자 시트 — 누구를 고르든 같다 */
export interface SideSprites {
  left: Record<LeftRole, CenterSheet>
  right: Record<RightRole, CenterSheet>
}
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

/** 새 스프라이트 뿌리. 폴더 = 캐릭터 코드(m1·f3·m2·f2, 배석자 sl·sr) */
export const SPRITE_ROOT = '/sprites/interviewers64'
/** 스프라이트 프레임 한 변(px). 무대·고르기 카드가 이 크기에 정수 배율을 곱해 그린다 */
export const CENTER_FRAME_PX = 92

type ManifestEntry = { file: string; frames: number; w: number; h: number }
type Manifest = Record<string, Record<string, ManifestEntry>>
/** 프레임 수의 원천은 에셋 manifest다(캐릭터·동작마다 다르다). 빌드 때 묶이고, 폴더별 manifest·PNG와의 일치는 index.test가 지킨다 */
const SHEETS = sheets64 as Manifest
const LEGACY = legacyManifest as Record<string, ManifestEntry>

function sheet64(folder: string, key: string): CenterSheet {
  const e = SHEETS[folder]?.[key]
  if (!e) throw new Error(`sprites/interviewers64/${folder}: ${key} 없음`)
  return { file: `${SPRITE_ROOT}/${folder}/${e.file}`, frames: e.frames }
}
function legacySheet(key: string): CenterSheet {
  const e = LEGACY[key]
  if (!e) throw new Error(`sprites/interviewers: ${key} 없음`)
  return { file: `/sprites/interviewers/${e.file}`, frames: e.frames }
}
const centerSheets = (folder: string): CenterSprites =>
  Object.fromEntries(CENTER_ROLES.map((r) => [r, sheet64(folder, `center_${r}`)])) as CenterSprites

/** 좌우 배석자 새 시트(sl·sr) */
export const SIDE_SPRITES: SideSprites = {
  left: Object.fromEntries(LEFT_ROLES.map((r) => [r, sheet64('sl', `left_${r}`)])) as Record<
    LeftRole,
    CenterSheet
  >,
  right: Object.fromEntries(RIGHT_ROLES.map((r) => [r, sheet64('sr', `right_${r}`)])) as Record<
    RightRole,
    CenterSheet
  >,
}

/** 기존 32×32 세트에서 각 가운데 동작에 쓸 시트. 집어 들기·내려놓기 클립은 없어서 idle을 1회 재생한다 */
const LEGACY_ROLE: Record<CenterRole, string> = {
  idle: 'center_idle',
  question_in: 'center_idle',
  question: 'center_question',
  question_out: 'center_idle',
  watch: 'center_watch',
  lookside: 'center_lookside',
  armscross: 'center_armscross',
}
/** 기존 가운데 캐릭터(32×32). 면접관 파일이 하나라도 안 뜨면 7개 모두 이걸로 그린다 — 동작마다 캐릭터가 섞이지 않게 */
export const LEGACY_CENTER: CenterSprites = Object.fromEntries(
  CENTER_ROLES.map((r) => [r, legacySheet(LEGACY_ROLE[r])]),
) as CenterSprites
/** 기존 배석자(32×32). 새 배석자 시트가 하나라도 안 뜨면 좌우 모두 이걸로 */
export const LEGACY_SIDE: SideSprites = {
  left: Object.fromEntries(LEFT_ROLES.map((r) => [r, legacySheet(`left_${r}`)])) as Record<
    LeftRole,
    CenterSheet
  >,
  right: Object.fromEntries(RIGHT_ROLES.map((r) => [r, legacySheet(`right_${r}`)])) as Record<
    RightRole,
    CenterSheet
  >,
}

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
  sprites: centerSheets(id),
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
