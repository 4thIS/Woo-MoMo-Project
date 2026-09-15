<script setup lang="ts">
withDefaults(defineProps<{ size?: number; color?: string }>(), { size: 16, color: 'currentColor' })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="none"
    :stroke="color"
    stroke-width="2"
    aria-hidden="true"
  >
    <path d="M2 5l6 6 6-6" />
  </svg>
</template>
