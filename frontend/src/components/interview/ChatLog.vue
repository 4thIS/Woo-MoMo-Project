<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { ChatMessage } from '@/stores/interview'

const props = defineProps<{ messages: ChatMessage[] }>()
const box = ref<HTMLElement | null>(null)
watch(
  () => props.messages.length,
  async () => {
    await nextTick()
    box.value?.scrollTo({ top: box.value.scrollHeight })
  },
)
</script>

<template>
  <div ref="box" class="log" aria-label="대화 기록">
    <div v-for="(m, i) in messages" :key="i" class="line" :class="m.role">
      <span class="mono role">{{ m.role === 'model' ? '면접관' : '지원자' }}</span>
      <p class="text">{{ m.text }}</p>
    </div>
  </div>
</template>

<style scoped>
.log {
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding-right: var(--sp-2);
}
.line {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: var(--sp-3);
}
.role {
  color: var(--text-3);
  font-size: var(--fs-meta);
  padding-top: 2px;
}
.user .role {
  color: var(--accent);
}
.text {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.6;
  font-size: var(--fs-body-sm);
}
</style>
