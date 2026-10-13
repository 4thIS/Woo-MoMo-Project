<script setup lang="ts">
import CursorIcon from './icons/CursorIcon.vue'

const props = withDefaults(
  defineProps<{ variant?: 'primary' | 'secondary'; disabled?: boolean; cursor?: boolean }>(),
  {
    variant: 'primary',
    disabled: false,
    cursor: true,
  },
)
const emit = defineEmits<{ click: [MouseEvent] }>()
const onClick = (e: MouseEvent) => {
  if (!props.disabled) emit('click', e)
}
</script>

<template>
  <button
    type="button"
    class="btn display press"
    :class="[variant, { disabled }]"
    :disabled="disabled"
    @click="onClick"
  >
    <CursorIcon v-if="variant === 'primary' && cursor && !disabled" />
    <slot />
  </button>
</template>

<style scoped>
/* 주 버튼은 노랑으로 **채운다**. 예전에는 테두리만 흰색이라 옆의 창들과 구별되지 않았다.
   깊이는 검은 하드 그림자가 내고, 호버하면 살짝 떠오르고 누르면 그림자만큼 내려앉는다.
   실제 모션은 base.css의 .press가 맡는다 — 여기서는 색과 그림자 색만 정한다 */
.btn {
  height: 52px;
  padding: 0 28px;
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: var(--sp-3);
  font-size: var(--fs-button);
  line-height: 1;
  cursor: pointer;
  --press-shadow: var(--ink);
  box-shadow: 4px 4px 0 var(--ink);
  background: var(--accent);
  color: var(--bg);
  border: 2px solid var(--accent);
}
.btn:hover:not(.disabled),
.btn:focus-visible:not(.disabled) {
  /* 색을 뒤집지 않는다. 떠오르는 것만으로 충분하고, 뒤집으면 노랑이 사라져 어디였는지 놓친다 */
  background: var(--accent-2);
  border-color: var(--accent-2);
}
/* 보조는 테두리만. 주 버튼 옆에서 조용해야 둘의 무게가 갈린다 */
.secondary {
  background: transparent;
  color: var(--text-2);
  border: 2px solid var(--line);
  font-size: var(--fs-body);
  padding: 0 20px;
  height: 46px;
}
.secondary:hover:not(.disabled),
.secondary:focus-visible:not(.disabled) {
  background: transparent;
  color: var(--text);
  border-color: var(--text-2);
}
.disabled {
  color: var(--text-3);
  cursor: not-allowed;
  background: transparent;
  border: 2px dashed var(--raise);
  box-shadow: none;
}
</style>
