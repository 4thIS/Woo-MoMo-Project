<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useModelStore } from '@/stores/model'
import { FIELD_LABELS, RESUME_MIN, useInterviewStore, type Field } from '@/stores/interview'
import { extractPdfText } from '@/services/pdf'
import { warmUpAudio } from '@/services/audio'
import { useSectionWheel } from '@/composables/useSectionWheel'
import PixelWindow from '@/components/ui/PixelWindow.vue'
import PixelTag from '@/components/ui/PixelTag.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import ChoiceMenu from '@/components/ui/ChoiceMenu.vue'
import PixelProgress from '@/components/ui/PixelProgress.vue'
import ResumeForm from '@/components/ResumeForm.vue'
import DocIcon from '@/components/ui/icons/DocIcon.vue'
import CursorIcon from '@/components/ui/icons/CursorIcon.vue'

const model = useModelStore()
const interview = useInterviewStore()
const root = ref<HTMLElement | null>(null)
useSectionWheel(root)

const fieldItems = (Object.keys(FIELD_LABELS) as Field[]).map((value) => ({
  value,
  label: FIELD_LABELS[value],
}))

/* 진행 창: Gemma(다운로드→초기화) 다음에 목소리(voice). 둘 다 끝나야 ready */
const voice = computed(() => model.status === 'ready' && model.ttsEnabled)
const phase = computed(() => {
  if (model.status === 'error' || (voice.value && model.ttsStatus === 'error')) return 'error'
  if (model.status !== 'ready') return model.status === 'initializing' ? 'init' : 'download'
  return model.ready ? 'ready' : 'voice'
})
const fileName = computed(() =>
  voice.value ? (model.manifest?.tts?.id ?? '') : (model.active?.url.split('/').pop() ?? ''),
)
const ttsError = computed(() => voice.value && model.ttsStatus === 'error')
/* 남은 시간: 최근 표본 속도로 추정 */
const eta = ref('')
const samples: { t: number; r: number }[] = []
watch(
  () => [model.received, model.status] as const,
  ([r, status]) => {
    if (status !== 'downloading') {
      eta.value = ''
      samples.length = 0
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

/* 입력 2단계: ① 지원 정보 → ② 이력서. 처음 완료 때만 자동 전환, 그 뒤엔 화살표로만 이동 */
const step = ref<1 | 2>(1)
const navigatedBack = ref(false)
function tryAdvance() {
  if (step.value === 1 && interview.profileDone && !navigatedBack.value) step.value = 2
}
function goBack() {
  step.value = 1
  navigatedBack.value = true
}
function goNext() {
  if (interview.profileDone) step.value = 2
}
async function onField(field: Field) {
  await interview.setField(field)
  if (interview.profile.job.trim()) tryAdvance()
}

/* 이력서 */
const extracting = ref(false)
const tooShort = ref(false)
const pasted = ref('')
async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
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
    input.value = ''
  }
}
/* PDF 대신 항목별로 답하는 간단 이력서 */
const FORM_NAME = '직접 작성'
const formOpen = ref(false)
function onFormDone(text: string) {
  interview.setResume(FORM_NAME, text)
  tooShort.value = false
  formOpen.value = false
}
function usePasted() {
  interview.setResume(interview.resumeName ?? '직접 입력', pasted.value)
  tooShort.value = interview.resumeText.length < RESUME_MIN
}

const startLabel = computed(() =>
  interview.canStart ? '면접 시작' : `면접 시작 — ${interview.startBlockReason}`,
)
const busy = ref(false)
const startError = ref('')
function start() {
  if (interview.canStart && !busy.value) {
    warmUpAudio() // 사용자 제스처 안에서 AudioContext를 푼다
    busy.value = true
    startError.value = ''
    void interview
      .start()
      .catch((e: unknown) => {
        // 세션 생성 실패(GPU 메모리 등)를 조용히 삼키지 않고 버튼 옆에 보여준다
        startError.value = `면접관을 부르지 못했습니다: ${e instanceof Error ? e.message : String(e)}`
      })
      .finally(() => (busy.value = false))
  }
}
async function clearAndRetry() {
  await model.clearCache()
  await model.download()
}
</script>

<template>
  <div ref="root" class="prepare stars snap-root">
    <header class="mono topbar">
      <span>모두의 모의면접 · 준비</span>
      <span class="dim">이력서·입력 내용은 이 브라우저를 떠나지 않습니다</span>
    </header>

    <!-- 1. 다운로드 / 초기화 -->
    <section class="snap">
      <div class="content">
        <PixelWindow class="rise" title="면접관이 출근하는 중" padding="sm">
          <PixelProgress
            :progress="voice ? model.ttsProgress : model.progress"
            :phase="phase"
            :received="voice ? model.ttsReceived : model.received"
            :total="voice ? model.ttsTotal : model.total"
            :file-name="fileName"
            :eta="eta"
            :error-text="
              ttsError ? `목소리를 준비하지 못했습니다: ${model.ttsError}` : (model.error ?? '')
            "
          >
            <template #actions>
              <template v-if="ttsError">
                <PixelButton variant="secondary" data-test="retry-tts" @click="model.retryTts()">
                  다시 시도
                </PixelButton>
              </template>
              <template v-else>
                <PixelButton variant="secondary" data-test="retry-model" @click="model.retry()">
                  다시 시도
                </PixelButton>
                <PixelButton
                  v-if="model.manifest?.fallback && model.active?.id !== model.manifest.fallback.id"
                  variant="secondary"
                  @click="model.useFallback()"
                >
                  경량 모델로 시도
                </PixelButton>
                <PixelButton variant="secondary" @click="clearAndRetry">캐시 지우기</PixelButton>
              </template>
            </template>
          </PixelProgress>
        </PixelWindow>
      </div>
    </section>

    <!-- 2. 입력: ① 지원 정보 → ② 이력서 (같은 자리, 페이드 전환) + 시작 -->
    <section class="snap">
      <div class="content">
        <PixelWindow :title="step === 1 ? '어디에 지원하시나요?' : '이력서'">
          <template #tag>
            <div class="stepnav">
              <PixelTag v-if="step === 1 && interview.profileDone" tone="ok">입력 완료</PixelTag>
              <PixelTag v-if="step === 2 && interview.resumeDone" tone="ok">
                {{ interview.resumeText.length.toLocaleString() }}자 추출
              </PixelTag>
              <button
                type="button"
                class="arrow press"
                data-test="step-prev"
                aria-label="이전: 지원 정보"
                :disabled="step === 1"
                @click="goBack"
              >
                <CursorIcon class="flip" />
              </button>
              <span class="mono stepnum">{{ step }} / 2</span>
              <button
                type="button"
                class="arrow press"
                data-test="step-next"
                aria-label="다음: 이력서"
                :disabled="step === 2 || !interview.profileDone"
                @click="goNext"
              >
                <CursorIcon />
              </button>
            </div>
          </template>

          <Transition name="fade" mode="out-in">
            <div v-if="step === 1" key="profile" class="step" data-test="step-profile">
              <div class="field">
                <span class="mono label">기업 분야</span>
                <ChoiceMenu
                  :items="fieldItems"
                  :model-value="interview.profile.field"
                  direction="horizontal"
                  aria-label="기업 분야"
                  @update:model-value="onField"
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
                  @keydown.enter="tryAdvance"
                  @blur="tryAdvance"
                />
                <span class="mono hint"
                  >면접관이 질문의 방향을 잡는 데 씁니다. 예: 프론트엔드 개발, 재무 분석, 생산 관리
                  — 입력을 마치면 이력서 단계로 넘어갑니다</span
                >
              </div>
            </div>

            <div v-else key="resume" class="step" data-test="step-resume">
              <label class="file-row press">
                <DocIcon />
                <span class="mono name">{{
                  interview.resumeName ?? 'PDF 파일을 끌어다 놓거나 클릭해서 선택'
                }}</span>
                <span class="mono pick">{{
                  interview.resumeName && interview.resumeName !== FORM_NAME
                    ? '다른 파일'
                    : '파일 선택'
                }}</span>
                <input
                  data-test="file"
                  type="file"
                  accept="application/pdf"
                  class="sr"
                  @change="onFile"
                />
              </label>
              <PixelButton
                v-if="!formOpen"
                data-test="form-open"
                variant="secondary"
                @click="formOpen = true"
              >
                {{
                  interview.resumeName === FORM_NAME
                    ? '간단 이력서 수정'
                    : 'PDF가 없다면 간단 이력서 작성'
                }}
              </PixelButton>
              <ResumeForm v-show="formOpen" @done="onFormDone" />
              <p v-if="extracting" class="mono hint">읽는 중…</p>
              <div v-if="interview.resumeText && !tooShort && !formOpen" class="preview">
                {{ interview.resumeText }}
              </div>
              <template v-if="tooShort && !formOpen">
                <p class="mono warn">
                  글자를 거의 읽지 못했습니다(스캔본일 수 있어요). 아래에 이력서 내용을 직접
                  붙여넣어 주세요.
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
                앞 {{ (2000).toLocaleString() }}자만 면접관에게 전달됩니다. 이름·연락처 같은
                개인정보도 이 브라우저 안에서만 읽힙니다.
              </p>
            </div>
          </Transition>
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
                :class="{
                  ok: model.status === 'ready',
                  wait: model.status !== 'ready',
                  blink: model.status !== 'ready',
                }"
              />
              면접관 출근 ({{
                model.status === 'ready' ? '완료' : `다운로드 ${model.progress}% → 초기화`
              }})
            </li>
            <li v-if="model.ttsEnabled">
              <i
                :class="{
                  ok: model.ttsStatus === 'ready',
                  wait: model.ttsStatus !== 'ready',
                  blink: model.ttsStatus !== 'ready' && model.ttsStatus !== 'error',
                }"
              />
              목소리 준비 ({{
                model.ttsStatus === 'ready'
                  ? '완료'
                  : model.ttsStatus === 'error'
                    ? '실패'
                    : `${model.ttsProgress}%`
              }})
            </li>
          </ul>
          <PixelButton data-test="start" :disabled="!interview.canStart || busy" @click="start">{{
            startLabel
          }}</PixelButton>
          <p v-if="startError" class="mono start-error" data-test="start-error">{{ startError }}</p>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.prepare {
  scroll-padding-top: 72px; /* 고정 상단바 아래에 섹션이 맞춰진다 */
}
.prepare .snap {
  min-height: calc(100vh - 72px);
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg);
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
  display: flex;
  flex-direction: column;
  gap: var(--sp-10);
}
.step {
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
}
/* 단계 전환: 투명 → 불투명. 스크롤 페이드와 같은 선형 예외 */
.fade-enter-active {
  transition: opacity 0.25s linear;
}
.fade-leave-active {
  transition: none;
}
.fade-enter-from {
  opacity: 0;
}
.stepnav {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.stepnum {
  font-size: var(--fs-meta);
  color: var(--text-2);
}
.flip {
  transform: scaleX(-1);
}
@media (prefers-reduced-motion: reduce) {
  .fade-enter-active {
    transition: none;
  }
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
  --press-shadow: var(--raise);
  padding: 14px var(--sp-4);
  cursor: pointer;
  color: var(--text-2);
}
.file-row:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
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
  white-space: pre-line; /* 간단 이력서의 항목 줄바꿈 유지 */
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
.checklist i.wait {
  background: var(--accent);
}
.start-error {
  color: var(--danger);
  font-size: var(--fs-meta);
  margin: var(--sp-2) 0 0;
}
</style>
