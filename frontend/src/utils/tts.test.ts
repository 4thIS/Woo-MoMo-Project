import { describe, expect, it } from 'vitest'
import {
  KO_JA_MAX,
  chunkText,
  gaussianNoise,
  latentShape,
  lengthMask,
  normalizeText,
  textToIds,
} from './tts'

describe('normalizeText', () => {
  it('공백 정리 + 끝에 마침표 + 언어 태그', () => {
    // NFKD는 한글 음절을 자모로 정준 분해한다(예제와 동일 동작) — 기대값은 화면에는
    // 완성형과 동일하게 보이지만 실제로는 자모 시퀀스(U+11xx)로 정규화된 문자열이다.
    expect(normalizeText('안녕하세요   자기소개 부탁드립니다', 'ko').normalize('NFC')).toBe(
      '<ko>안녕하세요 자기소개 부탁드립니다.</ko>',
    )
  })
  it('문장부호로 끝나면 마침표를 덧붙이지 않는다', () => {
    expect(normalizeText('어떻게 해결하셨나요?', 'ko').normalize('NFC')).toBe(
      '<ko>어떻게 해결하셨나요?</ko>',
    )
  })
  it('이모지·대시·괄호 치환, 문장부호 앞 공백 제거', () => {
    expect(normalizeText('좋아요 😀 — 그럼 , 다음 [질문]', 'ko').normalize('NFC')).toBe(
      '<ko>좋아요 - 그럼, 다음 질문.</ko>',
    )
  })
  it('지원하지 않는 언어는 던진다', () => {
    expect(() => normalizeText('x', 'zz')).toThrow(/Invalid language/)
  })
})

describe('chunkText', () => {
  it('짧은 글은 한 덩어리', () => {
    expect(chunkText('첫 문장입니다. 둘째 문장입니다.', KO_JA_MAX)).toEqual([
      '첫 문장입니다. 둘째 문장입니다.',
    ])
  })
  it('상한을 넘으면 문장 경계에서 나눈다', () => {
    const s1 = '가'.repeat(70) + '.'
    const s2 = '나'.repeat(70) + '.'
    expect(chunkText(`${s1} ${s2}`, KO_JA_MAX)).toEqual([s1, s2])
  })
  it('빈 단락은 버린다', () => {
    expect(chunkText('하나.\n\n\n둘.', 300)).toEqual(['하나.', '둘.'])
  })
})

describe('textToIds / lengthMask / latentShape / gaussianNoise', () => {
  it('textToIds는 코드포인트를 인덱서로 바꾸고 범위 밖은 -1', () => {
    const indexer = new Array(128).fill(0).map((_, i) => i + 1)
    expect(textToIds('ab', indexer)).toEqual([98, 99])
    expect(textToIds('가', indexer)).toEqual([-1])
  })
  it('lengthMask는 길이만큼 1', () => {
    expect(lengthMask([2, 3])).toEqual([
      [1, 1, 0],
      [1, 1, 1],
    ])
    expect(lengthMask([1], 3)).toEqual([[1, 0, 0]])
  })
  it('latentShape는 예제와 같은 수식', () => {
    // 2.0초, 44100Hz, base_chunk 512, compress 6, latent_dim 24 → chunk 3072, latentLen ceil(88200/3072)=29, dim 144
    expect(latentShape(2, 44100, 512, 6, 24)).toEqual({
      latentLen: 29,
      latentDimVal: 144,
      chunkSize: 3072,
    })
  })
  it('gaussianNoise는 주입한 rng로 결정적', () => {
    let k = 0
    const rng = () => [0.5, 0.25, 0.5, 0.75][k++ % 4]
    const a = gaussianNoise(2, rng)
    k = 0
    const b = gaussianNoise(2, rng)
    expect(Array.from(a)).toEqual(Array.from(b))
    expect(a).toHaveLength(2)
  })
})
