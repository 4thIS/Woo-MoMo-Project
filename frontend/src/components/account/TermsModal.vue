<script setup lang="ts">
/** 가입 화면의 [보기] — 약관 한 절을 그대로 보여 준다 (`src/content/terms.ts`). */
import PixelModal from '@/components/ui/PixelModal.vue'
import type { TermsSection } from '@/content/terms'

defineProps<{ open: boolean; section: TermsSection | null }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <PixelModal :open="open && !!section" :title="section?.title ?? ''" @close="emit('close')">
    <div class="body" data-test="terms-body">
      <p v-for="(line, i) in section?.lines ?? []" :key="i" class="line">{{ line }}</p>
    </div>
  </PixelModal>
</template>

<style scoped>
.body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  max-height: 60vh;
  overflow-y: auto;
  border: 2px solid var(--line);
  padding: var(--sp-6);
}
.line {
  margin: 0;
  font-size: var(--fs-meta);
  color: var(--text-2);
  line-height: 1.8;
  word-break: keep-all;
}
</style>
