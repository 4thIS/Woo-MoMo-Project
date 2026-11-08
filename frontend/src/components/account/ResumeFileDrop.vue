<script setup lang="ts">
/** PDF 하나를 받아 글을 뽑아 올린다 (2026-11-08).
 *
 * 준비 화면에도 같은 길이 있지만 그쪽은 면접 스토어에 바로 넣고 탭까지 옮긴다.
 * 여기는 **읽어서 올리기만** 한다 — 어디에 쓸지는 받는 쪽이 정한다.
 *
 * 파일은 브라우저를 떠나지 않는다(`extractPdfText`는 pdf.js로 로컬에서 읽는다).
 * 서버로 가는 것은 사용자가 저장을 누른 이력서 슬롯의 **글**뿐이다
 * (루트 `CLAUDE.md` "절대 하지 말 것" 8번).
 */
import { ref } from 'vue'
import { extractPdfText } from '@/services/pdf'
import DocIcon from '@/components/ui/icons/DocIcon.vue'

const emit = defineEmits<{ read: [{ name: string; text: string }] }>()
const busy = ref(false)
const error = ref('')
const dragging = ref(false)

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

async function readFile(file: File) {
  error.value = '' // 고쳐서 다시 넣었는데 빨간 줄이 남아 있으면 안 된다
  if (!isPdf(file)) {
    error.value = 'PDF만 읽을 수 있습니다'
    return
  }
  busy.value = true
  try {
    const text = await extractPdfText(file)
    // 스캔한 이미지 PDF에는 글자가 없다 — 빈 이력서가 조용히 저장되면 안 된다
    if (!text.trim()) {
      error.value = '글자를 찾지 못했습니다 — 아래에 직접 붙여넣어 주세요'
      return
    }
    emit('read', { name: file.name, text })
  } catch {
    error.value = '읽지 못했습니다 — 아래에 직접 붙여넣어 주세요'
  } finally {
    busy.value = false
  }
}
defineExpose({ readFile })

async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (f) await readFile(f)
  input.value = '' // 같은 파일을 다시 골라도 change가 나게
}
/* 끌어다 놓기: 숨긴 input에는 드롭이 닿지 않으므로 라벨이 받는다.
   accept는 드롭에 안 걸리니 isPdf로 직접 거른다 */
async function onDrop(e: DragEvent) {
  dragging.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) await readFile(f)
}
</script>

<template>
  <div class="wrap">
    <label
      class="file-row"
      :class="{ dragging }"
      data-test="slot-drop"
      @dragover.prevent="dragging = true"
      @dragleave="dragging = false"
      @drop.prevent="onDrop"
    >
      <DocIcon />
      <span class="mono name">PDF를 끌어다 놓거나 클릭해서 선택</span>
      <span class="mono pick">파일 선택</span>
      <input
        data-test="slot-file"
        type="file"
        accept="application/pdf"
        class="sr"
        @change="onPick"
      />
    </label>
    <p v-if="busy" class="mono hint">읽는 중…</p>
    <p v-if="error" class="mono err" data-test="drop-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
/* 준비 화면의 드롭존과 같은 어법 */
.file-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  background: var(--bg);
  border: 2px solid var(--raise);
  padding: 14px var(--sp-4);
  cursor: pointer;
  color: var(--text-2);
}
.file-row.dragging {
  border-color: var(--accent);
  color: var(--text);
}
.file-row:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--fs-label);
}
.pick {
  flex: none;
  font-size: var(--fs-meta);
  color: var(--accent);
}
/* 파일 input을 화면에서만 치운다 — display: none이면 키보드로 못 연다.
   이 클래스는 PrepareView의 scoped 안에만 있어 여기서는 상속되지 않는다 */
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}
.hint {
  margin: 0;
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.err {
  margin: 0;
  font-size: var(--fs-meta);
  color: var(--danger);
}
</style>
