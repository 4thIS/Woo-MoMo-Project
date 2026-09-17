<script setup lang="ts">
withDefaults(defineProps<{ muted?: boolean; size?: number }>(), { muted: false, size: 16 })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="currentColor"
    shape-rendering="crispEdges"
    aria-hidden="true"
  >
    <path d="M2 6h3l4-4v12l-4-4H2z" />
    <template v-if="!muted">
      <rect x="11" y="6" width="2" height="4" />
      <rect x="14" y="4" width="2" height="8" />
    </template>
    <path v-else d="M10 5l1-1 5 5-1 1zM15 4l1 1-5 5-1-1z" />
  </svg>
</template>
