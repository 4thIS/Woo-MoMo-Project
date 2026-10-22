/** 주소 분기 — 라우터 없이 `/admin` 하나만 가른다. */
export const isAdminPath = (pathname: string = window.location.pathname): boolean =>
  pathname === '/admin' || pathname === '/admin/'
