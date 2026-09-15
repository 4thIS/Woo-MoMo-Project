<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useModelStore } from '@/stores/model'
import { FIELD_LABELS, RESUME_MIN, useInterviewStore, type Field } from '@/stores/interview'
import { extractPdfText } from '@/services/pdf'
import PixelWindow from '@/components/ui/PixelWindow.vue'
import PixelTag from '@/components/ui/PixelTag.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import ChoiceMenu from '@/components/ui/ChoiceMenu.vue'
import PixelProgress from '@/components/ui/PixelProgress.vue'
import DocIcon from '@/components/ui/icons/DocIcon.vue'

const model = useModelStore()
const interview = useInterviewStore()

const fieldItems = (Object.keys(FIELD_LABELS) as Field[]).map((value) => ({
  value,
  label: FIELD_LABELS[value],
}))

/* 진행 창 */
const phase = computed(() =>
  model.status === 'error'
    ? 'error'
    : model.status === 'ready'
      ? 'ready'
      : model.status === 'initializing'
        ? 'init'
        : 'download',
)
const fileName = computed(() => model.active?.url.split('/').pop() ?? '')
/* 남은 시간: 최근 표본 속도로 추정 */
const eta = ref('')
const samples: { t: number; r: number }[] = []
watch(
  () => [model.received, model.status] as const,
  ([r, status]) => {
    if (status !== 'downloading') {
      eta.value = ''
      return
    }
    const now = Date.now()
    samples.push({ t: now, r })
    while (samples.length > 2 && now - samples[0].t > 5000) samples.shift()
    const a = samples[0]
    const rate = (r - a.r) / Math.max(1, (now - a.t) / 1000)
    if (rate <= 0) {
      eta.value = ''
      return
    }
    const s = Math.round((model.total - r) / rate)
    eta.value = s >= 60 ? `약 ${Math.floor(s / 60)}분 ${s % 60}초 남음` : `약 ${s}초 남음`
  },
  { immediate: true },
)

/* 이력서 */
const extracting = ref(false)
const tooShort = ref(false)
const pasted = ref('')
async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  extracting.value = true
  try {
    const text = await extractPdfText(file)
    interview.setResume(file.name, text)
    tooShort.value = interview.resumeText.length < RESUME_MIN
  } catch {
    interview.setResume(file.name, '')
    tooShort.value = true
  } finally {
    extracting.value = false
  }
}
function usePasted() {
  interview.setResume(interview.resumeName ?? '직접 입력', pasted.value)
  tooShort.value = interview.resumeText.length < RESUME_MIN
}

const startLabel = computed(() =>
  interview.canStart ? '면접 시작' : `면접 시작 — ${interview.startBlockReason}`,
)
function start() {
  if (interview.canStart) interview.goto('interview')
}
</script>

