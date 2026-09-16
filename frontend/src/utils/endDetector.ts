export const END_PHRASE = '면접을 마치겠습니다'

export function hasEndPhrase(text: string): boolean {
  return text.replace(/\s+/g, '').includes(END_PHRASE.replace(/\s+/g, ''))
}
