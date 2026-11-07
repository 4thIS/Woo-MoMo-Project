<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { TTS_STUCK_MS, useModelStore } from '@/stores/model'
import {
  FIELD_LABELS,
  RESUME_MIN,
  benSettingsPayload,
  useInterviewStore,
  type Field,
} from '@/stores/interview'
import { extractPdfText } from '@/services/pdf'
import { warmUpAudio } from '@/services/audio'
import { useInterviewerStore } from '@/stores/interviewer'
import { useModalStore } from '@/stores/modal'
import { useHintsStore } from '@/stores/hints'
import { useAccountStore } from '@/stores/account'
import { DEFAULT_INTERVIEWER, interviewerById } from '@/interviewers'
import InterviewerPicker from '@/components/InterviewerPicker.vue'
import PixelWindow from '@/components/ui/PixelWindow.vue'
import PixelTag from '@/components/ui/PixelTag.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import ChoiceMenu from '@/components/ui/ChoiceMenu.vue'
import PixelProgress from '@/components/ui/PixelProgress.vue'
import { formatEta } from '@/utils/progressStages'
import { normalizePostingUrl } from '@/utils/postingUrl'
import { formatBytes } from '@/utils/format'
import ResumeForm from '@/components/ResumeForm.vue'
import BenSettings from '@/components/BenSettings.vue'
import { DEFAULT_BEN } from '@/content/benAxes'
import DocIcon from '@/components/ui/icons/DocIcon.vue'

const model = useModelStore()
const interview = useInterviewStore()
const iv = useInterviewerStore()
const modal = useModalStore()

/** 대입 입력 — 트랙이 대입일 때만 쓴다 */
type AdField = 'name' | 'university' | 'department'
const setAd = (k: AdField, v: string) => interview.setAdmission({ [k]: v })
const setAge = (v: string) => {
  const n = Number(v)
  interview.setAdmission({ age: v.trim() && Number.isFinite(n) ? n : null })
}
/** 2단계에서 받는 긴 글의 이름 — 트랙에 따라 다르다 */
const longDocLabel = computed(() => (interview.track === 'admission' ? '자기소개서' : '이력서'))
/** 1단계(지원 정보)가 찼는가 — 트랙마다 보는 칸이 다르다 */
const infoDone = computed(() => {
  const p = interview.profile
  return interview.track === 'admission'
    ? Boolean(p.name.trim() && p.age !== null && p.university.trim() && p.department.trim())
    : interview.profileDone
})
const hints = useHintsStore()
const account = useAccountStore()
/* 내정보에 미리 써 둔 이력서·자기소개서. 이번 면접의 갈래에 맞는 것만 — 회사 면접에
   자기소개서를 내밀지 않는다. 비로그인은 애초에 슬롯이 없어 빈 목록이다.
   벤처럼 둘 다 보는 면접관에서 갈래를 아직 안 고르면(track null) 어느 쪽인지 알 수 없어 내밀지 않는다 */
const savedResumes = computed(() => (interview.track ? account.slotsOf(interview.track) : []))
/** 저장해 둔 것을 이번 면접의 이력서로 삼는다. 슬롯은 건드리지 않는다 —
 *  면접 중에 고친 내용이 저장본까지 바꾸면 놀란다 */
function useSaved(id: string) {
  const slot = savedResumes.value.find((s) => s.id === id)
  if (slot) interview.setResume(slot.title, slot.text)
}
/* 면접관 바꾸기(spec 3.4): 같은 고르기 패널을 연다. 바꾸면 목소리 파일(약 290KB)만 받아 교체한다 */
const pickerOpen = ref(false)
const pickerBox = ref<HTMLElement | null>(null)
/* 회사 브리핑은 벤(프리미엄)만 한다 — 무료 면접관은 서버를 거치지 않고, 대입은 쓰지 않는다 */
const benCompany = computed(() => Boolean(iv.current?.premium) && interview.track === 'company')
/* 벤 성향(2026-11-07). 기본은 접혀 있다 — 다섯 줄을 늘 펼쳐 두면 준비 화면이 설정 화면이 된다 */
const benOpen = ref(false)
/** 회사 이야기 줄을 그릴지. 서버가 무시하는 면접(입학 트랙·회사 이름 없음)에서는 빼 둔다 */
const benShowCompany = computed(
  () => benCompany.value && interview.profile.companyName.trim().length > 0,
)
const benTouched = computed(() => benSettingsPayload(interview.benSettings) !== undefined)
/** 공고 링크 안내 — 적는 동안은 형식 검사가, 보낸 뒤에는 서버가 짚어 준 것이 뜬다 */
const postingProblem = computed(() => {
  const r = normalizePostingUrl(interview.profile.postingUrl)
  return r.ok ? interview.postingError : r.reason
})
/* 패널은 버튼 아래에 생겨 화면 밖에서 열리기 쉽다 — 열 때만 다 보이는 자리까지 내린다.
   nearest라 이미 다 보이면 움직이지 않는다. 닫을 때는 보던 자리를 지킨다 */
