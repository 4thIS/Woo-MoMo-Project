/** 관리자 화면 표시용 순수 함수. 시각(ISO)은 한국 시간(KST)으로, `YYYY-MM-DD`는 이미 KST 날짜라 그대로. */
const KST_PARTS = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** 'YYYY-MM-DD HH:mm' (KST). 파싱할 수 없으면 null */
const kstStamp = (iso: string): string | null => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : KST_PARTS.format(d).replace(/\u00a0/g, ' ')
}
const isDayOnly = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s)

export const fmtDate = (iso: string | null): string => {
  if (!iso) return '—'
  if (isDayOnly(iso)) return iso
  return kstStamp(iso)?.slice(0, 10) ?? iso.slice(0, 10)
}
export const fmtDateTime = (iso: string | null): string => {
  if (!iso) return '—'
  if (isDayOnly(iso)) return iso
  return kstStamp(iso) ?? iso.slice(0, 16).replace('T', ' ')
}
/** null이면 '—' */
export const fmtText = (s: string | null | undefined): string => s ?? '—'
export const fmtDelta = (n: number | null): string =>
  n === null ? '—' : n > 0 ? `+${n}` : String(n)
export const fmtMB = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1)
export const fmtUsd = (n: number): string => `$${n.toFixed(n >= 1 ? 2 : 4)}`
export const fmtInt = (n: number): string => n.toLocaleString('en-US')
