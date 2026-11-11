<script setup lang="ts">
/** 이력서·자기소개서 한 칸 편집기 (spec 7.3).
 *
 * 준비 화면의 `ResumeForm`은 단계형 마법사라 **기존 글을 불러와 고치는** 일에 맞지 않는다.
 * 여기는 제목과 본문 두 칸이면 끝이라 따로 둔다.
 */
import { ref } from 'vue'
import type { ResumeSlot } from '@/services/account'
import PixelButton from '@/components/ui/PixelButton.vue'
import ResumeFileDrop from './ResumeFileDrop.vue'

// `slot`은 Vue 예약 속성이라 쓸 수 없다
const props = defineProps<{ current: ResumeSlot | null; label: string }>()
const emit = defineEmits<{
  save: [{ title: string; text: string }]
  cancel: []
}>()

const title = ref(props.current?.title ?? '')
const body = ref(props.current?.text ?? '')
const error = ref('')

/** 읽어 온 PDF로 칸을 채운다 (2026-11-08) */
function onRead({ name, text }: { name: string; text: string }) {
  body.value = text
  // 제목이 비었을 때만 파일명으로 채운다 — 써 둔 제목을 덮으면 안 된다
  if (!title.value.trim()) title.value = name.replace(/\.pdf$/i, '')
  error.value = ''
}

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
    <!-- 파일로 채우는 길. 제목 아래·본문 위가 제 자리다 — 넣으면 둘이 함께 찬다 -->
    <div class="field">
      <span class="mono lab">{{ label }} 파일</span>
      <ResumeFileDrop @read="onRead" />
    </div>
    <label class="field">
      <span class="mono lab">{{ label }} 내용</span>
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