watch(pickerOpen, async (open) => {
  if (!open) return
  await nextTick()
  // jsdom에는 scrollIntoView가 없다 — 없으면 그냥 넘어간다
  pickerBox.value?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
})
// 선택이 없으면 실제로 쓰일 기본 면접관(목소리 기본값과 같은 사람)의 이름
const interviewerName = computed(
  () => (iv.current ?? interviewerById(DEFAULT_INTERVIEWER)!).displayName,
)

const fieldItems = (Object.keys(FIELD_LABELS) as Field[]).map((value) => ({
  value,
  label: FIELD_LABELS[value],
}))

/* 진행 창: Gemma(다운로드→초기화) 다음에 목소리(voice). 둘 다 끝나야 ready */
const voice = computed(() => model.status === 'ready' && model.ttsEnabled)
const phase = computed(() => {
  if (model.status === 'error' || (voice.value && model.ttsStatus === 'error')) return 'error'
  if (model.status !== 'ready') return model.status === 'initializing' ? 'init' : 'download'
  // 목소리를 받는 동안에도 면접은 열려 있다(model.ready) — 진행 창은 그래도 목소리 단계를 보여 준다
  return model.voicePending ? 'voice' : 'ready'
})
/* 진행 창 제목도 단계를 따른다 — 아래 문구(PixelProgress caption)와 모순되지 않게 (#24) */
const TITLE: Record<'download' | 'init' | 'voice' | 'ready' | 'error', string> = {
  download: '면접관이 출근하는 중',
  init: '면접관이 잠깐 숨 고르는 중',
  voice: '면접관이 목소리를 가다듬는 중',
  ready: '면접관이 자리에 앉았습니다',
  error: '면접관이 오는 길에 문제가 생겼습니다',
}
const fileName = computed(() =>
  voice.value ? (model.manifest?.tts?.id ?? '') : (model.active?.url.split('/').pop() ?? ''),
)
const ttsError = computed(() => voice.value && model.ttsStatus === 'error')
/* 체크리스트 "목소리 준비" 완료 표시 — 교체 중이면 아직 아니다 */
const voiceReady = computed(() => model.ttsStatus === 'ready' && !model.voiceSwitching)
/* 남은 시간: 최근 표본 속도로 추정 */
const eta = ref('')
/** 지금 받는 속도 문구(예: 7.2MB/s). 비면 아무것도 안 보인다 */
const speed = ref('')
const samples: { t: number; r: number }[] = []
const downloading = computed(
  () => model.status === 'downloading' || (voice.value && model.ttsStatus === 'downloading'),
)
watch(
  () => [model.overallReceived, downloading.value] as const,
  ([r, on]) => {
    if (!on) {
      eta.value = ''
      speed.value = ''
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
      speed.value = ''
      return
    }
    speed.value = `${formatBytes(rate)}/s`
    const s = Math.round((model.overallTotal - r) / rate)
    if (s <= 0) {
      eta.value = '' // 다 받았는데 상태가 아직 downloading인 짧은 순간 — "약 0초 남음"을 내지 않는다
      return
    }
    // 초까지 보여 주면 회선이 흔들릴 때마다 숫자가 널뛴다 — 분으로 반올림한다
    eta.value = `${formatEta(s)} 남음`
  },
  { immediate: true },
)

/* 2단계 전환은 없앴다(2026-11-07) — 칸이 넷 이하라 나눌 이유가 없고,
   나누면 모델을 받는 4분 동안 한쪽밖에 못 채운다 */
async function onField(field: Field) {
  await interview.setField(field)
}

