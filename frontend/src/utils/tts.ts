/** Supertonic 3 텍스트 전처리·형태 계산 (supertone-inc/supertonic web/helper.js, MIT 이식). 브라우저 API 없음 */
export const AVAILABLE_LANGS = [
  'en',
  'ko',
  'ja',
  'ar',
  'bg',
  'cs',
  'da',
  'de',
  'el',
  'es',
  'et',
  'fi',
  'fr',
  'hi',
  'hr',
  'hu',
  'id',
  'it',
  'lt',
  'lv',
  'nl',
  'pl',
  'pt',
  'ro',
  'ru',
  'sk',
  'sl',
  'sv',
  'tr',
  'uk',
  'vi',
  'na',
]
export const KO_JA_MAX = 120
export const DEFAULT_MAX = 300

const EMOJI =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu
const REPLACE: [string, string][] = [
  ['–', '-'],
  ['‑', '-'],
  ['—', '-'],
  ['_', ' '],
  ['“', '"'],
  ['”', '"'],
  ['‘', "'"],
  ['’', "'"],
  ['´', "'"],
  ['`', "'"],
  ['[', ' '],
  [']', ' '],
  ['|', ' '],
  ['/', ' '],
  ['#', ' '],
  ['→', ' '],
  ['←', ' '],
]
const EXPR: [string, string][] = [
  ['@', ' at '],
  ['e.g.,', 'for example, '],
  ['i.e.,', 'that is, '],
]

export function normalizeText(text: string, lang: string): string {
  if (!AVAILABLE_LANGS.includes(lang)) throw new Error(`Invalid language: ${lang}`)
  let t = text.normalize('NFKD').replace(EMOJI, '')
  for (const [a, b] of REPLACE) t = t.replaceAll(a, b)
  t = t.replace(/[♥☆♡©\\]/g, '')
  for (const [a, b] of EXPR) t = t.replaceAll(a, b)
  t = t.replace(/ ([,.!?;:'])/g, '$1')
  while (t.includes('""')) t = t.replace('""', '"')
  while (t.includes("''")) t = t.replace("''", "'")
  t = t.replace(/\s+/g, ' ').trim()
  if (!/[.!?;:,'")\]}…。」』】〉》›»]$/.test(t)) t += '.'
  return `<${lang}>${t}</${lang}>`
}

export function chunkText(text: string, maxLen: number): string[] {
  const out: string[] = []
  for (const para of text.trim().split(/\n\s*\n+/)) {
    const p = para.trim()
    if (!p) continue
    const sentences = p.split(
      /(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/,
    )
    let cur = ''
    for (const s of sentences) {
      if (cur.length + s.length + 1 <= maxLen) cur += (cur ? ' ' : '') + s
      else {
        if (cur) out.push(cur.trim())
        cur = s
      }
    }
    if (cur) out.push(cur.trim())
  }
  return out
}

export function textToIds(wrapped: string, indexer: number[]): number[] {
  const ids: number[] = []
  for (const ch of wrapped) {
    const cp = ch.codePointAt(0) ?? 0
    ids.push(cp < indexer.length ? indexer[cp] : -1)
  }
  return ids
}

export function lengthMask(lengths: number[], maxLen?: number): number[][] {
  const m = maxLen ?? Math.max(...lengths)
  return lengths.map((len) => Array.from({ length: m }, (_, j) => (j < len ? 1 : 0)))
}

export function latentShape(
  durSec: number,
  sampleRate: number,
  baseChunk: number,
  compress: number,
  latentDim: number,
) {
  const chunkSize = baseChunk * compress
  const wavLen = Math.floor(durSec * sampleRate)
  return {
    latentLen: Math.floor((wavLen + chunkSize - 1) / chunkSize),
    latentDimVal: latentDim * compress,
    chunkSize,
  }
}

export function gaussianNoise(n: number, rng: () => number = Math.random): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const u1 = Math.max(0.0001, rng())
    const u2 = rng()
    out[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  }
  return out
}
