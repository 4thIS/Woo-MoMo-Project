<script setup lang="ts">
/** 이력서·자기소개서 한 칸 편집기 (spec 7.3).
 *
 * 준비 화면의 `ResumeForm`은 단계형 마법사라 **기존 글을 불러와 고치는** 일에 맞지 않는다.
 * 여기는 제목과 본문 두 칸이면 끝이라 따로 둔다.
 */
import { ref } from 'vue'
import type { ResumeSlot } from '@/services/account'
import PixelButton from '@/components/ui/PixelButton.vue'

// `slot`은 Vue 예약 속성이라 쓸 수 없다
const props = defineProps<{ current: ResumeSlot | null; label: string }>()
const emit = defineEmits<{
  save: [{ title: string; text: string }]
  cancel: []
}>()

const title = ref(props.current?.title ?? '')
const body = ref(props.current?.text ?? '')
const error = ref('')

function save() {
  if (!title.value.trim()) {
    error.value = '제목을 적어 주세요'
    return
  }
  error.value = ''
  emit('save', { title: title.value.trim(), text: body.value })
}
</script>

<template>
  <div class="editor">
    <label class="field">
      <span class="mono lab">제목</span>
      <input
        v-model="title"
        type="text"
        class="input mono"
        :placeholder="`예: 한국대 컴퓨터공학과 지원`"
        data-test="slot-title"
      />
    </label>
    <label class="field">
      <span class="mono lab">{{ label }}</span>
      <textarea
        v-model="body"
        class="input area"
        rows="8"
        :placeholder="`${label} 내용을 붙여넣거나 직접 쓰세요`"
        data-test="slot-text"
      />
    </label>
    <p v-if="error" class="mono err" data-test="slot-error">{{ error }}</p>
    <div class="acts">
      <PixelButton variant="secondary" data-test="slot-cancel" @click="emit('cancel')">
        취소
      </PixelButton>
      <PixelButton data-test="slot-save" @click="save">저장</PixelButton>
    </div>
  </div>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  border: 2px solid var(--line);
  padding: var(--sp-5);
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.lab {
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.area {
  resize: vertical;
  font-family: var(--font-body);
}
.err {
  margin: 0;
  font-size: var(--fs-meta);
  color: var(--danger);
}
.acts {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-3);
}
</style>
