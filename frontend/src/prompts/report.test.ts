import { describe, expect, it } from 'vitest'
import { REPORT_INSTRUCTION, buildReportInstruction } from './report'
import { PERSONAS } from './personas'

const jsonPart = (s: string) => s.slice(s.indexOf('\n\n[') + 2)

describe('buildReportInstruction', () => {
  it('페르소나가 없거나 standard면 지금 지시문 그대로', () => {
    expect(buildReportInstruction()).toBe(REPORT_INSTRUCTION)
    expect(buildReportInstruction(PERSONAS.standard)).toBe(REPORT_INSTRUCTION)
  })
  it('gentle·sharp는 말투 한 줄을 JSON 예시 바로 앞에 넣고, JSON 예시·분량은 그대로', () => {
    for (const id of ['gentle', 'sharp'] as const) {
      const out = buildReportInstruction(PERSONAS[id])
      expect(out).toContain(`\n${PERSONAS[id].reportTone}\n\n[`)
      expect(jsonPart(out)).toBe(jsonPart(REPORT_INSTRUCTION))
      expect(out.split('\n').length).toBe(REPORT_INSTRUCTION.split('\n').length + 1)
    }
  })
})
