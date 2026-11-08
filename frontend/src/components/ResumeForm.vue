<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import CursorIcon from '@/components/ui/icons/CursorIcon.vue'

import { RESUME_FIELDS as FIELDS, composeResume } from '@/utils/resumeForm'
import { digitsOnly, plainName } from '@/utils/inputFilter'

/** 칸마다 받아 줄 글자. 없는 칸은 그대로 — 경력·지원동기에 특수문자를 막으면 글을 못 쓴다 */
const CLEAN: Record<string, (v: string) => string> = { name: plainName, age: digitsOnly }

/** PDF 없이 한 항목씩 답해 나가는 간단 이력서. 마지막 항목을 넘기면 한 덩어리 텍스트로 emit */
const emit = defineEmits<{ done: [text: string] }>()

const idx = ref(0)
const values = ref<Record<string, string>>(Object.fromEntries(FIELDS.map((f) => [f.key, ''])))
const attempted = ref(false)
const el = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)

const field = computed(() => FIELDS[idx.value])
const value = computed({
  get: () => values.value[field.value.key],
  // 붙여넣기·끌어다 놓기·자동 완성도 여기를 지나므로 받아 줄 글자만 남겨 넣는다
  set: (v: string) => (values.value[field.value.key] = (CLEAN[field.value.key] ?? ((s) => s))(v)),
})
const filled = computed(() => field.value.optional || value.value.trim().length > 0)
const last = computed(() => idx.value === FIELDS.length - 1)

watch(idx, () => {
  attempted.value = false
  nextTick(() => el.value?.focus())
})
onMounted(() => el.value?.focus()) // 열자마자 타이핑해도 첫 칸에 들어가게

/** 한글 IME 조합 중 Enter는 keydown이 두 번(조합 중·확정) 오므로 조합 중인 것은 무시한다 — AnswerInput과 같은 규칙 */
function onEnter(e: KeyboardEvent) {
  if (e.isComposing) return
  e.preventDefault()
  next()
}
function onCtrlEnter(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || e.isComposing) return
  e.preventDefault()
  next()
}

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
      <span class="mono num">{{ idx + 1 }} / {{ FIELDS.length }}</span>
      <span class="mono label" :class="{ optional: field.optional }">{{ field.label }}</span>
    </div>

    <textarea
      v-if="field.long"
      ref="el"
      :key="field.key"
      v-model="value"
      data-test="form-input"
      class="input long"
      rows="5"
      :maxlength="field.max"
      :placeholder="field.hint"
      :aria-label="field.label"
      @keydown.enter="onCtrlEnter"
    />
    <input
      v-else
      ref="el"
      :key="field.key"
      v-model="value"
      data-test="form-input"
      class="input"
      :maxlength="field.max"
      :inputmode="field.key === 'age' ? 'numeric' : 'text'"
      :placeholder="field.hint"
      :aria-label="field.label"
      @keydown.enter="onEnter"
    />

    <div class="foot">
      <span class="mono hint" :class="{ warn: attempted && !filled }">
        <template v-if="attempted && !filled">{{ field.label }}은(는) 꼭 적어 주세요</template>
        <template v-else-if="field.long"
          >{{ value.length }} / {{ field.max }}자 · Ctrl+Enter로 다음</template
        >
        <template v-else>Enter로 다음{{ field.optional ? ' · 건너뛰어도 됩니다' : '' }}</template>
      </span>
      <!-- 오가는 두 버튼은 **한 쌍으로 같은 줄**에 둔다 (2026-11-08) — 이전이 위 구석의
           아이콘 하나였을 때는 눈에 띄지 않아 쓸 수 있는 버튼이 '다음' 하나로 느껴졌다 -->
      <div class="go">
        <PixelButton data-test="form-prev" variant="secondary" :disabled="idx === 0" @click="prev">
          <CursorIcon class="flip" /> 이전
        </PixelButton>
        <!-- 노랑(primary)은 '면접 시작'의 것이다 — 한 화면에 노란 버튼이 둘이면
             어디를 눌러야 할지 흐려진다. 둘을 가르는 것은 색이 아니라 화살표 방향이다 -->
        <PixelButton data-test="form-next" variant="secondary" @click="next">
          {{ last ? '이력서 완성' : '다음' }} <CursorIcon />
        </PixelButton>
      </div>
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
/* 오가는 두 버튼은 오른쪽에 나란히 — 눈이 한 곳만 보면 된다 */
.go {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex: none;
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
