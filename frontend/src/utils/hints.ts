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
  /** 눌러야/써야 할 곳의 CSS 선택자. 커서가 여기로 날아간다. 쉼표로 여러 개를 두면 먼저 보이는 것 */
  target: string
  /** click = 누르는 곳(마우스 커서) · type = 쓰는 곳(키보드) */
  kind: 'click' | 'type'
  when(ctx: HintContext): boolean
}

/** 우선순위 순. 위에서부터 보고 처음 맞는 하나만 띄운다 */
export const HINTS: readonly Hint[] = [
  {
    key: 'pick-interviewer',
    target: '[data-test=picker] [role=radio]',
    kind: 'click',
    phase: 'landing',
    text: '먼저 면접관을 고르세요. 고른 사람의 목소리로 면접이 진행됩니다.',
    when: (c) => !c.interviewerPicked,
  },
  {
    key: 'go-prepare',
    target: '[data-test=go-prepare], [data-test=consent] [role=radio]',
    kind: 'click',
    phase: 'landing',
    text: '아래에서 다운로드에 동의하고 장비 확인을 마치면 준비 화면으로 넘어갑니다.',
    // 면접관을 고른 사람에게도, 고르라는 말을 이미 읽은 사람에게도 다음 할 일은 같다
    when: () => true,
  },
  {
    key: 'prepare-profile',
    target: '[data-test=job]',
    kind: 'type',
    phase: 'prepare',
    text: '모델을 받는 동안 직군과 희망 직무를 채워 주세요. 왼쪽 출근 장면이 다운로드 진행률입니다.',
    when: (c) => !c.profileDone,
  },
  {
    key: 'prepare-resume',
    target: '[data-test=drop]',
    kind: 'click',
    phase: 'prepare',
    text: '이력서 PDF를 올리거나 붙여 넣으세요. 파일은 이 브라우저를 떠나지 않습니다.',
    when: (c) => c.profileDone && !c.resumeDone,
  },
  {
    key: 'prepare-start',
    target: '[data-test=start]',
    kind: 'click',
    phase: 'prepare',
    text: '준비됐습니다. “면접 시작”을 누르면 면접관이 첫 질문을 합니다.',
    when: (c) => c.canStart,
  },
  // 면접 힌트는 지원자 차례에만 뜬다. 면접관이 말하거나 생각하는 중에 말을 거는 것은 방해다
  {
    key: 'interview-answer',
    target: '[data-test=answer]',
    kind: 'type',
    phase: 'interview',
    text: '면접관이 기다립니다. 아래 칸에 쓰거나 “말하기”로 목소리로 답하세요.',
    when: (c) => c.stage === 'waiting' && !c.answered,
  },
  {
    key: 'interview-end',
    target: '[data-test=end]',
    kind: 'click',
    phase: 'interview',
    text: '그만하고 싶으면 “면접 종료”를 누르세요. 리포트는 그때 만들어집니다.',
    when: (c) => c.stage === 'waiting' && c.answered,
  },
  {
    key: 'report-read',
    target: '[data-test=print]',
    kind: 'click',
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

/* ── 커서를 둘 자리 ───────────────────────────────────────────── */

/** 커서가 차지하는 칸. 화면 밖으로 나가지 않게 계산에 쓴다 */
export const POINTER = { w: 20, h: 30, gap: 6 } as const
/** 대상이 이만큼은 화면 안에 들어와 있어야 한다 — 커서가 놓일 자리까지 */
export const SCROLL_MARGIN = POINTER.h + POINTER.gap + 16

export interface Box {
  top: number
  left: number
  width: number
  height: number
}

export interface PointerSpot {
  x: number
  y: number
  /** 대상 위에 놓였는가 — 커서를 뒤집어 아래를 가리키게 한다 */
  above: boolean
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** 어디에 붙일까.
 *  - `outside`: 누르는 곳. 대상 아래(모자라면 위) 가운데에 선다
 *  - `inside`: 쓰는 곳. 입력칸 **안쪽** 오른쪽에 들어간다 — 칸 밖에 두면 아래 본문 글자를 덮는다
 */
export type Anchor = 'outside' | 'inside'
/** 입력칸 오른쪽 테두리에서 띄울 거리 */
const INSIDE_INSET = 10

export function pointerSpot(
  box: Box,
  vw: number,
  vh: number,
  anchor: Anchor = 'outside',
): PointerSpot {
  if (anchor === 'inside') {
    return {
      x: clamp(box.left + box.width - POINTER.w - INSIDE_INSET, 0, Math.max(0, vw - POINTER.w)),
      y: clamp(box.top + (box.height - POINTER.h) / 2, 0, Math.max(0, vh - POINTER.h)),
      above: false,
    }
  }
  const x = clamp(box.left + box.width / 2 - POINTER.w / 2, 0, Math.max(0, vw - POINTER.w))
  const below = box.top + box.height + POINTER.gap
  const above = below + POINTER.h > vh
  const y = above ? box.top - POINTER.h - POINTER.gap : below
  return { x, y: clamp(y, 0, Math.max(0, vh - POINTER.h)), above }
}

/** 대상이 화면 밖이거나 가장자리에 붙어 커서 자리가 없으면 스크롤해 보여 준다 */
export function needsScroll(box: Pick<Box, 'top' | 'height'>, vh: number): boolean {
  return box.top < SCROLL_MARGIN || box.top + box.height > vh - SCROLL_MARGIN
}
