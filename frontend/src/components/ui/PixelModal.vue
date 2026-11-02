<script lang="ts">
/** 지금 열려 있는 모달들. 맨 뒤가 가장 위다.
 *
 * `<script setup>`은 인스턴스마다 새로 실행되므로, 모달끼리 나눠 보려면 여기(모듈 스코프)에 둬야 한다.
 * 가입 폼 위에 약관을 띄우는 자리가 있어 **겹쳐 열리는 일이 실제로 있다** — 그때
 * Esc 한 번에 둘 다 닫히면 적던 입력이 통째로 사라진다.
 */
const open_: symbol[] = []
</script>

<script setup lang="ts">
/** 모달 공통 껍데기 (spec 7.0).
 *
 * 겹쳐 열릴 수 있다. Esc는 맨 위 하나만 닫고, 뒤 페이지 잠금은 마지막 하나가 닫힐 때 푼다.
 * 내용이 길면 모달이 아니라 **안쪽이** 스크롤한다.
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    width?: 'md' | 'wide'
    /** false면 판(배경·테두리·그림자·여백)을 빼고 내용만 띄운다.
     *  내용 자체가 이미 카드 묶음일 때 판이 한 겹 더 있으면 자리만 먹는다 */
    chrome?: boolean
  }>(),
  {
    title: undefined,
    width: 'md',
    chrome: true,
  },
)
const emit = defineEmits<{ close: [] }>()

const box = ref<HTMLElement | null>(null)
/** 이 모달의 표. 열린 목록에서 자기를 가려내는 데만 쓴다 */
const me = Symbol('modal')
/** 닫는 중 — Esc 연타·덮개 더블클릭으로 close가 두 번 나가지 않게 막는다 */
let closing = false

function close() {
  if (closing) return
  closing = true
  emit('close')
}

function onKey(e: KeyboardEvent) {
  // 맨 위에 있는 모달만 받는다 — 아래 창까지 함께 닫히면 거기 적던 것이 사라진다
  if (e.key === 'Escape' && open_[open_.length - 1] === me) close()
}

function detach() {
  const i = open_.indexOf(me)
  if (i >= 0) open_.splice(i, 1)
  document.removeEventListener('keydown', onKey)
  // 아래에 아직 열린 모달이 남아 있으면 잠금은 그대로 둔다
  if (!open_.length) document.body.style.overflow = ''
}

watch(
  () => props.open,
  async (on) => {
    closing = false
    if (!on) return detach()
    open_.push(me)
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    await nextTick()
    box.value?.focus()
  },
  { immediate: true },
)

onBeforeUnmount(detach)
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="open"
        class="veil"
        :class="{ deep: !chrome }"
        data-test="modal-veil"
        @click.self="close"
      >
        <div
          ref="box"
          class="box"
          :class="[width, { bare: !chrome }]"
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          data-test="modal"
        >
          <slot name="head">
            <header class="head">
              <h2 v-if="title" class="display ttl">{{ title }}</h2>
              <button type="button" class="mono x" data-test="modal-close" @click="close">
                닫기 ✕
              </button>
            </header>
          </slot>
          <div class="body"><slot /></div>
          <footer v-if="$slots.foot" class="foot"><slot name="foot" /></footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.veil {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: var(--veil);
  display: grid;
  place-items: center;
  padding: var(--sp-6) var(--sp-4);
}
/* 판이 없으면 카드 사이로 뒤가 더 보인다 */
.veil.deep {
  background: var(--veil-deep);
}
.box {
  background-color: var(--win);
  background-image: repeating-linear-gradient(transparent 0 2px, var(--scan) 2px 4px);
  border: var(--win-border);
  box-shadow: var(--win-shadow);
  width: 100%;
  max-width: 960px;
  max-height: calc(100vh - var(--sp-10));
  padding: 34px 40px;
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
}
/* 대화상자 자체는 조작 요소가 아니다. 열 때 포커스를 받는 건 Esc·Tab을 위해서일 뿐이라
   링을 그리면 창 전체에 테두리가 하나 더 생긴 것처럼 보인다. 안쪽 요소의 링은 그대로 둔다 */
.box:focus {
  outline: none;
}
.box.wide {
  max-width: 1160px;
}
/* 판을 뺀 모드 — 덮개 위에 내용만 뜬다 */
.box.bare {
  background: none;
  border: 0;
  box-shadow: none;
  padding: 0;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-5);
}
.ttl {
  margin: 0;
  font-size: var(--fs-h2);
}
.x {
  font-size: var(--fs-label);
  color: var(--text-3);
  background: none;
  border: none;
  cursor: pointer;
}
.x:hover,
.x:focus-visible {
  color: var(--text);
}
/* 길어지면 모달이 아니라 안쪽이 스크롤한다 */
.body {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-3);
}
/* 열고 닫기: 막은 번지고 창은 살짝 솟는다. 사람의 행동에 대한 응답이라 넣는 모션이다 */
.modal-enter-active,
.modal-leave-active {
  transition: opacity var(--dur-2) var(--ease);
}
.modal-enter-active .box,
.modal-leave-active .box {
  transition:
    transform var(--dur-2) var(--ease),
    opacity var(--dur-2) var(--ease);
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .box,
.modal-leave-to .box {
  opacity: 0;
  transform: translateY(10px);
}
@media (prefers-reduced-motion: reduce) {
  .modal-enter-active,
  .modal-leave-active,
  .modal-enter-active .box,
  .modal-leave-active .box {
    transition: none;
  }
}

@media (max-width: 720px) {
  .veil {
    padding: var(--sp-3);
  }
  .box {
    padding: var(--sp-6) var(--sp-5);
  }
}
</style>