/* 이력서 */
const extracting = ref(false)
const tooShort = ref(false)
const pasted = ref('')
const dragging = ref(false)
const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
async function readResume(file: File) {
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
  /* 글자를 못 읽었으면 붙여넣기 탭으로 데려간다 — 경고만 띄우고 파일 탭에 두면
     다음에 뭘 해야 하는지 보이지 않는다 (2026-11-07) */
  if (tooShort.value) resumeTab.value = 'paste'
}
async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await readResume(file)
  input.value = '' // 같은 파일을 다시 골라도 change가 나게
}
/* 끌어다 놓기: 숨긴 input에는 드롭이 닿지 않으므로 라벨이 받는다. accept는 드롭에 안 걸리니 직접 거른다 */
async function onDrop(e: DragEvent) {
  dragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file && isPdf(file)) await readResume(file)
}
/* 이력서를 넣는 방법 넷. 한 번에 하나만 보인다 — 넷을 늘 펼쳐 두면 창이 두 배가 된다
   (2026-11-07). 저장본이 있으면 거기서 꺼내는 게 가장 빨라 그걸 기본 탭으로 */
type ResumeTab = 'saved' | 'file' | 'form' | 'paste'
const TAB_LABEL: Record<ResumeTab, string> = {
  saved: '저장본에서',
  file: '파일 올리기',
  form: '직접 쓰기',
  paste: '붙여넣기',
}
const resumeTab = ref<ResumeTab>('file')
const resumeTabs = computed<ResumeTab[]>(() =>
  savedResumes.value.length ? ['saved', 'file', 'form', 'paste'] : ['file', 'form', 'paste'],
)
watch(
  savedResumes,
  (list) => {
    if (list.length && resumeTab.value === 'file') resumeTab.value = 'saved'
  },
  { immediate: true },
)

/* PDF 대신 항목별로 답하는 간단 이력서 */
const FORM_NAME = '직접 작성'
function onFormDone(text: string) {
  interview.setResume(FORM_NAME, text)
  tooShort.value = false
}
function usePasted() {
  interview.setResume(interview.resumeName ?? '직접 입력', pasted.value)
  tooShort.value = interview.resumeText.length < RESUME_MIN
}

/* 막힌 이유(#41): 간단 이력서를 열어 두고 '이력서 완성'을 안 누른 상태가 가장 흔한 "다 채웠는데 안 열림" */
const startLabel = computed(() => {
  if (interview.canStart) return '면접 시작'
  if (resumeTab.value === 'form' && !interview.resumeDone && infoDone.value)
    return "면접 시작 — 간단 이력서의 '이력서 완성'을 눌러 주세요"
  return `면접 시작 — ${interview.startBlockReason}`
})
/** 모델·목소리 실패로 막혔으면 진행 창(1번 구역)이 위에 있어 안 보이므로 올라가는 링크를 단다 */
const blockedByError = computed(
  () => model.status === 'error' || (model.ttsEnabled && model.ttsStatus === 'error'),
)
/* 출근 장면은 320x64 픽셀 그림이라 **정수 배율로만** 줄일 수 있다(루트 CLAUDE.md).
   두 기둥일 때 상황판은 376px이라 1배(320px)만 들어간다. 위로 누우면 가로가 생겨 2배(640px)까지
   간다. 3배(960px)는 이 배치에서 어디에도 안 맞는다 — 소수 배율로 줄이느니 한 단계 내린다 */
const stacked = ref(false) // 상황판이 위로 누웠는가(두 기둥이 아닌가)
const roomForTwo = ref(false) // 2배(640px)를 놓을 가로가 되는가
const watchers: (() => void)[] = []
function follow(query: string, target: { value: boolean }) {
  if (typeof matchMedia !== 'function') return // jsdom에는 없다 — 두 기둥(1배)으로 둔다
  const m = matchMedia(query)
  const on = (e: MediaQueryListEvent | MediaQueryList) => (target.value = e.matches)
  on(m)
  m.addEventListener('change', on)
  watchers.push(() => m.removeEventListener('change', on))
}
onMounted(() => {
  follow('(max-width: 1024px)', stacked)
  follow('(min-width: 720px)', roomForTwo)
})
onBeforeUnmount(() => watchers.forEach((off) => off()))
/** 두 기둥에서는 상황판이 376px이라 1배만 들어간다. 누우면 가로가 생겨 2배까지 간다 */
const sceneScale = computed(() => (stacked.value && roomForTwo.value ? 2 : 1))

/* 스크롤러는 문서다(2026-11-07 철거). 요소가 아니라 창을 올린다 */
function scrollToProgress() {
  scrollTo({ top: 0, behavior: 'smooth' })
}
/* 벤으로 왔다가 무료 면접관으로 바꾸면 그제야 브라우저 모델이 필요해진다.
   벤일 때는 아예 받지 않으므로(model.llmSkipped) 여기서 받기 시작한다 */
