export const GOOD_ANSWER_MIN_CHARS = 150
export const GOOD_ANSWER_MIN_SENTENCES = 2

export function isGoodAnswer(text: string): boolean {
  const t = text.trim()
  if (t.length < GOOD_ANSWER_MIN_CHARS) return false
  const sentences = t.split(/[.!?。\n]+/).filter((s) => s.trim().length > 0)
  return sentences.length >= GOOD_ANSWER_MIN_SENTENCES
}
