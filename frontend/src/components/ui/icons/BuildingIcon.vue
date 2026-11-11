<script setup lang="ts">
/** 기업 — 창이 난 건물. 좁은 화면에서 글자를 뗄 때 이 그림만 남는다 */
withDefaults(defineProps<{ size?: number; color?: string }>(), { size: 16, color: 'currentColor' })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="none"
    shape-rendering="crispEdges"
    aria-hidden="true"
  >
    <rect x="2.5" y="2.5" width="11" height="11" :stroke="color" stroke-width="1.5" />
    <rect x="5" y="5" width="2" height="2" :fill="color" />
    <rect x="9" y="5" width="2" height="2" :fill="color" />
    <rect x="5" y="8.5" width="2" height="2" :fill="color" />
    <rect x="9" y="8.5" width="2" height="5" :fill="color" />
  </svg>
</template>
