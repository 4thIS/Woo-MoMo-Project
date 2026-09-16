<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import CursorIcon from '@/components/ui/icons/CursorIcon.vue'

import { RESUME_FIELDS as FIELDS, composeResume } from '@/utils/resumeForm'

/** PDF 없이 한 항목씩 답해 나가는 간단 이력서. 마지막 항목을 넘기면 한 덩어리 텍스트로 emit */
const emit = defineEmits<{ done: [text: string] }>()

const idx = ref(0)
const values = ref<Record<string, string>>(Object.fromEntries(FIELDS.map((f) => [f.key, ''])))
const attempted = ref(false)
const el = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)

const field = computed(() => FIELDS[idx.value])
const value = computed({
  get: () => values.value[field.value.key],
  set: (v: string) => (values.value[field.value.key] = v),
})
const filled = computed(() => field.value.optional || value.value.trim().length > 0)
const last = computed(() => idx.value === FIELDS.length - 1)

watch(idx, () => {
  attempted.value = false
  nextTick(() => el.value?.focus())
})

function next() {
  if (!filled.value) {
    attempted.value = true
    return
  }
  if (last.value) emit('done', composeResume(values.value))
  else idx.value++
}
function prev() {
  if (idx.value > 0) idx.value--
}
</script>

<template>
  <div class="form" data-test="resume-form">
    <div class="nav">
      <button
        type="button"
        class="arrow press"
        data-test="form-prev"
        aria-label="이전 항목"
        :disabled="idx === 0"
        @click="prev"
      >
        <CursorIcon class="flip" />
      </button>
      <span class="mono num">{{ idx + 1 }} / {{ FIELDS.length }}</span>
      <span class="mono label" :class="{ optional: field.optional }">{{ field.label }}</span>
    </div>

    <textarea
      v-if="field.long"
      ref="el"
      v-model="value"
      data-test="form-input"
      class="input long"
      rows="5"
      :maxlength="field.max"
      :placeholder="field.hint"
      :aria-label="field.label"
      @keydown.ctrl.enter.prevent="next"
      @keydown.meta.enter.prevent="next"
    />
    <input
      v-else
      ref="el"
      v-model="value"
      data-test="form-input"
      class="input"
      :maxlength="field.max"
      :inputmode="field.key === 'age' ? 'numeric' : 'text'"
      :placeholder="field.hint"
      :aria-label="field.label"
      @keydown.enter.prevent="next"
    />

    <div class="foot">
      <span class="mono hint" :class="{ warn: attempted && !filled }">
        <template v-if="attempted && !filled">{{ field.label }}은(는) 꼭 적어 주세요</template>
        <template v-else-if="field.long"
          >{{ value.length }} / {{ field.max }}자 · Ctrl+Enter로 다음</template
        >
        <template v-else>Enter로 다음{{ field.optional ? ' · 건너뛰어도 됩니다' : '' }}</template>
      </span>
      <PixelButton data-test="form-next" variant="secondary" @click="next">
        {{ last ? '이력서 완성' : '다음' }}
      </PixelButton>
    </div>
  </div>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.nav {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.num {
  font-size: var(--fs-meta);
  color: var(--text-2);
}
.label {
  font-size: var(--fs-body-md);
  color: var(--accent);
}
.label.optional::after {
  content: ' (선택)';
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.long {
  height: auto;
  padding: var(--sp-3) var(--sp-4);
  resize: vertical;
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
}
.hint {
  font-size: var(--fs-meta);
  color: var(--text-2);
}
.hint.warn {
  color: var(--danger);
}
.flip {
  transform: scaleX(-1);
}
</style>
