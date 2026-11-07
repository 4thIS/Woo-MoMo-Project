/** 벤 성향 다섯 축 (`docs/API.md`의 `benSettings`, 2026-11-07).
 *
 * 화면은 **눈금 위치(0·1·2)만** 안다. API 값 이름(`low`·`balanced`…)은 보낼 때만 쓴다.
 * 여기 `base`는 `docs/API.md`가 적은 기본값과 **같아야 한다** — 다르면 "손대지 않으면
 * 지금 벤 그대로"라는 약속이 깨진다. 테스트가 그 일치를 지킨다.
 *
 * 값 이름을 그대로 보이지 않고 **무엇이 달라지는지**를 적는 것이 이 표의 목적이다.
 */

/** 눈금 위치. 왼쪽부터 0·1·2 */
export type Notch = 0 | 1 | 2

export interface BenAxisValues {
  warmth: Notch
  followUp: Notch
  questionMix: Notch
  difficulty: Notch
  companyWeight: Notch
}

export interface BenAxis {
  key: keyof BenAxisValues
  /** 화면에 적는 이름 */
  label: string
  /** API 값 이름. 눈금 위치 그대로의 차례 */
  api: readonly [string, string, string]
  /** 고른 값으로 크게 적는 말 */
  names: readonly [string, string, string]
  /** 고른 값 옆 한 줄 — 무엇이 달라지는지 */
  hints: readonly [string, string, string]
  /** 기본 눈금 */
  base: Notch
}

export const BEN_AXES: readonly BenAxis[] = [
  {
    key: 'warmth',
    label: '말투',
    api: ['low', 'mid', 'high'],
    names: ['날카롭게', '보통', '부드럽게'],
    hints: ['칭찬 없이 짚고 넘어갑니다', '표준 말투입니다', '격려하며 묻습니다'],
    base: 0,
  },
  {
    key: 'followUp',
    label: '꼬리질문',
    api: ['low', 'mid', 'high'],
    names: ['적게', '보통', '많이'],
    hints: ['너무 짧을 때만', '질문당 2개까지', '근거가 안 보이면 파고듭니다'],
    base: 1,
  },
  {
    key: 'questionMix',
    label: '질문 성격',
    api: ['technical', 'balanced', 'personal'],
    names: ['직무 지식', '고루', '사람 · 동기'],
    hints: ['아는 것과 푸는 법을', '한쪽으로 몰지 않습니다', '협업 · 갈등 · 동기를'],
    base: 1,
  },
  {
    key: 'difficulty',
    label: '난이도',
    api: ['basic', 'practical', 'advanced'],
    names: ['기초', '실무', '심화'],
    hints: ['개념을 확인합니다', '해 본 일을 묻습니다', '왜 그걸 골랐는지까지'],
    base: 1,
  },
  {
    key: 'companyWeight',
    label: '회사 이야기',
    api: ['low', 'mid', 'high'],
    names: ['적게', '보통', '많이'],
    hints: ['회사 소식 1개', '회사 소식 1~2개', '회사 소식 2~3개'],
    base: 1,
  },
] as const

/** 손대지 않은 상태. 이 그대로면 요청에 `benSettings`를 **싣지 않는다**.
 *  표에서 뽑지 않고 적어 두는 이유 — 타입이 다섯 칸을 다 세어 주기 때문이다.
 *  표와 어긋나면 바로 아래 테스트가 잡는다 */
export const DEFAULT_BEN: BenAxisValues = {
  warmth: 0,
  followUp: 1,
  questionMix: 1,
  difficulty: 1,
  companyWeight: 1,
}
