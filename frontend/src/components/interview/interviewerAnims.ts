import type { Stage } from '@/stores/interview'
import {
  DEFAULT_INTERVIEWER,
  SIDE_SPRITES,
  interviewerById,
  type CenterRole,
  type CenterSheet,
  type CenterSprites,
  type LeftRole,
  type RightRole,
  type SideSprites,
} from '@/interviewers'

export type Char = 'left' | 'center' | 'right'
export type AnimName = `left_${LeftRole}` | `center_${CenterRole}` | `right_${RightRole}`

/**
 * 동작 규칙(재생 방식)만 둔다. 시트(파일·프레임 수)는 에셋 manifest에서 온 면접관·배석자 시트로 푼다(sheetFor).
 * idle과 question은 순환. 나머지는 1회 재생하면 마지막 프레임이 idle(question_in은 question) 첫 자세라 그대로 이어진다.
 */
export const ANIMS: Record<AnimName, { loop: boolean }> = {
  left_idle: { loop: true },
  left_pageflip: { loop: false },
  center_idle: { loop: true },
  center_question_in: { loop: false },
  center_question: { loop: true },
  center_question_out: { loop: false },
  center_watch: { loop: false },
  center_lookside: { loop: false },
  center_armscross: { loop: false },
  right_idle: { loop: true },
  right_writing: { loop: false },
  right_pentap: { loop: false },
}
export const CANDIDATE_BACK = { file: '/sprites/interviewers/candidate_back.png', w: 32, h: 32 }
/** 12fps. 8fps 시절보다 프레임을 1.5배로 뽑아 길이는 그대로 두고 중간 동작만 늘렸다 —
 *  숫자를 되돌리면 모든 동작이 1.5배 빨라진다 */
export const FPS = 12
/** 면접관 배율: 프레임 92(CENTER_FRAME_PX) × 3 = 276px. 대체용 32×32 시트도 SpriteFrame이 시트 전체를 늘려 같은 276px로 그린다.
 *  정수만 쓴다 — 픽셀 그림을 반 칸으로 늘리면 칸마다 두께가 달라져 뭉개진다 */
export const SCALE = 3
/** 프레임 가장자리의 빈 칸(92px 프레임에서 그림은 x 14~78). 책상도 여기서 끝난다 */
export const FRAME_PAD = 14
/** 옆 사람과 이만큼 겹쳐야 책상 끝끼리 맞닿아 한 줄로 이어진다 */
export const DESK_OVERLAP = FRAME_PAD * SCALE
export const overlapFor = (scale: number): number => FRAME_PAD * scale

/** 창 높이에 맞춘 배율. 낮은 창에서 ×4로 그리면 면접관이 아래 패널에 깔린다.
 *  **정수만** 쓴다 — 반 칸으로 줄이면 픽셀이 뭉개진다 */
/** 지원자(뒷모습) 배율. 가까운 쪽이라 면접관보다 크게 — 32px 프레임 기준 */
export function candidateScaleFor(viewportHeight: number): number {
  if (viewportHeight >= 900) return 8
  if (viewportHeight >= 760) return 7
  return 6
}

export function scaleFor(viewportHeight: number): number {
  if (viewportHeight >= 900) return 4
  if (viewportHeight >= 760) return 3
  return 2
}
export const CANDIDATE_SCALE = 6 // 지원자 ×6(192px) — 가까운 쪽이 커 보이게

export type Trio = Record<Char, AnimName>
const IDLE: Trio = { left: 'left_idle', center: 'center_idle', right: 'right_idle' }

/** 상태별 기본 애니. 말하는 중엔 가운데가 question(종이 든 채 시선·입만)을 말이 끝날 때까지 반복한다 */
export function baseAnims(stage: Stage): Trio {
  return stage === 'speaking' ? { ...IDLE, center: 'center_question' } : IDLE
}

/** 말하기 경계에서 가운데가 1회 재생할 클립: 말을 시작하면 종이를 집어 들고(in), 마치면 내려놓는다(out) */
export function speechClip(prev: Stage | undefined, next: Stage): AnimName | null {
  if (prev === undefined || prev === next) return null
  if (next === 'speaking') return 'center_question_in'
  if (prev === 'speaking') return 'center_question_out'
  return null
}
export const SPEECH_CLIPS: readonly AnimName[] = ['center_question_in', 'center_question_out']

/** 답변 지연 n번째 신호: 홀수는 가운데 손목시계, 짝수는 서기 펜 톡톡 (번갈아) */
export function watchAnim(tick: number): { char: Char; anim: AnimName } {
  return tick % 2 === 1
    ? { char: 'center', anim: 'center_watch' }
    : { char: 'right', anim: 'right_pentap' }
}

/**
 * 평시 잔동작(life): 상태별로 캐릭터가 가끔 하는 1회성 동작과 간격(ms, [min, max]).
 * 듣는 중엔 서기가 자주 받아 적고, 가운데는 가끔 고개를 돌리거나 팔짱을 낀다. 말하는 중엔 없다.
 */
export const LIFE: Partial<
  Record<Stage, Partial<Record<Char, { anims: AnimName[]; every: [number, number] }>>>
> = {
  waiting: {
    left: { anims: ['left_pageflip'], every: [18_000, 30_000] },
    center: { anims: ['center_lookside'], every: [15_000, 25_000] },
  },
  listening: {
    left: { anims: ['left_pageflip'], every: [18_000, 30_000] },
    center: { anims: ['center_lookside', 'center_armscross'], every: [15_000, 25_000] },
    right: { anims: ['right_writing'], every: [5_000, 9_000] },
  },
  thinking: {
    right: { anims: ['right_writing'], every: [5_000, 9_000] },
  },
}

const DEFAULT_CENTER = interviewerById(DEFAULT_INTERVIEWER)!.sprites

/** 동작 시트: 가운데는 고른 면접관 시트, 좌우는 배석자 시트(둘 다 대체 세트일 수 있다). loop는 ANIMS 규칙 */
export function sheetFor(
  name: AnimName,
  center: CenterSprites = DEFAULT_CENTER,
  side: SideSprites = SIDE_SPRITES,
): CenterSheet & { loop: boolean } {
  const i = name.indexOf('_')
  const char = name.slice(0, i) as Char
  const role = name.slice(i + 1)
  const s =
    char === 'center'
      ? center[role as CenterRole]
      : char === 'left'
        ? side.left[role as LeftRole]
        : side.right[role as RightRole]
  return { file: s.file, frames: s.frames, loop: ANIMS[name].loop }
}
