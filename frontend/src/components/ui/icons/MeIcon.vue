<script setup lang="ts">
/** 내정보 — 머리와 어깨. 둥근 테두리를 쓰지 않고 각진 선으로만 그린다 */
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
    <rect x="5" y="2" width="6" height="5" :stroke="color" stroke-width="1.5" />
    <path d="M2.5 14v-2h2v-1h7v1h2v2" :stroke="color" stroke-width="1.5" />
  </svg>
</template>
