<script setup lang="ts" generic="T extends string">
import { nextTick } from 'vue'
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
const isTabbable = (v: T) => {
  if (props.modelValue === null) return props.items[0]?.value === v
  return v === props.modelValue
}
const onKey = (e: KeyboardEvent) => {
  const next = props.direction === 'vertical' ? 'ArrowDown' : 'ArrowRight'
  const prev = props.direction === 'vertical' ? 'ArrowUp' : 'ArrowLeft'
  if (e.key !== next && e.key !== prev) return
  e.preventDefault()
  const i = props.items.findIndex((it) => it.value === props.modelValue)
  const n = props.items.length
  const j = i === -1 ? (e.key === next ? 0 : n - 1) : e.key === next ? (i + 1) % n : (i - 1 + n) % n
  pick(props.items[j].value)
  const group = e.currentTarget as HTMLElement
  void nextTick(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
}
</script>

<template>
  <div class="menu" :class="direction" role="radiogroup" @keydown="onKey">
    <button
      v-for="it in items"
      :key="it.value"
      type="button"
      role="radio"
      class="item"
      :class="{ on: it.value === modelValue }"
      :aria-checked="it.value === modelValue"
      :tabindex="isTabbable(it.value) ? 0 : -1"
      :disabled="disabled"
      @click="pick(it.value)"
    >
      <span class="slot"><CursorIcon /></span>
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
  align-self: flex-start;
}
/* 고를 수 있는 것임을 알리는 흐린 커서. 올리면 밝아지고, 고르면 노란 커서 + 올라온 배경 */
.item:hover:not(:disabled) {
  background: var(--win);
  color: var(--text);
}
.item.on,
.item.on:hover {
  background: var(--raise);
  color: var(--accent);
}
.slot {
  width: 14px;
  display: inline-flex;
  opacity: 0.3;
}
.item:hover .slot {
  opacity: 0.7;
}
.item.on .slot {
  opacity: 1;
}
.item:disabled {
  cursor: default;
}
</style>