watch(
  () => model.llmSkipped,
  (skipped) => {
    if (!skipped && model.engineMissing && model.active) void model.download()
  },
)

/* 목소리 없이 시작(#41): TTS가 실패했거나 Gemma가 된 뒤 TTS_STUCK_MS 넘게 준비 중(목소리 교체 중 포함)이면 텍스트 전용으로 바로 시작할 길을 연다 */
const ttsStuck = ref(false)
let stuckTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () =>
    model.status === 'ready' &&
    model.ttsEnabled &&
    (model.ttsStatus !== 'ready' || model.voiceSwitching),
  (waiting) => {
    if (stuckTimer) clearTimeout(stuckTimer)
    stuckTimer = null
    ttsStuck.value = false
    if (waiting) stuckTimer = setTimeout(() => (ttsStuck.value = true), TTS_STUCK_MS)
  },
  { immediate: true },
)
onBeforeUnmount(() => stuckTimer && clearTimeout(stuckTimer))
/** 목소리가 끝내 실패했는가. 시작을 막지는 않고 왜 자막인지만 알린다 */
const voiceFailed = computed(
  () => model.status === 'ready' && model.ttsEnabled && model.ttsStatus === 'error',
)
const voicelessOffer = computed(
  () =>
    model.status === 'ready' &&
    model.ttsEnabled &&
    (model.ttsStatus === 'error' || ttsStuck.value) &&
    infoDone.value &&
    interview.resumeDone,
)
function startVoiceless() {
  model.setVoiceWanted(false) // ttsEnabled=false → ready. 받아 둔 TTS 캐시는 남는다
  start()
}
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
  <div class="prepare stars">
    <!-- 기다리는 4분을 입력하는 4분으로 — 상황판과 입력을 한 화면에 나란히 세운다.
         좁으면 상황판이 위로 올라가 가로로 눕는다 (2026-11-07) -->
    <div class="cols">
      <aside class="rail" data-test="status-rail">
        <PixelWindow class="rise" :title="TITLE[phase]" padding="sm" data-test="progress">
          <PixelProgress
            :scale="sceneScale"
            :progress="model.overallProgress"
            :phase="phase"
            :received="model.overallReceived"
            :total="model.overallTotal"
            :file-name="fileName"
            :eta="eta"
            :speed="speed"
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

        <div class="start-row" data-test="go-box">
          <ul class="mono checklist" data-test="checklist">
            <li>
              <i :class="{ ok: infoDone, wait: !infoDone }" />
              {{ interview.track === 'admission' ? '이름 · 학교 · 학과 입력' : '분야 · 직무 입력' }}
            </li>
            <li>
              <i :class="{ ok: interview.resumeDone, wait: !interview.resumeDone }" />
              {{ longDocLabel }} 읽기
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
                  ok: voiceReady,
                  wait: !voiceReady,
                  blink:
                    model.voiceSwitching ||
                    (model.ttsStatus !== 'ready' && model.ttsStatus !== 'error'),
                }"
              />
              목소리 준비 · {{ interviewerName }} ({{
                model.voiceSwitching
                  ? '바꾸는 중'
                  : model.ttsStatus === 'ready'
                    ? '완료'
                    : model.ttsStatus === 'error'
                      ? '실패'
                      : `${model.ttsProgress}%`
              }})
            </li>
          </ul>
          <!-- 목소리를 기다리지 않고 시작할 수 있다. 무엇을 포기하는지는 알고 누르게 한다 -->
          <p v-if="model.voicePending" class="mono voice-pending" data-test="voice-pending">
            목소리는 아직 받는 중입니다 — 지금 시작하면 자막으로 진행하다가 준비되는 질문부터
            말합니다.
          </p>
          <p v-else-if="voiceFailed" class="mono voice-pending" data-test="voice-failed">
            목소리를 준비하지 못했습니다 — 자막으로 진행합니다.
          </p>
          <div class="start-btns">
            <PixelButton data-test="start" :disabled="!interview.canStart || busy" @click="start">{{
              startLabel
            }}</PixelButton>
            <!-- 곁가지다. 노란 버튼이 둘이면 어디를 눌러야 할지 흐려진다 (2026-11-07) -->
            <button
              v-if="voicelessOffer"
              type="button"
              class="mono link press"
              data-test="start-voiceless"
              :disabled="busy"
              @click="startVoiceless"
            >
              목소리 없이 시작
            </button>
            <button
              v-if="blockedByError"
              type="button"
              class="mono link press"
              data-test="start-scroll-top"
              @click="scrollToProgress"
            >
              ▲ 진행 창으로
            </button>
          </div>
          <p v-if="model.voiceError" class="mono start-error" data-test="voice-error">
            {{ model.voiceError }}
          </p>
          <p v-if="startError" class="mono start-error" data-test="start-error">{{ startError }}</p>
        </div>
      </aside>

      <div class="form">
        <!-- 면접관과 도움말은 입력 창 머리로. 시작 버튼은 왼쪽 상황판에 있다 -->
        <div class="form-head" data-test="form-head">
          <span class="mono" data-test="interviewer-chip">면접관: {{ interviewerName }}</span>
          <!-- 면접 시작을 기다리는 동안(busy)은 잠근다 — 면접은 옛 페르소나로 고정되는데 목소리만 바뀌지 않게 -->
          <button
            type="button"
            class="mono link press"
            data-test="change-interviewer"
            :disabled="busy"
            @click="pickerOpen = !pickerOpen"
          >
            {{ pickerOpen ? '닫기' : '바꾸기' }}
          </button>
          <button
            v-if="iv.current?.premium"
            type="button"
            class="mono link press ben-toggle"
            :class="{ on: benOpen }"
            data-test="ben-toggle"
            @click="benOpen = !benOpen"
          >
            성향 {{ benOpen ? '▴' : '▾' }}
          </button>
          <!-- 힌트를 꺼 둔 사람이 다시 켜는 유일한 길 -->
          <button
            v-if="!hints.enabled"
            type="button"
            class="mono link press"
            data-test="hints-on"
            @click="hints.enable()"
          >
            도움말 다시 보기
          </button>
        </div>
        <div v-if="pickerOpen && !busy" ref="pickerBox">
          <InterviewerPicker @need-premium="modal.show('premium')" />
        </div>
        <!-- 벤에게만 해당하는 것들을 한 상자로 묶는다 — 고지와 동의가 안내문 더미에
             흩어져 있으면 무엇이 벤 때문인지 보이지 않는다 (2026-11-07) -->
        <div v-if="iv.current?.premium" class="ben-box" data-test="ben-box">
          <!-- 벤은 대화가 서버를 거쳐 외부 AI로 간다(루트 CLAUDE.md 8번). 회사명을 적으면
             웹 검색까지 하므로 시작 전에 한 줄로 알린다 -->
          <p class="mono notice" data-test="ben-notice">
            벤과의 대화는 서버를 거쳐 외부 AI(Claude)로 갑니다.
            <template v-if="interview.track === 'company'">
              회사명·직무로 웹을 검색해 최신 정보를 참고합니다.
              <template v-if="interview.profile.postingUrl.trim()">
                모집공고 링크를 열어 요구사항을 참고합니다.
              </template>
            </template>
          </p>
          <!-- 목소리 분석은 녹음이 밖으로 한 번 더 나가는 일이라 따로 받는다(루트 CLAUDE.md 8번,
             2026-10-23 개정). 기본은 꺼짐 — 켜지 않으면 지금처럼 브라우저 측정만 쓴다.
             경유지(직접 호출인지 학교 게이트웨이인지)는 서버 설정으로 바뀌므로 적지 않는다.
             대신 무료 등급을 쓰는 동안 구글이 이 녹음을 보게 될 수 있다는 것은 밝힌다
             (2026-11-03 개정, `docs/specs/backend/2026-11-03-voice-gemini-direct-design.md`) -->
          <label class="mono voice-consent" data-test="voice-consent-row">
            <input
              type="checkbox"
              data-test="voice-consent"
              :checked="interview.voiceConsent"
              @change="interview.setVoiceConsent(($event.target as HTMLInputElement).checked)"
            />
            <span>
              답변 녹음을 목소리 분석을 위해 외부 AI(Google Gemini)로 보냅니다. Google이 서비스
              개선에 쓰거나 사람이 검토할 수 있어요. 분석 후 서버에서 지웁니다.
            </span>
          </label>
        </div>

        <!-- 벤 성향. 면접관에 딸린 설정이라 면접관 줄 바로 아래에 둔다 (2026-11-07) -->
        <div v-if="iv.current?.premium && benOpen" class="ben-panel" data-test="ben-panel">
          <div class="ben-head">
            <span class="mono ttl">벤의 성향</span>
            <span class="mono lock">시작하면 잠깁니다</span>
            <button
              v-if="benTouched"
              type="button"
              class="mono link press"
              data-test="ben-reset"
              @click="interview.benSettings = { ...DEFAULT_BEN }"
            >
              전부 기본값으로
            </button>
          </div>
          <BenSettings v-model="interview.benSettings" :show-company="benShowCompany" />
        </div>

        <PixelWindow title="어디에 지원하시나요?">
          <template #tag>
            <div class="stepnav">
              <PixelTag v-if="infoDone" tone="ok">입력 완료</PixelTag>
              <PixelTag v-if="interview.resumeDone" tone="ok">
                {{ interview.resumeText.length.toLocaleString() }}자 추출
              </PixelTag>
            </div>
          </template>

          <div class="step" data-test="step-profile">
            <!-- 트랙이 보는 칸만 그린다. 2단계 구조는 그대로 두고 안의 칸만 바뀐다 -->
            <template v-if="interview.track === 'admission'">
              <div class="two-up">
                <div class="field">
                  <label class="mono label" for="ad-name">이름</label>
                  <input
                    id="ad-name"
                    data-test="ad-name"
                    class="input"
                    maxlength="20"
                    :value="interview.profile.name"
                    placeholder="예: 홍길동"
                    @input="setAd('name', ($event.target as HTMLInputElement).value)"
                  />
                </div>
                <div class="field">
                  <label class="mono label" for="ad-age">나이</label>
                  <input
                    id="ad-age"
                    data-test="ad-age"
                    class="input"
                    type="number"
                    min="10"
                    max="99"
                    :value="interview.profile.age ?? ''"
                    placeholder="예: 19"
                    @input="setAge(($event.target as HTMLInputElement).value)"
                  />
                </div>
              </div>
              <div class="field">
                <label class="mono label" for="ad-univ">지원 대학</label>
                <input
                  id="ad-univ"
                  data-test="ad-university"
                  class="input"
                  maxlength="40"
                  :value="interview.profile.university"
                  placeholder="예: 한국대학교"
                  @input="setAd('university', ($event.target as HTMLInputElement).value)"
                />
              </div>
              <div class="field">
                <label class="mono label" for="ad-dept">지원 학과</label>
                <input
                  id="ad-dept"
                  data-test="ad-department"
                  class="input"
                  maxlength="40"
                  :value="interview.profile.department"
                  placeholder="예: 컴퓨터공학과"
                  @input="setAd('department', ($event.target as HTMLInputElement).value)"
                />
                <span class="mono hint"
                  >면접관이 질문의 방향을 잡는 데 씁니다 — 입력을 마치면 자기소개서 단계로
                  넘어갑니다</span
                >
              </div>
            </template>

            <template v-else>
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
                />
                <span class="mono hint"
                  >면접관이 질문의 방향을 잡는 데 씁니다. 예: 프론트엔드 개발, 재무 분석, 생산
                  관리<template v-if="!benCompany">
                    — 입력을 마치면 이력서 단계로 넘어갑니다</template
                  ></span
                >
              </div>
              <!-- 회사명은 벤만 쓴다(서버가 웹을 뒤져 브리핑을 만든다). 선택 입력이라
                     비워도 시작을 막지 않는다 — 체크리스트에도 넣지 않는다 -->
              <div v-if="benCompany" class="field">
                <label class="mono label" for="company-name"
                  >지원 회사 <span class="dim">(선택)</span></label
                >
                <input
                  id="company-name"
                  data-test="company-name"
                  class="input"
                  :value="interview.profile.companyName"
                  maxlength="100"
                  placeholder="예: 삼성전자 DS부문(반도체), 토스(비바리퍼블리카)"
                  @input="interview.setCompanyName(($event.target as HTMLInputElement).value)"
                />
                <span class="mono hint"
                  >회사 이름이 비슷한 곳이 많으면 사업부·서비스명까지 적어 주세요</span
                >
              </div>
              <!-- 공고 링크도 선택 입력. 회사명과 따로 — 둘 중 하나만 있어도 조사가 돈다 -->
              <div v-if="benCompany" class="field">
                <label class="mono label" for="posting-url"
                  >모집공고 링크 <span class="dim">(선택)</span></label
                >
                <input
                  id="posting-url"
                  data-test="posting-url"
                  class="input"
                  :value="interview.profile.postingUrl"
                  maxlength="500"
                  placeholder="예: https://careers.example.com/jobs/1234"
                  @input="interview.setPostingUrl(($event.target as HTMLInputElement).value)"
                />
                <span v-if="postingProblem" class="mono warn" data-test="posting-error">{{
                  postingProblem
                }}</span>
                <span v-else class="mono hint"
                  >공고를 열어 요구사항을 질문에 반영합니다. 회사명만 적어도 됩니다</span
                >
              </div>
            </template>
          </div>

          <h3 class="mono sep">{{ longDocLabel }}</h3>
          <div class="step" data-test="step-resume">
            <!-- 넷을 한꺼번에 펼치지 않는다. 탭 이름이 "넣는 방법이 넷"이라는 것도 알려 준다 -->
            <div class="tabs" role="tablist">
              <button
                v-for="t in resumeTabs"
                :key="t"
                type="button"
                role="tab"
                class="mono tab press"
                :class="{ on: resumeTab === t }"
                :aria-selected="resumeTab === t"
                data-test="resume-tab"
                @click="resumeTab = t"
              >
                {{ TAB_LABEL[t] }}
                <span v-if="t === 'saved'" class="mono count">{{ savedResumes.length }}</span>
              </button>
            </div>

            <!-- 미리 써 둔 것이 있으면 그것부터. 없는 사람에게는 탭 자체가 없다 -->
            <div v-if="resumeTab === 'saved'" class="saved" data-test="saved-resumes">
              <span class="mono lbl">저장한 {{ longDocLabel }}</span>
              <PixelButton
                v-for="s in savedResumes"
                :key="s.id"
                variant="secondary"
                data-test="saved-resume"
                @click="useSaved(s.id)"
              >
                {{ s.title }}
              </PixelButton>
            </div>
            <label
              v-if="resumeTab === 'file'"
              class="file-row press"
              :class="{ dragging }"
              data-test="drop"
              @dragover.prevent="dragging = true"
              @dragleave="dragging = false"
              @drop.prevent="onDrop"
            >
              <DocIcon />
              <span class="mono name">{{
                interview.resumeName ?? `${longDocLabel} PDF를 끌어다 놓거나 클릭해서 선택`
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
            <ResumeForm v-if="resumeTab === 'form'" @done="onFormDone" />
            <p v-if="extracting" class="mono hint">읽는 중…</p>
            <!-- 글자를 못 읽었으면 경고만 띄우고 두지 않는다. 붙여넣기 탭으로 데려간 뒤
                 그 자리에서 이유를 말한다 (2026-11-07) -->
            <p v-if="tooShort && resumeTab === 'paste'" class="mono warn">
              글자를 거의 읽지 못했습니다(스캔본일 수 있어요). 아래에 {{ longDocLabel }} 내용을 직접
              붙여넣어 주세요.
            </p>
            <textarea
              v-if="resumeTab === 'paste'"
              v-model="pasted"
              data-test="paste"
              class="input paste"
              rows="8"
              :placeholder="`${longDocLabel} 내용을 붙여넣기`"
              @input="usePasted"
              @blur="usePasted"
            />
            <div v-if="interview.resumeText && !tooShort && resumeTab !== 'form'" class="preview">
              {{ interview.resumeText }}
            </div>
            <p class="mono hint">
              앞 {{ (2000).toLocaleString() }}자만 면접관에게 전달됩니다. 이름·연락처 같은
              개인정보도 이 브라우저 안에서만 읽힙니다.
            </p>
          </div>
        </PixelWindow>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 두 기둥. 왼쪽은 붙어 따라오고 오른쪽만 흐른다 — 기다리는 4분 동안 입력이 끝나게 (2026-11-07) */
.cols {
  display: flex;
  gap: var(--sp-6);
  align-items: flex-start;
  max-width: var(--content-w);
  margin: 0 auto;
  padding: var(--sp-8) var(--sp-4);
}
.rail {
  flex: none;
  width: 376px;
  /* 전역 상단바 아래에 붙는다. 100vh는 쓰지 않는다(1번 철거 원칙) */
  position: sticky;
  top: calc(var(--topbar-h) + var(--sp-4));
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}
.form {
  flex: 1 1 0;
  min-width: 0;
}
/* 벤 성향 패널 — 면접관 줄 아래, 입력 창 위 */
.ben-panel {
  border: 2px solid var(--line);
  background: var(--win);
  padding: var(--sp-4);
  margin-bottom: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}
.ben-head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-3);
}
.ben-head .ttl {
  font-size: var(--fs-label);
  color: var(--accent);
}
.ben-head .lock {
  flex: 1 1 0;
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.ben-toggle.on {
  color: var(--accent);
}
.form-head {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  margin-bottom: var(--sp-3);
}
/* 좁으면 두 기둥이 안 선다 — 상황판이 위로 올라가 가로로 눕는다 */
@media (max-width: 1024px) {
  .cols {
    flex-direction: column;
    /* 세로로 쌓이면 flex-start는 "내용 너비"가 된다 — 늘려 주지 않으면
       입력 창이 제 내용만큼 넓어져 화면 밖으로 나간다 (2026-11-07) */
    align-items: stretch;
  }
  .rail,
  .form {
    width: 100%;
    position: static;
  }
}
/* 이름·나이는 짧아 나란히 둔다 */
.two-up {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: var(--sp-4);
}
@media (max-width: 560px) {
  .two-up {
    grid-template-columns: 1fr;
  }
}
/* scroll-padding-top은 문서(html)로 옮겼고, 섹션 최소 높이는 버렸다 — 스크롤러가
   요소가 아니라 문서이고, 내용이 길면 그냥 더 스크롤된다 (2026-11-07 철거) */
/* 준비 화면의 지역 머리글을 걷었다 (2026-11-08). 화면 이름은 전역 상단바가 이미
   적고, 개인정보 고지는 랜딩과 약관에 남아 있다 — 같은 말을 세 번 하지 않는다 */
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
/* 이력서를 넣는 네 방법. 고른 것만 채운다 — 넷이 다 칠해지면 어느 것이 켜졌는지 모른다.
   (2026-11-08: 이 규칙이 통째로 빠져 있어 탭이 기본 버튼 배경 위 흰 글자로 보이지 않았다) */
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.tab {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: var(--win-border);
  background: none;
  color: var(--text-3);
  font-size: var(--fs-label);
  cursor: pointer;
}
.tab:hover:not(.on) {
  color: var(--text);
  border-color: var(--accent);
}
.tab.on {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg);
}
/* 저장해 둔 것이 몇 개인지 — 탭 이름 뒤에 붙는다 */
.tab .count {
  font-size: var(--fs-meta);
  padding: 0 var(--sp-1);
  background: var(--raise);
  color: var(--text-2);
}
.tab.on .count {
  background: var(--bg);
  color: var(--accent);
}

