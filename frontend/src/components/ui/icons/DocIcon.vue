<script setup lang="ts">
withDefaults(defineProps<{ size?: number; color?: string }>(), { size: 20, color: 'currentColor' })
</script>

<template>
  <svg :width="size" :height="(size / 20) * 24" viewBox="0 0 20 24" fill="none" aria-hidden="true">
    <rect x="1" y="1" width="18" height="22" :stroke="color" stroke-width="2" />
    <rect x="5" y="7" width="10" height="2" :fill="color" />
    <rect x="5" y="11" width="10" height="2" :fill="color" />
    <rect x="5" y="15" width="6" height="2" :fill="color" />
  </svg>
</template>
