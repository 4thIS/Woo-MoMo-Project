import type { Stage } from '@/stores/interview'

export type AnimName =
  | 'left_idle'
  | 'left_react'
  | 'left_watch'
  | 'center_idle'
  | 'center_talk'
  | 'center_nod'
  | 'center_react'
  | 'center_watch'
  | 'clerk_idle'
  | 'clerk_write'

/** public/sprites/interviewers/manifest.json과 동일하게 유지한다 (32×32, 0번 기본 + 1..N 루프) */
export const ANIMS: Record<AnimName, { file: string; frames: number; loop: boolean }> = {
  left_idle: { file: '/sprites/interviewers/left_idle.png', frames: 5, loop: true },
  left_react: { file: '/sprites/interviewers/left_react.png', frames: 9, loop: false },
  left_watch: { file: '/sprites/interviewers/left_watch.png', frames: 9, loop: false },
  center_idle: { file: '/sprites/interviewers/center_idle.png', frames: 5, loop: true },
  center_talk: { file: '/sprites/interviewers/center_talk.png', frames: 7, loop: true },
  center_nod: { file: '/sprites/interviewers/center_nod.png', frames: 5, loop: true },
  center_react: { file: '/sprites/interviewers/center_react.png', frames: 9, loop: false },
  center_watch: { file: '/sprites/interviewers/center_watch.png', frames: 9, loop: false },
  clerk_idle: { file: '/sprites/interviewers/clerk_idle.png', frames: 5, loop: true },
  clerk_write: { file: '/sprites/interviewers/clerk_write.png', frames: 9, loop: true },
}
export const CANDIDATE_BACK = { file: '/sprites/interviewers/candidate_back.png', w: 48, h: 32 }
export const FPS = 10
export const SCALE = 6

export function animsFor(
  stage: Stage,
  o: { react: boolean; watch: boolean },
): { left: AnimName; center: AnimName; clerk: AnimName } {
  if (o.react) return { left: 'left_react', center: 'center_react', clerk: 'clerk_write' }
  if (o.watch) return { left: 'left_watch', center: 'center_watch', clerk: 'clerk_idle' }
  switch (stage) {
    case 'asking':
      return { left: 'left_idle', center: 'center_talk', clerk: 'clerk_idle' }
    case 'listening':
    case 'thinking':
      return { left: 'left_idle', center: 'center_nod', clerk: 'clerk_write' }
    default:
      return { left: 'left_idle', center: 'center_idle', clerk: 'clerk_idle' }
  }
}