/* 저장해 둔 것 고르기 — PDF 올리기 위에 둔다. 가진 사람에게는 이쪽이 빠른 길이다 */
.saved {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-3);
}
.saved .lbl {
  font-size: var(--fs-label);
  color: var(--text-2);
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
.file-row.dragging {
  border-color: var(--accent);
  color: var(--text);
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
.interviewer-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-bottom: var(--sp-3);
}
/* 읽는 글이다 — 산세로, 줄간도 읽기 쪽으로 (2026-11-07) */
.notice {
  margin: 0 0 var(--sp-2);
  color: var(--dim);
  font-family: var(--font-read);
  font-size: var(--fs-label);
  line-height: var(--lh-read);
}
.voice-consent {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  margin: 0 0 var(--sp-4);
  color: var(--text-2);
  font-family: var(--font-read);
  font-size: var(--fs-label);
  line-height: var(--lh-read);
  cursor: pointer;
}
.voice-consent input {
  margin-top: 0.25em;
  flex: none;
}
/* 벤에게만 해당하는 것들 — 고지와 동의를 한 상자로 묶어 무엇이 벤 때문인지 보이게 한다 */
.ben-box {
  border: 2px solid var(--accent);
  background: var(--raise);
  padding: var(--sp-4);
  margin-bottom: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.ben-box .notice,
.ben-box .voice-consent {
  margin: 0;
}
/* 체크리스트는 시작 버튼 **바로 위**에 붙는다 — 왜 못 누르는지가 버튼 옆에 있어야 한다.
   376px 상황판에서는 가로로 눕히면 어절 중간에서 끊긴다 (2026-11-07) */
.start-row {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
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
.start-btns {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--sp-2);
}
/* 좁은 기둥에서는 버튼이 가로를 다 쓴다 — 글자가 길어 뭉치지 않게 */
.start-btns :deep(button) {
  width: 100%;
}
.start-btns .link {
  align-self: center;
  width: auto;
}

.voice-pending {
  margin: 0 0 var(--sp-3);
  color: var(--text-2);
  font-size: var(--fs-meta);
  line-height: 1.6;
}
.link {
  background: none;
  border: 0;
  padding: 0;
  color: var(--accent);
  font-size: var(--fs-meta);
  cursor: pointer;
  --press-shadow: transparent;
}
.start-error {
  color: var(--danger);
  font-size: var(--fs-meta);
  margin: var(--sp-2) 0 0;
}
</style>
