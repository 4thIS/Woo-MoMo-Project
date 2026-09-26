import type { Stage } from '@/stores/interview'
import type { CenterRole, CenterSprites } from '@/interviewers'

export type Char = 'left' | 'center' | 'right'
export type AnimName =
  | 'left_idle'
  | 'left_pageflip'
  | 'center_idle'
  | 'center_question'
  | 'center_watch'
  | 'center_nod'
  | 'center_lookside'
  | 'center_armscross'
  | 'right_idle'
  | 'right_writing'
  | 'right_pentap'

/**
 * public/sprites/interviewers/manifest.json과 동일하게 유지한다 (32×32, 8fps).
 * idle은 0→N-1 순환. 나머지는 1회 재생하면 마지막 프레임이 idle 첫 자세라 그대로 idle에 이어진다.
 */
export const ANIMS: Record<AnimName, { file: string; frames: number; loop: boolean }> = {
  left_idle: { file: '/sprites/interviewers/left_idle.png', frames: 15, loop: true },
  left_pageflip: { file: '/sprites/interviewers/left_pageflip.png', frames: 10, loop: false },
  center_idle: { file: '/sprites/interviewers/center_idle.png', frames: 15, loop: true },
  center_question: { file: '/sprites/interviewers/center_question.png', frames: 10, loop: true },
  center_watch: { file: '/sprites/interviewers/center_watch.png', frames: 10, loop: false },
  center_nod: { file: '/sprites/interviewers/center_nod.png', frames: 11, loop: false },
  center_lookside: { file: '/sprites/interviewers/center_lookside.png', frames: 10, loop: false },
  center_armscross: { file: '/sprites/interviewers/center_armscross.png', frames: 28, loop: false },
  right_idle: { file: '/sprites/interviewers/right_idle.png', frames: 15, loop: true },
  right_writing: { file: '/sprites/interviewers/right_writing.png', frames: 10, loop: false },
  right_pentap: { file: '/sprites/interviewers/right_pentap.png', frames: 10, loop: false },
}
export const CANDIDATE_BACK = { file: '/sprites/interviewers/candidate_back.png', w: 32, h: 32 }
export const FPS = 8
export const SCALE = 5 // 면접관 ×5(160px)
export const CANDIDATE_SCALE = 6 // 지원자 ×6(192px) — 가까운 쪽이 커 보이게

export type Trio = Record<Char, AnimName>
const IDLE: Trio = { left: 'left_idle', center: 'center_idle', right: 'right_idle' }

/** 상태별 기본 애니. 말하는 중엔 가운데가 질문 제스처를 말이 끝날 때까지 반복한다 */
export function baseAnims(stage: Stage): Trio {
  return stage === 'speaking' ? { ...IDLE, center: 'center_question' } : IDLE
}

/** 좋은 답변: 끄덕임 2회 + 왼쪽 서류 확인 + 서기 필기 (전부 1회) */
export const REACT: Trio = { left: 'left_pageflip', center: 'center_nod', right: 'right_writing' }

/** 답변 지연 n번째 신호: 홀수는 가운데 손목시계, 짝수는 서기 펜 톡톡 (번갈아) */
export function watchAnim(tick: number): { char: Char; anim: AnimName } {
  return tick % 2 === 1
    ? { char: 'center', anim: 'center_watch' }
    : { char: 'right', anim: 'right_pentap' }
}

/**
 * 평시 잔동작(life): 상태별로 캐릭터가 가끔 하는 1회성 동작과 간격(ms, [min, max]).
 * 듣는 중엔 서기가 자주 받아 적고, 가운데는 가끔 고개를 돌리거나 팔짱을 끼거나 끄덕인다.
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
    center: {
      anims: ['center_lookside', 'center_armscross', 'center_nod'],
      every: [15_000, 25_000],
    },
    right: { anims: ['right_writing'], every: [5_000, 9_000] },
  },
  thinking: {
    center: { anims: ['center_nod'], every: [6_000, 10_000] },
    right: { anims: ['right_writing'], every: [5_000, 9_000] },
  },
}

/** 동작 시트: 가운데 동작은 고른 면접관 스프라이트(역할별)로 푼다. loop는 동작 규칙이라 ANIMS를 따른다(spec 4.6) */
export function sheetFor(
  name: AnimName,
  center?: CenterSprites,
): { file: string; frames: number; loop: boolean } {
  const a = ANIMS[name]
  if (!center || !name.startsWith('center_')) return a
  const s = center[name.slice('center_'.length) as CenterRole]
  return { file: s.file, frames: s.frames, loop: a.loop }
}
