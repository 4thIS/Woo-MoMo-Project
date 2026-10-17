/** 관리자 화면 표시용 순수 함수 */
export const fmtDate = (iso: string | null): string => (iso ? iso.slice(0, 10) : '—')
export const fmtDateTime = (iso: string | null): string =>
  iso ? iso.slice(0, 16).replace('T', ' ') : '—'
export const fmtMB = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1)
export const fmtUsd = (n: number): string => `$${n.toFixed(n >= 1 ? 2 : 4)}`
export const fmtInt = (n: number): string => n.toLocaleString('en-US')
