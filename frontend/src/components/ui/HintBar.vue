<script setup lang="ts">
/** 상황별 힌트 — 화면 아래 한 줄. 지금 할 일 하나만 말한다 (spec 2026-10-12-hints-design).
 *
 * 조건은 전부 utils/hints의 hintFor에 있다. 여기서는 스토어에서 맥락을 모아 넘기고 그리기만 한다.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { hintFor, type HintContext } from '@/utils/hints'
import { useHintsStore } from '@/stores/hints'
import { useInterviewStore } from '@/stores/interview'
import { useInterviewerStore } from '@/stores/interviewer'

const hints = useHintsStore()
const interview = useInterviewStore()
const iv = useInterviewerStore()

const ctx = computed<HintContext>(() => ({
  phase: interview.phase,
  interviewerPicked: iv.id !== null,
  profileDone: interview.profileDone,
  resumeDone: interview.resumeDone,
  canStart: interview.canStart,
  stage: interview.stage,
  answered: interview.messages.some((m) => m.role === 'user'),
  seen: hints.seen,
  enabled: hints.enabled,
}))
/** 지금 상황을 한 줄로. 확인을 누른 뒤 이 값이 그대로면 다음 힌트를 띄우지 않는다 —
 *  닫자마자 다음 것이 튀어나오면 잔소리가 된다. 상황이 바뀌면 그때 말을 건다 */
const situation = computed(() =>
  [
    ctx.value.phase,
    ctx.value.interviewerPicked,
    ctx.value.profileDone,
    ctx.value.resumeDone,
    ctx.value.canStart,
    ctx.value.stage,
    ctx.value.answered,
  ].join('|'),
)
const restingAt = ref<string | null>(null)
const hint = computed(() => (restingAt.value === situation.value ? null : hintFor(ctx.value)))

/* 바가 차지하는 높이를 화면들에 알린다 — 면접 화면은 100vh라 자리를 비워 주지 않으면 대화창을 덮는다.
 * 문구가 길어 두 줄이 되는 좁은 화면도 있어 실제 높이를 잰다 */
const el = ref<HTMLElement | null>(null)
const GAP = 20 // --sp-5, 바와 화면 아래 사이
let ro: ResizeObserver | null = null
function space(px: number) {
  document.documentElement.style.setProperty('--hint-space', `${px}px`)
}
watch(el, (node) => {
  ro?.disconnect()
  ro = null
  // 힌트가 사라져도 **켜져 있는 동안은 자리를 비워 둔다.** 면접 화면은 100vh라
  // 이 값이 오르내리면 그때마다 무대와 대화창이 늘었다 줄었다 한다(출렁임)
  if (!node) return hints.enabled ? undefined : space(0)
  if (typeof ResizeObserver === 'undefined') return space(node.offsetHeight + GAP * 2)
  ro = new ResizeObserver(() => space(node.offsetHeight + GAP * 2))
  ro.observe(node)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  space(0)
})

/** 그만 보기를 누르면 비워 둔 자리를 돌려준다 */
watch(
  () => hints.enabled,
  (on) => {
    if (!on) space(0)
  },
)

function dismiss(key: string) {
  hints.markSeen(key)
  restingAt.value = situation.value
}
</script>

<template>
  <Transition name="hint">
    <aside v-if="hint" ref="el" class="bar" role="status" data-test="hint">
      <p class="text">{{ hint.text }}</p>
      <div class="acts">
        <button type="button" class="ok" data-test="hint-ok" @click="dismiss(hint.key)">
          확인
        </button>
        <button type="button" class="off" data-test="hint-off" @click="hints.disable()">
          그만 보기
        </button>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.bar {
  position: fixed;
  left: 50%;
  bottom: var(--sp-5);
  transform: translateX(-50%);
  z-index: 50;
  width: min(calc(100vw - var(--sp-8)), 760px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-5);
  padding: var(--sp-4) var(--sp-5);
  background: var(--win);
  border: var(--win-border);
  box-shadow: var(--win-shadow);
}
.text {
  margin: 0;
  font-family: var(--font-body);
  font-size: var(--fs-body-sm);
  line-height: 1.6;
  color: var(--text);
}
.acts {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex-shrink: 0;
}
button {
  font-family: var(--font-mono);
  font-size: var(--fs-meta);
  background: none;
  border: none;
  padding: var(--sp-2) var(--sp-1);
  cursor: pointer;
}
.ok {
  color: var(--accent);
}
.off {
  color: var(--text-3);
}
button:hover,
button:focus-visible {
  text-decoration: underline;
}

.hint-enter-active,
.hint-leave-active {
  transition:
    opacity var(--dur-2) var(--ease),
    transform var(--dur-2) var(--ease);
}
.hint-enter-from,
.hint-leave-to {
  opacity: 0;
  transform: translate(-50%, var(--sp-3));
}
@media (prefers-reduced-motion: reduce) {
  .hint-enter-active,
  .hint-leave-active {
    transition: none;
  }
}
</style>
