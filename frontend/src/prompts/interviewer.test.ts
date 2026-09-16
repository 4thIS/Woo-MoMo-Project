import { describe, expect, it } from 'vitest'
import { KICKOFF, buildSystemPrompt } from './interviewer'
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
