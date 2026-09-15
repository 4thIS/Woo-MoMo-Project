import { onBeforeUnmount, onMounted, type Ref } from 'vue'

const SETTLE_MS = 700 // smooth 스크롤이 끝날 때까지 다음 휠 무시

/**
 * 휠 한 번 = 섹션(.snap) 한 칸 이동. CSS scroll-snap만으로는 짧은 휠 틱이 제자리로 되돌아가서
 * "슥" 넘어가지 않기에, 휠은 가로채서 다음/이전 섹션으로 scrollIntoView 한다.
 * 키보드·터치·scrollIntoView 정렬은 여전히 CSS snap이 맡는다.
 */
export function useSectionWheel(root: Ref<HTMLElement | null>) {
  let busy = false
  const onWheel = (e: WheelEvent) => {
    const el = root.value
    if (!el || Math.abs(e.deltaY) < 4) return
    if ((e.target as HTMLElement).closest('textarea')) return // 안쪽 스크롤은 그대로 둔다
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    e.preventDefault()
    if (busy) return
    const pad = parseFloat(getComputedStyle(el).scrollPaddingTop) || 0
    const sections = [...el.querySelectorAll<HTMLElement>('.snap')]
    if (!sections.length) return
    const pos = sections.map((s) => s.offsetTop - pad)
    let cur = 0
    pos.forEach((p, i) => {
      if (Math.abs(p - el.scrollTop) < Math.abs(pos[cur] - el.scrollTop)) cur = i
    })
    const next = Math.min(sections.length - 1, Math.max(0, cur + Math.sign(e.deltaY)))
    if (next === cur) return
    busy = true
    sections[next].scrollIntoView({ behavior: 'smooth', block: 'start' })
    setTimeout(() => (busy = false), SETTLE_MS)
  }
  onMounted(() => root.value?.addEventListener('wheel', onWheel, { passive: false }))
  onBeforeUnmount(() => root.value?.removeEventListener('wheel', onWheel))
}