<template>
  <div class="prepare stars">
    <header class="mono topbar">
      <span>모두의 모의면접 · 준비</span>
      <span class="dim">이력서·입력 내용은 이 브라우저를 떠나지 않습니다</span>
    </header>

    <div class="content">
      <!-- 1. 다운로드 / 초기화 -->
      <PixelWindow title="면접관이 출근하는 중">
        <PixelProgress
          :progress="model.progress"
          :phase="phase"
          :received="model.received"
          :total="model.total"
          :file-name="fileName"
          :eta="eta"
          :error-text="model.error ?? ''"
        >
          <template #actions>
            <PixelButton variant="secondary" @click="model.retry()">다시 시도</PixelButton>
            <PixelButton
              v-if="model.manifest?.fallback && model.active?.id !== model.manifest.fallback.id"
              variant="secondary"
              @click="model.useFallback()"
            >
              경량 모델로 시도
            </PixelButton>
            <PixelButton variant="secondary" @click="model.clearCache()">캐시 지우기</PixelButton>
          </template>
        </PixelProgress>
      </PixelWindow>

      <!-- 2. 지원 정보 -->
      <PixelWindow title="어디에 지원하시나요?">
        <template #tag
          ><PixelTag v-if="interview.profileDone" tone="ok">입력 완료</PixelTag></template
        >
        <div class="field">
          <span class="mono label">기업 분야</span>
          <ChoiceMenu
            :items="fieldItems"
            :model-value="interview.profile.field"
            direction="horizontal"
            @update:model-value="interview.setField"
          />
        </div>
        <div class="field">
          <label class="mono label" for="job">지원 직무</label>
          <input
            id="job"
            data-test="job"
            class="input"
            :value="interview.profile.job"
            maxlength="40"
            placeholder="예: 백엔드 개발자"
            @input="interview.setJob(($event.target as HTMLInputElement).value)"
          />
          <span class="mono hint"
            >면접관이 질문의 방향을 잡는 데 씁니다. 예: 프론트엔드 개발, 재무 분석, 생산 관리</span
          >
        </div>
      </PixelWindow>

      <!-- 3. 이력서 -->
      <PixelWindow title="이력서">
        <template #tag>
          <PixelTag v-if="interview.resumeDone" tone="ok">
            {{ interview.resumeText.length.toLocaleString() }}자 추출
          </PixelTag>
        </template>
        <label class="file-row">
          <DocIcon />
          <span class="mono name">{{
            interview.resumeName ?? 'PDF 파일을 끌어다 놓거나 클릭해서 선택'
          }}</span>
          <span class="mono pick">{{ interview.resumeName ? '다른 파일' : '파일 선택' }}</span>
          <input
            data-test="file"
            type="file"
            accept="application/pdf"
            class="sr"
            @change="onFile"
          />
        </label>
        <p v-if="extracting" class="mono hint">읽는 중…</p>
        <div v-if="interview.resumeText && !tooShort" class="preview">
          {{ interview.resumeText }}
        </div>
        <template v-if="tooShort">
          <p class="mono warn">
            글자를 거의 읽지 못했습니다(스캔본일 수 있어요). 아래에 이력서 내용을 직접 붙여넣어
            주세요.
          </p>
          <textarea
            v-model="pasted"
            data-test="paste"
            class="input paste"
            rows="6"
            placeholder="이력서 내용을 붙여넣기"
            @input="usePasted"
            @blur="usePasted"
          />
        </template>
        <p class="mono hint">
          앞 {{ (2000).toLocaleString() }}자만 면접관에게 전달됩니다. 이름·연락처 같은 개인정보도 이
          브라우저 안에서만 읽힙니다.
        </p>
      </PixelWindow>

      <!-- 시작 -->
      <div class="start-row">
        <ul class="mono checklist">
          <li>
            <i :class="{ ok: interview.profileDone, wait: !interview.profileDone }" /> 분야 · 직무
            입력
          </li>
          <li>
            <i :class="{ ok: interview.resumeDone, wait: !interview.resumeDone }" /> 이력서 읽기
          </li>
          <li>
            <i
              :class="{ ok: model.status === 'ready', wait: model.status !== 'ready' }"
              class="blink-when-wait"
            />
            면접관 출근 ({{
              model.status === 'ready' ? '완료' : `다운로드 ${model.progress}% → 초기화`
            }})
          </li>
        </ul>
        <PixelButton data-test="start" :disabled="!interview.canStart" @click="start">{{
          startLabel
        }}</PixelButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.prepare {
  min-height: 100vh;
  padding-bottom: 80px;
}
.topbar {
  height: 72px;
  max-width: var(--content-w);
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--fs-label);
  color: var(--text-2);
  padding: 0 var(--sp-4);
}
.dim {
  color: var(--text-3);
}
.content {
  max-width: var(--content-w);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--sp-10);
  padding: 0 var(--sp-4);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.label {
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.hint {
  font-size: var(--fs-meta);
  color: var(--text-2);
}
.warn {
  font-size: var(--fs-label);
  color: var(--accent);
}
.input {
  height: 52px;
  background: var(--bg);
  border: 2px solid var(--raise);
  padding: 0 var(--sp-4);
  color: var(--text);
}
.input:focus {
  border-color: var(--accent);
  outline: none;
}
.paste {
  height: auto;
  padding: var(--sp-3) var(--sp-4);
  resize: vertical;
}
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
.name {
  flex: 1;
  color: var(--text);
  font-size: var(--fs-label);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pick {
  color: var(--accent);
  font-size: var(--fs-meta);
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}
.preview {
  background: var(--bg);
  padding: 14px var(--sp-4);
  font-size: var(--fs-label);
  color: var(--text-2);
  max-height: 120px;
  overflow: hidden;
}
.start-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-8);
}
.checklist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  font-size: var(--fs-label);
  color: var(--text-2);
}
.checklist i {
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-right: 10px;
  background: var(--raise);
  vertical-align: -1px;
}
.checklist i.ok {
  background: var(--ok);
}
.checklist i.wait.blink-when-wait {
  background: var(--accent);
  animation: blink 0.9s steps(1) infinite;
}
</style>
