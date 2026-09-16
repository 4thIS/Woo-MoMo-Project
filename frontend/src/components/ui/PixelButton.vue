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
/* 누를 수 있는 것은 "떠 있게": 테두리 + 오른쪽 아래 픽셀 그림자. hover면 반전, 누르면 그림자만큼 내려앉는다 */
.btn {
  height: 52px;
  padding: 0 28px;
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: var(--sp-3);
  font-size: var(--fs-button);
  line-height: 1;
  border: 2px solid var(--line);
  --press-shadow: var(--line);
  box-shadow: 4px 4px 0 var(--press-shadow);
  cursor: pointer;
  background: var(--raise);
  color: var(--accent);
}
.btn:hover:not(.disabled) {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
}
.secondary {
  background: transparent;
  color: var(--text);
  --press-shadow: var(--raise);
  font-size: var(--fs-body);
  padding: 0 18px;
}
.secondary:hover:not(.disabled) {
  background: var(--raise);
  color: var(--accent);
  border-color: var(--line);
}
.disabled {
  color: var(--text-3);
  cursor: not-allowed;
  background: transparent;
  border: 2px dashed var(--raise);
  box-shadow: none;
}
</style>
