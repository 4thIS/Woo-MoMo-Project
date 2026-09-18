<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useModelStore } from '@/stores/model'
import { useInterviewStore } from '@/stores/interview'
import { checkEnvironment, type EnvCheck } from '@/services/gpuCheck'
import { verdict } from '@/utils/envVerdict'
import { formatGB, formatSize } from '@/utils/format'
import { useSectionWheel } from '@/composables/useSectionWheel'
import PixelWindow from '@/components/ui/PixelWindow.vue'
import PixelTag from '@/components/ui/PixelTag.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import ChoiceMenu from '@/components/ui/ChoiceMenu.vue'
import StatCard from '@/components/ui/StatCard.vue'
import SpeechText from '@/components/ui/SpeechText.vue'
import Avatar from '@/components/ui/Avatar.vue'
import CursorIcon from '@/components/ui/icons/CursorIcon.vue'

const model = useModelStore()
const interview = useInterviewStore()

/* 히어로 페이드: 스크롤 진행률 0→1 (스크롤 컨테이너는 .snap-root인 루트 요소) */
const root = ref<HTMLElement | null>(null)
const hero = ref<HTMLElement | null>(null)
const fade = ref(0)
useSectionWheel(root)
const onScroll = () => {
  const h = hero.value?.offsetHeight ?? 1
  fade.value = Math.min(1, Math.max(0, (root.value?.scrollTop ?? 0) / (h * 0.6)))
}
/* 매니페스트 로드 실패 안내는 5초 지연 후에만 보여준다(spec §5: "확인 중" 유지) */
const manifestTimedOut = ref(false)
let manifestTimer: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  root.value?.addEventListener('scroll', onScroll, { passive: true })
  if (!model.manifest) model.loadManifest()
  manifestTimer = setTimeout(() => (manifestTimedOut.value = true), 5000)
})
onBeforeUnmount(() => {
  root.value?.removeEventListener('scroll', onScroll)
  if (manifestTimer) clearTimeout(manifestTimer)
})

/* 동의 */
type Consent = 'yes' | 'no'
const consent = ref<Consent | null>(null)
const consentItems = [
  { value: 'yes' as const, label: '네, 이해했고 이 브라우저에 내려받는 데 동의합니다.' },
  { value: 'no' as const, label: '아니요, 더 알아보고 올게요.' },
]
const introEl = ref<HTMLElement | null>(null)
const envEl = ref<HTMLElement | null>(null)

/* 장비 확인 */
const env = ref<EnvCheck | null>(null)
const envBusy = ref(false)
/* 필요 용량: 모델 + 음성 모델(동의 창의 합계). 재방문(이미 캐시)이면 더 받을 게 없으니 0 — 디스크가 꽉 차도 막지 않는다 */
const need = computed(() => (model.cached ? 0 : model.downloadSize))
/* 매니페스트를 아직 못 받았으면(model.active 없음) 판정을 내리지 않는다 */
const result = computed(() => (env.value && model.active ? verdict(env.value, need.value) : null))

async function runCheck() {
  envBusy.value = true
  env.value = await checkEnvironment()
  envBusy.value = false
}
/* 재방문(#33): 선택한 모델·목소리가 전부 캐시에 있으면 동의·장비 확인을 "접힌 통과 표시"로 두고 버튼 하나로 준비 화면.
 * 면책은 매번 보이고(펼치면 표), 장비 확인은 매번 자동으로 다시 한다(WebGPU 설정은 바뀔 수 있다). */
const revisit = computed(() => model.cached === true)
const consentOpen = ref(false)
const revisitLine = computed(() => {
  const names = [model.active?.id, model.ttsEnabled ? model.manifest?.tts?.id : null]
    .filter(Boolean)
    .join(' · ')
  const voice = model.manifest?.tts && !model.ttsEnabled ? ' · 목소리 없음(텍스트만)' : ''
  return `${names}${voice} — 이 브라우저에 저장됨`
})
watch(
  revisit,
  (v) => {
    if (!v) return
    consent.value = 'yes'
    if (!env.value && !envBusy.value) void runCheck()
  },
  { immediate: true },
)

