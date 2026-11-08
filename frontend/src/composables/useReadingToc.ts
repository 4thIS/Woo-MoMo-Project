/** 지금 보고 있는 문항 — 리포트 화면과 보관함 상세가 **같은 것**을 쓴다.
 *
 * `scrollTop`을 읽지 않는다(1번 철거에서 못 박은 원칙). `IntersectionObserver`만 쓴다.
 * 읽음 세기는 2026-11-08에 걷었다: 목차는 **눌러서 옮겨 다니는 자리**이지
 * 진도를 세는 자리가 아니다. 보관함은 다시 보러 온 자리라 셀 것도 없었다.
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

/** 머리에서 20%, 바닥에서 60% 안쪽에 들어온 것을 "지금 보는 것"으로 센다 */
const ROOT_MARGIN = '-20% 0px -60% 0px'

export function useReadingToc(body: Ref<HTMLElement | null>, items: Ref<unknown[]>) {
  const current = ref<string>()
  let io: IntersectionObserver | null = null

  function watchCards() {
    io?.disconnect()
    if (typeof IntersectionObserver !== 'function' || !body.value) return
    io = new IntersectionObserver(
      (es) => {
        for (const e of es) if (e.isIntersecting) current.value = (e.target as HTMLElement).id
      },
      { rootMargin: ROOT_MARGIN },
    )
    for (const el of body.value.querySelectorAll('[id]')) io.observe(el)
  }

  onMounted(watchCards)
  watch(items, () => nextTick(watchCards))
  onBeforeUnmount(() => io?.disconnect())

  return { current }
}
