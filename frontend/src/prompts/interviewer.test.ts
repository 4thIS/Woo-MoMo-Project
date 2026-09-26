import { describe, expect, it } from 'vitest'
import { KICKOFF, buildSystemPrompt } from './interviewer'
import { PERSONAS } from './personas'
import { END_PHRASE } from '@/utils/endDetector'

const base = {
  fieldLabel: 'IT',
  job: '백엔드 개발자',
  resumeText: '이력서 본문',
  fallbackQuestions: ['q1', 'q2'],
}

describe('buildSystemPrompt', () => {
  it('분야·직무·이력서·종료 문장을 포함한다', () => {
    const p = buildSystemPrompt(base)
    expect(p).toContain('IT 분야')
    expect(p).toContain('"백엔드 개발자"')
    expect(p).toContain('이력서 본문')
    expect(p).toContain(`"${END_PHRASE}."`)
  })
  it('폴백 질문을 목록으로 넣는다', () => {
    expect(buildSystemPrompt(base)).toContain('- q1\n- q2')
  })
  it('폴백 질문이 없으면 참고 절을 생략한다', () => {
    expect(buildSystemPrompt({ ...base, fallbackQuestions: [] })).not.toContain('참고용 질문 예시')
  })
  it('override가 있으면 그대로 쓴다', () => {
    expect(buildSystemPrompt({ ...base, override: 'OVERRIDE' })).toBe('OVERRIDE')
  })
  it('KICKOFF 문구', () => expect(KICKOFF).toBe('면접을 시작해 주세요.'))
})

/** 변경 전(2026-09-26) buildSystemPrompt — standard 페르소나가 글자까지 같아야 한다 */
function legacy(i: typeof base): string {
  const examples = i.fallbackQuestions.length
    ? `\n\n[참고용 질문 예시 — 이력서와 무관하면 쓰지 않아도 됩니다]\n${i.fallbackQuestions.map((q) => `- ${q}`).join('\n')}`
    : ''
  return `당신은 ${i.fieldLabel} 분야 기업의 채용 면접관입니다. 지원 직무는 "${i.job}"입니다.
지금부터 지원자와 1:1 모의 면접을 진행합니다.

[지원자 이력서]
${i.resumeText}

[진행 규칙]
1. 한국어 존댓말을 씁니다. 한 번에 질문을 하나만 합니다. 질문은 두 문장 이내로 짧게 합니다.
2. 이력서 내용을 근거로 질문 5개를 준비해 순서대로 진행합니다. 첫 질문은 자기소개입니다.
3. 지원자의 답변이 짧거나 구체성이 부족하거나 흥미로우면 꼬리질문을 할 수 있습니다. 한 질문당 꼬리질문은 최대 2개입니다.
4. 답변에 대한 평가, 점수, 조언은 면접 중에는 절대 말하지 않습니다. 짧은 반응("네, 알겠습니다." 정도)만 허용됩니다.
5. 질문 번호나 남은 질문 수를 말하지 않습니다.
6. 다섯 번째 질문의 답변(꼬리질문 포함)이 끝나면 정확히 이 문장으로 끝냅니다: "${END_PHRASE}."
7. 질문 외의 설명, 머리말, 이모지, 마크다운은 쓰지 않습니다.${examples}`
}

describe('buildSystemPrompt — 페르소나', () => {
  it('persona가 없거나 standard면 변경 전 문구와 글자까지 같다', () => {
    expect(buildSystemPrompt(base)).toBe(legacy(base))
    expect(buildSystemPrompt({ ...base, persona: PERSONAS.standard })).toBe(legacy(base))
  })
  it('gentle·sharp는 성격 문장이 둘째 줄 뒤에, 규칙 3·4에 자기 값이 들어간다', () => {
    for (const id of ['gentle', 'sharp'] as const) {
      const p = PERSONAS[id]
      const out = buildSystemPrompt({ ...base, persona: p })
      expect(out).toContain(
        `지금부터 지원자와 1:1 모의 면접을 진행합니다.\n${p.character}\n\n[지원자 이력서]`,
      )
      expect(out).toContain(`\n3. ${p.followUpRule}\n`)
      expect(out).toContain(`짧은 반응("${p.reaction}" 정도)만 허용됩니다.`)
    }
  })
  it('세 페르소나 모두 공통 규칙(질문 5개·종료 문장·평가 금지)을 유지한다', () => {
    for (const p of Object.values(PERSONAS)) {
      const out = buildSystemPrompt({ ...base, persona: p })
      expect(out).toContain('이력서 내용을 근거로 질문 5개를 준비해 순서대로 진행합니다.')
      expect(out).toContain(`"${END_PHRASE}."`)
      expect(out).toContain('답변에 대한 평가, 점수, 조언은 면접 중에는 절대 말하지 않습니다.')
    }
  })
  it('override가 있으면 페르소나와 무관하게 그대로 쓴다', () => {
    expect(buildSystemPrompt({ ...base, override: 'OVERRIDE', persona: PERSONAS.sharp })).toBe(
      'OVERRIDE',
    )
  })
})