async function onConsent(v: Consent) {
  consent.value = v
  if (v === 'no') {
    introEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  await runCheck()
  await nextTick()
  envEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/* 동의 창(#32·#36): 모델별 한 행(모델·용량·저장 위치·삭제) + 첫 열 체크박스. 값은 전부 매니페스트에서 (하드코딩 없음).
 * Gemma는 필수라 체크 고정, 목소리(TTS)는 해제 가능(기본 켬, 선택은 스토어가 기억). tts가 없으면 1행뿐 */
const sizeText = computed(() => (model.active ? formatSize(model.downloadSize) : '확인 중'))
const tts = computed(() => model.manifest?.tts ?? null)
const consentTitle = computed(() =>
  tts.value
    ? '면접관 모델·목소리 다운로드에 동의하시겠습니까?'
    : '모델 다운로드에 동의하시겠습니까?',
)
const CACHE_CELLS = ['이 브라우저의 캐시', '사이트 데이터 삭제로 언제든']
const rows = computed(() => [
  {
    test: 'model',
    name: model.active?.id ?? '확인 중',
    size: model.active ? formatSize(model.active.size) : '',
    checked: true,
    fixed: true,
  },
  ...(tts.value
    ? [
        {
          test: 'voice',
          name: `${tts.value.id} (목소리 ${tts.value.voice})`,
          size: formatSize(tts.value.files.reduce((n, f) => n + f.size, 0)),
          checked: model.voiceWanted,
          fixed: false,
        },
      ]
    : []),
])
const storageText = computed(() => {
  if (!env.value) return '확인 중'
  if (model.cached)
    return env.value.storageFree === null
      ? '이미 받아 둠'
      : `여유 ${(env.value.storageFree / 1024 ** 3).toFixed(1)}GB · 이미 받아 둠`
  if (env.value.storageFree === null)
    return '알 수 없음 · 필요 ' + sizeText.value.replace('약 ', '')
  return `여유 ${(env.value.storageFree / 1024 ** 3).toFixed(1)}GB · 필요 ${sizeText.value.replace('약 ', '')}`
})

function startDownload() {
  navigator.storage?.persist?.().catch(() => undefined)
  void model.download()
  interview.goto('prepare')
}
</script>

<template>
  <div ref="root" class="landing stars snap-root">
    <!-- 1. 타이틀 -->
    <section
      ref="hero"
      class="hero snap"
      :style="{ opacity: 1 - fade, transform: `translateY(${-40 * fade}px)` }"
    >
      <PixelWindow padding="md" class="title-win rise">
        <template #header><PixelTag>브라우저에서 실행 · 서버 전송 없음</PixelTag></template>
        <h1 class="display logo rise"><b class="mo">모</b>두의<br /><b class="mo">모</b>의면접</h1>
        <p class="sub rise">이력서를 읽는 AI 면접관이 이 컴퓨터 안에서 기다립니다.</p>
      </PixelWindow>
      <div class="hint rise">
        <span class="blink"><CursorIcon /> 아래로 내려서 시작</span>
      </div>
    </section>

    <!-- 2. 면접관 소개 -->
    <section ref="introEl" class="snap">
      <div class="content">
        <PixelWindow>
          <div class="intro">
            <Avatar src="/sprites/interviewers/center_idle.png" :frames="15" />
            <div class="intro-text">
              <PixelTag>면접관</PixelTag>
              <SpeechText
                text="반갑습니다. 저는 여러분의 이력서 PDF를 읽고 질문 다섯 개를 준비합니다. 답변이 흥미로우면 꼬리질문도 하죠. 말로 답해도 되고 글로 답해도 됩니다. 끝나면 점수 대신 문항별 피드백을 드리겠습니다."
              />
              <p class="note">
                단, 저는 서버가 아니라 이 브라우저 안에서 움직입니다. 그래서 처음 한 번은 제 몸(모델
                파일)을 내려받아야 합니다.
              </p>
            </div>
          </div>
        </PixelWindow>
      </div>
    </section>

    <!-- 3. 동의 -->
    <section class="snap">
      <div class="content">
        <PixelWindow :title="revisit ? '이미 받아 둔 모델' : consentTitle">
          <!-- 재방문: 접힌 통과 표시. 펼치면 아래 표(체크박스)가 그대로 나온다 -->
          <p v-if="revisit" class="mono pass" data-test="revisit-consent">
            <span class="ok">✓</span> {{ revisitLine }}
            <button
              type="button"
              class="link press"
              data-test="revisit-expand"
              @click="consentOpen = !consentOpen"
            >
              {{ consentOpen ? '접기' : '자세히' }}
            </button>
          </p>
          <table v-if="!revisit || consentOpen" class="models mono">
            <thead>
              <tr>
                <th><span class="sr">받기</span></th>
                <th>모델</th>
                <th>용량</th>
                <th>저장 위치</th>
                <th>삭제</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(r, i) in rows"
                :key="r.test"
                data-test="model-row"
                :class="{ off: !r.checked }"
              >
                <td>
                  <input
                    type="checkbox"
                    :data-test="`pick-${r.test}`"
                    :checked="r.checked"
                    :disabled="r.fixed"
                    :aria-label="r.fixed ? `${r.name} (필수)` : `${r.name} 받기`"
                    @change="model.setVoiceWanted(($event.target as HTMLInputElement).checked)"
                  />
                </td>
                <td>{{ r.name }}</td>
                <td>{{ r.size }}</td>
                <td>{{ i === 0 ? CACHE_CELLS[0] : '〃' }}</td>
                <td>{{ i === 0 ? CACHE_CELLS[1] : '〃' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="tts && (!revisit || consentOpen)" class="mono meta sum">
            <span data-test="total">합계 {{ sizeText }}</span>
            <span v-if="model.ttsEnabled" data-test="ai-voice"
              >음성은 브라우저에서 AI로 합성됩니다</span
            >
          </p>
          <p v-if="manifestTimedOut && !model.manifest" class="mono meta err">
            서버에 연결할 수 없습니다 — 새로고침해 주세요.
          </p>
          <template v-if="!revisit">
            <ChoiceMenu
              :items="consentItems"
              :model-value="consent"
              aria-label="다운로드 동의"
              @update:model-value="onConsent"
            />
            <p class="mono meta">선택하면 아래 장비 확인 창으로 이동합니다.</p>
          </template>
          <p v-else class="mono meta">이력서·대화·리포트는 이 브라우저를 떠나지 않습니다.</p>
        </PixelWindow>
      </div>
    </section>

    <!-- 4. 장비 확인 -->
    <section v-if="consent === 'yes'" ref="envEl" class="snap" data-test="env">
      <div class="content">
        <PixelWindow title="장비 확인">
          <template #tag>
            <PixelTag v-if="result === 'ok'" tone="ok">출전 가능</PixelTag>
            <PixelTag v-else-if="result === 'no-webgpu'" tone="danger">실행 불가</PixelTag>
            <PixelTag v-else-if="result === 'no-space'" tone="danger">공간 부족</PixelTag>
            <PixelTag v-else tone="muted">확인 중</PixelTag>
          </template>
          <!-- 재방문 + 통과: 한 줄로 접고 바로 준비 화면으로. 실패면 아래 원인별 조치를 그대로 보여준다 -->
          <template v-if="revisit && result === 'ok'">
            <p class="mono pass" data-test="revisit-env">
              <span class="ok">✓</span> WebGPU · {{ env?.gpuName ?? 'GPU' }} · {{ storageText }}
            </p>
            <div class="btn-row">
              <PixelButton data-test="go-prepare" :disabled="envBusy" @click="startDownload">
                바로 준비하기
              </PixelButton>
            </div>
          </template>
          <template v-else>
            <div class="stats">
              <StatCard
                label="WebGPU"
                :value="env ? (env.webgpu ? '지원됨' : '지원 안 됨') : '확인 중'"
                :state="env ? (env.webgpu ? 'ok' : 'fail') : 'pending'"
              />
              <StatCard
                label="GPU"
                :value="env ? (env.gpuName ?? '이름 확인 불가') : '확인 중'"
                :state="!env ? 'pending' : !env.webgpu ? 'fail' : env.gpuName ? 'ok' : 'partial'"
              />
              <StatCard
                label="저장 공간"
                :value="storageText"
                :state="
                  !env || !model.active
                    ? 'pending'
                    : result === 'no-space'
                      ? 'fail'
                      : env.storageFree === null
                        ? 'partial'
                        : 'ok'
                "
              />
            </div>
            <p class="body2">
              하드웨어 성능에 따라 응답 속도와 면접 품질이 달라질 수 있습니다.
              <template v-if="model.manifest?.fallback">
                GPU 메모리가 부족하면 경량 모델({{ model.manifest.fallback.id }},
                {{ formatGB(model.manifest.fallback.size) }})로 자동 전환되며, 그 경우 질문의 깊이가
                얕아질 수 있습니다.
              </template>
            </p>
            <!-- 실패 시 원인별 조치. 막다른 길을 만들지 않는다 -->
            <div v-if="result === 'no-webgpu'" class="fix" data-test="fix-webgpu">
              <template v-if="env?.webgpuReason === 'no-adapter'">
                <p class="body2 err">
                  WebGPU는 있지만 GPU를 잡지 못했습니다. 대부분 Chrome의 그래픽 가속이 꺼져 있는
                  경우입니다.
                </p>
                <ol class="body2 steps">
                  <li>
                    주소창에 <code class="mono">chrome://settings/system</code> 입력 → "가능한 경우
                    그래픽 가속 사용"(또는 "하드웨어 가속 사용") 켜기
                  </li>
                  <li>"다시 시작" 버튼으로 Chrome을 재시작한 뒤 이 페이지로 돌아오기</li>
                  <li>
                    그래도 안 되면 <code class="mono">chrome://gpu</code>에서 WebGPU 항목이
                    "Hardware accelerated"인지 확인 (노트북은 전원 연결·고성능 GPU 선택)
                  </li>
                </ol>
              </template>
              <template v-else>
                <p class="body2 err">이 브라우저에는 WebGPU가 없습니다.</p>
                <ol class="body2 steps">
                  <li>
                    데스크톱 <b>Chrome</b> 또는 <b>Edge</b> 최신 버전으로 열어 주세요 (Chrome 113+)
                  </li>
                  <li>
                    이미 Chrome이라면 <code class="mono">chrome://settings/help</code>에서 업데이트
                    후 재시작
                  </li>
                </ol>
              </template>
            </div>
            <p v-else-if="result === 'no-space'" class="body2 err">
              브라우저 저장 공간이 부족합니다. {{ sizeText }} 이상 비워 주세요. 다른 사이트 데이터를
              지우거나 디스크 여유를 만든 뒤 다시 확인해 주세요.
            </p>
            <div class="btn-row">
              <PixelButton
                data-test="start-download"
                :disabled="result !== 'ok' || envBusy || !model.active"
                @click="startDownload"
              >
                확인했습니다. 내려받기 시작
              </PixelButton>
              <PixelButton
                v-if="result && result !== 'ok'"
                data-test="recheck"
                variant="secondary"
                :disabled="envBusy"
                @click="runCheck"
              >
                {{ envBusy ? '확인 중…' : '다시 확인' }}
              </PixelButton>
            </div>
          </template>
        </PixelWindow>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hero {
  flex-direction: column;
  gap: var(--sp-10);
}
/* 창 → 로고 → 부제 → 안내 순으로 계단식 등장 */
.logo.rise {
  animation-delay: 0.3s;
}
.sub.rise {
  animation-delay: 0.6s;
}
.hint.rise {
  animation-delay: 0.9s;
}
.title-win {
  align-items: center;
  text-align: center;
  padding: var(--sp-14) 72px 48px;
}
.logo {
  margin: 0;
  font-size: var(--fs-logo);
  line-height: 0.95;
  letter-spacing: -2px;
  text-shadow: 8px 8px 0 var(--raise);
}
/* MoMo — 두 "모"만 노랑 */
.mo {
  font-weight: inherit;
  color: var(--accent);
}
.sub {
  margin: 0;
  font-size: var(--fs-body-md);
  color: var(--text-2);
}
.hint {
  font-size: var(--fs-button);
  color: var(--accent);
}
.hint > span {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.intro {
  display: flex;
  gap: var(--sp-8);
  align-items: flex-start;
}
.intro-text {
  display: flex;
  flex-direction: column;
  gap: 18px;
  align-items: flex-start;
}
.note {
  margin: 0;
  color: var(--text-2);
}
.models {
  width: 100%;
  border-collapse: collapse;
  background: var(--bg);
  font-size: var(--fs-label);
  line-height: 1.6;
}
.models th,
.models td {
  text-align: left;
  padding: var(--sp-2) var(--sp-3);
  vertical-align: top;
}
.models th {
  color: var(--text-3);
  font-size: var(--fs-meta);
  font-weight: normal;
  border-bottom: 2px solid var(--raise);
}
.models td {
  color: var(--text);
}
.models tr.off td {
  color: var(--text-3);
}
.models input {
  accent-color: var(--accent);
  width: 16px;
  height: 16px;
  margin: 0;
  cursor: pointer;
}
.models input:disabled {
  cursor: default;
  opacity: 0.6;
}
.sum {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-4);
  flex-wrap: wrap;
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
@media (max-width: 640px) {
  .models thead {
    display: none;
  }
  .models tr {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0 var(--sp-3);
    padding: var(--sp-2) 0;
    border-bottom: 2px solid var(--raise);
  }
  .models td:first-child {
    grid-row: span 4;
  }
}
.pass {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin: 0;
  padding: var(--sp-3) var(--sp-4);
  background: var(--bg);
  font-size: var(--fs-label);
  color: var(--text);
}
.pass .ok {
  color: var(--ok);
}
.link {
  margin-left: auto;
  background: none;
  border: 0;
  padding: 0 var(--sp-2);
  color: var(--accent);
  font: inherit;
  cursor: pointer;
  --press-shadow: transparent;
}
.meta {
  margin: 0;
  font-size: var(--fs-meta);
  color: var(--text-2);
}
.body2 {
  margin: 0;
  color: var(--text-2);
  line-height: 1.75;
}
.err {
  color: var(--danger);
}
.fix {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.steps {
  margin: 0;
  padding-left: 22px;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.steps code {
  color: var(--accent);
  font-size: var(--fs-label);
}
.btn-row {
  display: flex;
  gap: var(--sp-3);
  flex-wrap: wrap;
}
.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--sp-4);
}
</style>
