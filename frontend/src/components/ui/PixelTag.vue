<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'default' | 'ok' | 'danger' | 'muted' }>(), { tone: 'default' })
</script>

<template>
  <span class="tag mono" :class="tone"><slot /></span>
</template>

<style scoped>
.tag {
  font-size: var(--fs-meta);
  line-height: 1.5;
  padding: var(--sp-1) 10px;
  background: var(--line);
  color: var(--bg);
  white-space: nowrap;
}
.ok {
  background: var(--ok);
}
.danger {
  background: var(--danger);
}
.muted {
  background: var(--raise);
  color: var(--text-2);
}
</style>
