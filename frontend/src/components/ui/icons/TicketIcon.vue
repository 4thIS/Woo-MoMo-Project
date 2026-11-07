<script setup lang="ts">
/** 티켓 한 장. 가장자리가 안으로 물린 모양을 각진 선으로만 그린다 —
 *  🎟 이모지는 기종마다 모양이 달라 픽셀 UI에서 혼자 튄다 (2026-11-07) */
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
    <path
      d="M1 4h14v2h-2v1h2v2h-2v1h2v2H1v-2h2v-1H1V7h2V6H1V4z"
      :stroke="color"
      stroke-width="1.5"
    />
    <path d="M8 5v1M8 8v1M8 11v1" :stroke="color" stroke-width="1.5" />
  </svg>
</template>
