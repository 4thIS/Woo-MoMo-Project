/** 지금 보고 있는 문항과 읽은 데까지 — 리포트 화면과 보관함 상세가 **같은 것**을 쓴다.
 *
 * `scrollTop`을 읽지 않는다(1번 철거에서 못 박은 원칙). `IntersectionObserver`만 쓴다.
 * 한 번 읽은 것은 지우지 않는다 — 위로 올라갔다고 안 읽은 게 되면 셈이 오락가락한다.
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

/** 머리에서 20%, 바닥에서 60% 안쪽에 들어온 것을 "지금 보는 것"으로 센다 */
const ROOT_MARGIN = '-20% 0px -60% 0px'

export function useReadingToc(body: Ref<HTMLElement | null>, items: Ref<unknown[]>) {
  const current = ref<string>()
  const read = ref(new Set<string>())
  let io: IntersectionObserver | null = null

  function watchCards() {
    io?.disconnect()
    if (typeof IntersectionObserver !== 'function' || !body.value) return
    io = new IntersectionObserver(
      (es) => {
        for (const e of es)
          if (e.isIntersecting) {
            const id = (e.target as HTMLElement).id
            current.value = id
            read.value = new Set(read.value).add(id)
          }
      },
      { rootMargin: ROOT_MARGIN },
    )
    for (const el of body.value.querySelectorAll('[id]')) io.observe(el)
  }

  onMounted(watchCards)
  watch(items, () => nextTick(watchCards))
  onBeforeUnmount(() => io?.disconnect())

  return { current, read }
}
