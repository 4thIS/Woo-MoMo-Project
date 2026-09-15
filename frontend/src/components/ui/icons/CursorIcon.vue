<script setup lang="ts">
withDefaults(defineProps<{ size?: number; color?: string }>(), { size: 14, color: 'currentColor' })
</script>

<template>
  <svg
    :width="size"
    :height="(size / 14) * 16"
    viewBox="0 0 14 16"
    :fill="color"
    aria-hidden="true"
  >
    <path d="M0 0l14 8-14 8z" />
  </svg>
</template>
