/** 이력서 텍스트: 공백 정리 후 앞 max자만. 설계서 3.1 "약 2,000자 절단". */
export function truncateResume(text: string, max = 2000): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max)
}
