<script setup lang="ts">
withDefaults(defineProps<{ items: { key: string; value: string }[]; columns?: number }>(), {
  columns: 4,
})
</script>

<template>
  <dl class="grid mono" :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }">
    <div v-for="it in items" :key="it.key" class="cell">
      <dt>{{ it.key }}</dt>
      <dd>{{ it.value }}</dd>
    </div>
  </dl>
</template>

<style scoped>
.grid {
  display: grid;
  gap: var(--sp-4);
  margin: 0;
  padding: var(--sp-4) var(--sp-5);
  background: var(--bg);
  font-size: var(--fs-label);
  line-height: 1.6;
}
.cell {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
dt {
  color: var(--text-3);
  font-size: var(--fs-meta);
}
dd {
  margin: 0;
  color: var(--text);
}
</style>
