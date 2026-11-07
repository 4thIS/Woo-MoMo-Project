<script setup lang="ts">
/** 보관함 — 뚜껑 있는 상자. 좁은 화면에서 글자를 뗄 때 이 그림만 남는다 */
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
    <rect x="2" y="3" width="12" height="10" :stroke="color" stroke-width="1.5" />
    <path d="M2 7h12" :stroke="color" stroke-width="1.5" />
    <path d="M6.5 10h3" :stroke="color" stroke-width="1.5" />
  </svg>
</template>
