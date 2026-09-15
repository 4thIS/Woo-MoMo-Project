<script setup lang="ts" generic="T extends string">
import CursorIcon from './icons/CursorIcon.vue'

const props = withDefaults(
  defineProps<{
    items: { value: T; label: string }[]
    modelValue: T | null
    direction?: 'vertical' | 'horizontal'
    disabled?: boolean
  }>(),
  { direction: 'vertical', disabled: false },
)
const emit = defineEmits<{ 'update:modelValue': [T] }>()

const pick = (v: T) => {
  if (!props.disabled) emit('update:modelValue', v)
}
const onKey = (e: KeyboardEvent) => {
  const next = props.direction === 'vertical' ? 'ArrowDown' : 'ArrowRight'
  const prev = props.direction === 'vertical' ? 'ArrowUp' : 'ArrowLeft'
  if (e.key !== next && e.key !== prev) return
  e.preventDefault()
  const i = props.items.findIndex((it) => it.value === props.modelValue)
  const n = props.items.length
  const j = e.key === next ? (i + 1) % n : (i - 1 + n) % n
  pick(props.items[j].value)
}
</script>

<template>
  <div class="menu" :class="direction" role="radiogroup" tabindex="0" @keydown="onKey">
    <button
      v-for="it in items"
      :key="it.value"
      type="button"
      role="radio"
      class="item"
      :class="{ on: it.value === modelValue }"
      :aria-checked="it.value === modelValue"
      :disabled="disabled"
      @click="pick(it.value)"
    >
      <span class="slot"><CursorIcon v-if="it.value === modelValue" /></span>
      {{ it.label }}
    </button>
  </div>
</template>

<style scoped>
.menu {
  display: flex;
  gap: var(--sp-2);
}
.vertical {
  flex-direction: column;
}
.horizontal {
  flex-direction: row;
  flex-wrap: wrap;
}
.item {
  min-height: 48px;
  padding: 0 var(--sp-5);
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  border: 0;
  background: transparent;
  color: var(--text-3);
  font-size: var(--fs-button);
  cursor: pointer;
}
.vertical .item {
  padding: 14px var(--sp-5);
}
.item.on {
  background: var(--raise);
  color: var(--accent);
}
.slot {
  width: 14px;
  display: inline-flex;
}
.item:disabled {
  cursor: default;
}
</style>
