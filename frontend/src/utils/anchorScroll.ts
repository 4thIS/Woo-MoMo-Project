/** 해시를 건드리지 않고 문서 안의 id로 굴러간다 (2026-11-08).
 *
 * `<a href="#q3">`를 그냥 두면 브라우저가 **fragment navigation**을 하고, 그것이
 * `popstate`를 쏜다(`state: null`). 보관함 상세는 `popstate`를 듣고 화면을 닫으므로,
 * 목차를 누를 때마다 화면이 통째로 닫혔다.
 *
 * 링크는 `<a href>` 그대로 둔다 — Tab 차례·우클릭·새 탭으로 열기가 거저 따라온다.
 * 클릭만 가로채 직접 굴린다. 부드러운 스크롤은 쓰지 않는다(1번 철거 원칙).
 * 상단바를 피하는 일은 `html { scroll-padding-top }`이 맡는다.
 */
export function scrollToId(id: string): boolean {
  const el = document.getElementById(id)
  if (!el) return false
  el.scrollIntoView({ block: 'start' })
  return true
}
