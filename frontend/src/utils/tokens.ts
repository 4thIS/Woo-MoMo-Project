export function approxTokens(text: string): number {
  const hangul = (text.match(/[가-힣]/g) ?? []).length
  const other = text.length - hangul
  return hangul + Math.ceil(other / 4)
}
