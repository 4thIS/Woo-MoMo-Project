/** 간단 이력서 항목 정의와 텍스트 합성. 화면(ResumeForm.vue)과 분리된 순수 모듈 */
export type ResumeField = {
  key: string
  label: string
  max: number
  hint: string
  long?: boolean
  optional?: boolean
}

export const RESUME_FIELDS: ResumeField[] = [
  { key: 'name', label: '이름', max: 20, hint: '예: 홍길동' },
  { key: 'age', label: '나이', max: 3, hint: '숫자만. 예: 27' },
  { key: 'edu', label: '최종학력', max: 60, hint: '예: 한국대학교 컴퓨터공학과 졸업' },
  {
    key: 'cert',
    label: '자격증',
    max: 120,
    hint: '쉼표로 구분. 없으면 비워 두고 다음',
    optional: true,
  },
  {
    key: 'career',
    label: '경력',
    max: 300,
    hint: '회사·직무·기간. 신입이면 비워 두고 다음',
    long: true,
    optional: true,
  },
  {
    key: 'social',
    label: '사회경험',
    max: 500,
    hint: '동아리·인턴·아르바이트·프로젝트 등',
    long: true,
  },
  { key: 'motive', label: '지원동기', max: 500, hint: '이 분야·직무에 지원하는 이유', long: true },
]

/** `라벨: 값` 한 줄씩. 비운 항목은 '없음' */
export function composeResume(values: Record<string, string>): string {
  return RESUME_FIELDS.map((f) => `${f.label}: ${(values[f.key] ?? '').trim() || '없음'}`).join(
    '\n',
  )
}
