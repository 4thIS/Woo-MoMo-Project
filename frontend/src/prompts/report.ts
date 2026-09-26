import type { Persona } from './personas'

export const REPORT_INSTRUCTION = `면접이 끝났습니다. 지금까지 당신이 한 질문과 지원자의 답변을 문항별로 정리해 피드백을 작성하세요.
꼬리질문은 원래 질문에 합쳐 하나의 문항으로 다룹니다.
아래 JSON 배열 형식으로만 출력하고, 다른 말은 하지 마세요. 코드 펜스는 써도 됩니다.
feedback 안에서 가장 중요한 구절 하나는 **별표 두 개**로 감싸 강조하세요.

[
  {"question": "질문 원문", "answerSummary": "지원자 답변 요약 (한두 문장)", "feedback": "구체적인 피드백 (두세 문장, 점수 없이)"}
]`

/** 리포트 지시문. 페르소나 말투 한 줄을 JSON 예시 바로 앞에 넣는다. 말투가 없으면 REPORT_INSTRUCTION 그대로 */
export function buildReportInstruction(persona?: Persona | null): string {
  const tone = persona?.reportTone
  return tone ? REPORT_INSTRUCTION.replace('\n\n[', `\n${tone}\n\n[`) : REPORT_INSTRUCTION
}
