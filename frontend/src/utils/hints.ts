/** 상황별 힌트 — 지금 상태에서 할 일 하나를 고른다 (spec 2026-10-12-hints-design).
 *
 * 조건을 화면마다 흩지 않고 여기 한 곳에 모은다. 그래야 "지금 왜 이게 떴는지"를 추적할 수 있고
 * 둘이 동시에 뜨는 것을 막을 수 있다. 브라우저 API를 쓰지 않는 순수 모듈이다 — 기억은 스토어 몫.
 */
import type { Phase, Stage } from '@/stores/interview'

export interface HintContext {
  phase: Phase
  interviewerPicked: boolean
  profileDone: boolean
  resumeDone: boolean
  canStart: boolean
  /** 면접 단계 — 'waiting'일 때만 지원자 차례다 */
  stage: Stage
  answered: boolean
  seen: readonly string[]
  enabled: boolean
}

export interface Hint {
  key: string
  phase: Phase
  text: string
  when(ctx: HintContext): boolean
}

/** 우선순위 순. 위에서부터 보고 처음 맞는 하나만 띄운다 */
export const HINTS: readonly Hint[] = [
  {
    key: 'pick-interviewer',
    phase: 'landing',
    text: '먼저 면접관을 고르세요. 고른 사람의 목소리로 면접이 진행됩니다.',
    when: (c) => !c.interviewerPicked,
  },
  {
    key: 'go-prepare',
    phase: 'landing',
    text: '아래에서 다운로드에 동의하고 장비 확인을 마치면 준비 화면으로 넘어갑니다.',
    // 면접관을 고른 사람에게도, 고르라는 말을 이미 읽은 사람에게도 다음 할 일은 같다
    when: () => true,
  },
  {
    key: 'prepare-profile',
    phase: 'prepare',
    text: '모델을 받는 동안 지원 정보를 채워 주세요. 왼쪽 출근 장면이 다운로드 진행률입니다.',
    when: (c) => !c.profileDone,
  },
  {
    key: 'prepare-resume',
    phase: 'prepare',
    text: '이력서(또는 자기소개서)를 올리거나 붙여 넣으세요. 파일은 이 브라우저를 떠나지 않습니다.',
    when: (c) => c.profileDone && !c.resumeDone,
  },
  {
    key: 'prepare-start',
    phase: 'prepare',
    text: '준비됐습니다. “면접 시작”을 누르면 면접관이 첫 질문을 합니다.',
    when: (c) => c.canStart,
  },
  // 면접 힌트는 지원자 차례에만 뜬다. 면접관이 말하거나 생각하는 중에 말을 거는 것은 방해다
  {
    key: 'interview-answer',
    phase: 'interview',
    text: '면접관이 기다립니다. 아래 칸에 쓰거나 “말하기”로 목소리로 답하세요.',
    when: (c) => c.stage === 'waiting' && !c.answered,
  },
  {
    key: 'interview-end',
    phase: 'interview',
    text: '그만하고 싶으면 “면접 종료”를 누르세요. 리포트는 그때 만들어집니다.',
    when: (c) => c.stage === 'waiting' && c.answered,
  },
  {
    key: 'report-read',
    phase: 'report',
    text: '문항별 피드백이 아래에 있습니다. “PDF로 저장”으로 남기거나 “다시 면접 보기”로 한 번 더 하세요.',
    when: () => true,
  },
]

export function hintFor(ctx: HintContext): Hint | null {
  if (!ctx.enabled) return null
  return (
    HINTS.find((h) => h.phase === ctx.phase && !ctx.seen.includes(h.key) && h.when(ctx)) ?? null
  )
}
