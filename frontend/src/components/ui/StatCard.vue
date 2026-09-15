<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{
  label: string
  value: string
  state: 'ok' | 'partial' | 'fail' | 'pending'
}>()
const filled = computed(() => ({ ok: 3, partial: 2, fail: 1, pending: 0 })[props.state])
</script>

<template>
  <div class="card">
    <span class="mono label">{{ label }}</span>
    <span class="value" :class="{ pending: state === 'pending' }">{{ value }}</span>
    <span class="gauge" :class="state">
      <i v-for="n in 3" :key="n" :class="{ on: n <= filled }" />
    </span>
  </div>
</template>

<style scoped>
.card {
  background: var(--bg);
  padding: 18px var(--sp-5);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.label {
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.value {
  font-size: 18px;
}
.pending {
  color: var(--text-3);
}
.gauge {
  display: flex;
  gap: var(--sp-1);
}
.gauge i {
  width: 14px;
  height: 14px;
  background: var(--raise);
}
.gauge i.on {
  background: var(--ok);
}
.gauge.fail i.on {
  background: var(--danger);
}
</style>
