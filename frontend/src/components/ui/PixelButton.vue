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
    class="btn display"
    :class="[variant, { disabled }]"
    :disabled="disabled"
    @click="onClick"
  >
    <CursorIcon v-if="variant === 'primary' && cursor && !disabled" />
    <slot />
  </button>
</template>

<style scoped>
.btn {
  height: 52px;
  padding: 0 28px;
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: var(--sp-3);
  font-size: var(--fs-button);
  line-height: 1;
  border: 0;
  cursor: pointer;
  background: var(--raise);
  color: var(--accent);
}
.secondary {
  background: transparent;
  color: var(--text);
  border: 2px solid var(--line);
  font-size: var(--fs-body);
  padding: 0 18px;
}
.disabled {
  color: var(--text-3);
  cursor: default;
  background: var(--win);
  border: 2px solid var(--raise);
}
</style>
