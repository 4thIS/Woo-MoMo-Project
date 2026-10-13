<script setup lang="ts">
/** 모달 공통 껍데기 (spec 7.0).
 *
 * 한 번에 하나만 열린다는 규칙은 여는 쪽(TopBar)이 지킨다 — 여기서는 하나를 잘 그리는 것만 한다.
 * 내용이 길면 모달이 아니라 **안쪽이** 스크롤한다.
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{ open: boolean; title?: string; width?: 'md' | 'wide' }>(),
  {
    title: undefined,
    width: 'md',
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
    <div v-if="open" class="veil" data-test="modal-veil" @click.self="close">
      <div
        ref="box"
        class="box"
        :class="width"
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
.box {
  background: var(--win);
  border: var(--win-border);
  box-shadow: var(--win-inner);
  width: 100%;
  max-width: 960px;
  max-height: calc(100vh - var(--sp-10));
  padding: 34px 40px;
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
}
.box.wide {
  max-width: 1160px;
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
@media (max-width: 720px) {
  .veil {
    padding: var(--sp-3);
  }
  .box {
    padding: var(--sp-6) var(--sp-5);
  }
}
</style>
