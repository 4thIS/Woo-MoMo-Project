<script setup lang="ts">
/** 모달 공통 껍데기 (spec 7.0).
 *
 * 한 번에 하나만 열린다는 규칙은 여는 쪽(TopBar)이 지킨다 — 여기서는 하나를 잘 그리는 것만 한다.
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
/** 닫는 중 — Esc 연타·덮개 더블클릭으로 close가 두 번 나가지 않게 막는다 */
let closing = false

function close() {
  if (closing) return
  closing = true
  emit('close')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

function detach() {
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
}

watch(
  () => props.open,
  async (on) => {
    closing = false
    if (!on) return detach()
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
