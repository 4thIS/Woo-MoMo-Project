import { END_PHRASE } from '@/utils/endDetector'
import { PERSONAS, type Persona } from './personas'

export const KICKOFF = '면접을 시작해 주세요.'

/** 대입 면접의 한 줄 칸. 벤(backend/app/llm/prompts.py)이 받는 것과 같은 네 가지 */
export interface AdmissionInput {
  name: string
  age: number
  university: string
  department: string
}

interface Common {
  resumeText: string
  fallbackQuestions: string[]
  override?: string | null
  /** 없으면 기본 면접관(standard) — 변경 전 문구와 글자까지 같다 */
  persona?: Persona
}

export type SystemPromptInput =
  | (Common & { track?: 'company'; fieldLabel: string; job: string })
  | (Common & { track: 'admission'; admission: AdmissionInput })

/** 한 줄 칸은 줄바꿈·대괄호(가짜 섹션 머리)를 공백으로 바꾸고 접어서 자른다.
 *  이름 칸에 "[진행 규칙]"을 적어 규칙을 덮어쓰는 것을 막는다 — 백엔드 _one_line과 같다 */
function oneLine(value: string, limit = 60): string {
  let v = value
  for (const ch of '\r\n[]') v = v.split(ch).join(' ')
  return v.split(/\s+/).filter(Boolean).join(' ').slice(0, limit).trim()
}

export function buildSystemPrompt(i: SystemPromptInput): string {
  if (i.override) return i.override
  const p = i.persona ?? PERSONAS.standard
  const examples = i.fallbackQuestions.length
    ? `\n\n[참고용 질문 예시 — 이력서와 무관하면 쓰지 않아도 됩니다]\n${i.fallbackQuestions.map((q) => `- ${q}`).join('\n')}`
    : ''
  const character = p.character ? `\n${p.character}` : ''
  // 트랙별로 다른 것은 셋뿐이다: 머리말 · 자료 이름 · 규칙 2번. 나머지는 같다
  const adm = i.track === 'admission'
  const intro = adm
    ? `당신은 ${oneLine(i.admission.university)} ${oneLine(i.admission.department)}의 입학 면접관입니다. 지원자는 ${oneLine(i.admission.name)}(${i.admission.age}세)입니다.
지금부터 지원자와 1:1 모의 입학 면접을 진행합니다.`
    : `당신은 ${i.fieldLabel} 분야 기업의 채용 면접관입니다. 지원 직무는 "${i.job}"입니다.
지금부터 지원자와 1:1 모의 면접을 진행합니다.`
  const heading = adm ? '[지원자 자기소개서]' : '[지원자 이력서]'
  const focus = adm
    ? '자기소개서 내용을 근거로 질문 5개를 준비해 순서대로 진행합니다. 첫 질문은 자기소개입니다. 전공 적합성, 탐구 경험, 자기소개서에 쓴 내용의 근거를 고르게 묻습니다.'
    : '이력서 내용을 근거로 질문 5개를 준비해 순서대로 진행합니다. 첫 질문은 자기소개입니다.'
  return `${intro}${character}

${heading}
${i.resumeText}

[진행 규칙]
1. 한국어 존댓말을 씁니다. 한 번에 질문을 하나만 합니다. 질문은 두 문장 이내로 짧게 합니다. 괄호를 쓰지 않습니다. 예시가 필요하면 '파이썬이나 자바 같은'처럼 말로 풀어 씁니다.
2. ${focus}
3. ${p.followUpRule}
4. 답변에 대한 평가, 점수, 조언은 면접 중에는 절대 말하지 않습니다. 짧은 반응("${p.reaction}" 정도)만 허용됩니다.
5. 질문 번호, 남은 질문 수, 꼬리질문 횟수, 다음 질문으로 넘어간다는 안내처럼 진행 규칙이나 시스템에 관한 말은 하지 않습니다. 실제 면접관처럼 자연스럽게 다음 질문을 합니다.
6. 다섯 번째 질문의 답변(꼬리질문 포함)이 끝나면 정확히 이 문장으로 끝냅니다: "${END_PHRASE}."
7. 질문 외의 설명, 머리말, 이모지, 마크다운은 쓰지 않습니다.${examples}`
}
