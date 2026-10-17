<script setup lang="ts">
/** SVG 막대 차트. 라이브러리 없이 — 값은 각 막대의 <title>로도 읽힌다. */
import { computed } from 'vue'

const props = defineProps<{
  items: { label: string; value: number }[]
  format?: (n: number) => string
  /** 스크린리더용 이름 */
  title?: string
}>()

const W = 600
const H = 140
const fmt = (n: number) => (props.format ? props.format(n) : String(n))
const max = computed(() => Math.max(0, ...props.items.map((i) => i.value)))
const empty = computed(() => props.items.length === 0 || max.value <= 0)
const slot = computed(() => W / Math.max(1, props.items.length))
const bars = computed(() =>
  props.items.map((it, i) => {
    const h = max.value > 0 ? Math.round((it.value / max.value) * (H - 4)) : 0
    return {
      key: `${i}-${it.label}`,
      x: i * slot.value + slot.value * 0.15,
      w: slot.value * 0.7,
      h,
      y: H - h,
      text: `${it.label}: ${fmt(it.value)}`,
    }
  }),
)
</script>

<template>
  <p v-if="empty" class="mono none" data-test="chart-empty">기록 없음</p>
  <figure v-else class="chart">
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="none"
      role="img"
      :aria-label="title ?? '막대 차트'"
    >
      <rect
        v-for="b in bars"
        :key="b.key"
        class="bar"
        data-test="chart-bar"
        :x="b.x"
        :y="b.y"
        :width="b.w"
        :height="b.h"
      >
        <title>{{ b.text }}</title>
      </rect>
    </svg>
    <figcaption class="mono axis">
      <span>{{ items[0]?.label }}</span>
      <span>최대 {{ fmt(max) }}</span>
      <span>{{ items[items.length - 1]?.label }}</span>
    </figcaption>
  </figure>
</template>

<style scoped>
.chart {
  margin: 0;
}
svg {
  width: 100%;
  height: 140px;
  display: block;
  background: var(--bg);
  border-bottom: var(--rule);
}
.bar {
  fill: var(--accent-2);
}
.bar:hover {
  fill: var(--accent);
}
.axis {
  display: flex;
  justify-content: space-between;
  font-size: var(--fs-meta);
  color: var(--text-3);
  margin-top: var(--sp-2);
}
.none {
  color: var(--text-3);
  font-size: var(--fs-label);
  margin: 0;
}
</style>
