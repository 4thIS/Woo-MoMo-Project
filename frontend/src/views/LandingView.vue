<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useModelStore } from '@/stores/model'
import { useInterviewStore } from '@/stores/interview'
import { checkEnvironment, type EnvCheck } from '@/services/gpuCheck'
import { verdict } from '@/utils/envVerdict'
import { formatGB } from '@/utils/format'
import PixelWindow from '@/components/ui/PixelWindow.vue'
import PixelTag from '@/components/ui/PixelTag.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import ChoiceMenu from '@/components/ui/ChoiceMenu.vue'
import StatCard from '@/components/ui/StatCard.vue'
import KeyValueGrid from '@/components/ui/KeyValueGrid.vue'
import SpeechText from '@/components/ui/SpeechText.vue'
import Avatar from '@/components/ui/Avatar.vue'
import CursorIcon from '@/components/ui/icons/CursorIcon.vue'

const model = useModelStore()
const interview = useInterviewStore()

/* 히어로 페이드: 스크롤 진행률 0→1 */
const hero = ref<HTMLElement | null>(null)
const fade = ref(0)
const onScroll = () => {
  const h = hero.value?.offsetHeight ?? 1
  fade.value = Math.min(1, Math.max(0, window.scrollY / (h * 0.6)))
}
onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  if (!model.manifest) model.loadManifest()
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))

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
const need = computed(() => model.active?.size ?? 0)
const result = computed(() => (env.value ? verdict(env.value, need.value) : null))

async function onConsent(v: Consent) {
  consent.value = v
  if (v === 'no') {
    introEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  envBusy.value = true
  env.value = await checkEnvironment()
  envBusy.value = false
  await nextTick()
  envEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const sizeText = computed(() => (model.active ? formatGB(model.active.size) : '확인 중'))
const kv = computed(() => [
  { key: '모델', value: model.active?.id ?? '확인 중' },
  { key: '용량', value: sizeText.value },
  { key: '저장 위치', value: '이 브라우저의 캐시' },
  { key: '삭제', value: '사이트 데이터 삭제로 언제든' },
])
const storageText = computed(() => {
  if (!env.value) return '확인 중'
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
  <div class="landing stars">
    <!-- 1. 타이틀 -->
    <section
      ref="hero"
      class="hero"
      :style="{ opacity: 1 - fade, transform: `translateY(${-40 * fade}px)` }"
    >
      <PixelWindow padding="md" class="title-win">
        <template #header><PixelTag>브라우저에서 실행 · 서버 전송 없음</PixelTag></template>
        <h1 class="display logo">모두의<br />모의면접</h1>
        <p class="sub">이력서를 읽는 AI 면접관이 이 컴퓨터 안에서 기다립니다.</p>
      </PixelWindow>
      <div class="hint blink"><CursorIcon /> 아래로 내려서 시작</div>
    </section>

    <div class="content">
      <!-- 2. 면접관 소개 -->
      <section ref="introEl">
        <PixelWindow>
          <div class="intro">
            <Avatar src="/sprites/interviewers/center_talk.png" :frames="7" />
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
      </section>

      <!-- 3. 동의 -->
      <PixelWindow title="모델 다운로드에 동의하시겠습니까?">
        <KeyValueGrid :items="kv" />
        <p v-if="model.manifestError" class="mono meta danger">
          서버에 연결할 수 없습니다 — 새로고침해 주세요.
        </p>
        <ChoiceMenu :items="consentItems" :model-value="consent" @update:model-value="onConsent" />
        <p class="mono meta">선택하면 아래 장비 확인 창으로 이동합니다.</p>
      </PixelWindow>

      <!-- 4. 장비 확인 -->
      <section v-if="consent === 'yes'" ref="envEl" data-test="env">
        <PixelWindow title="장비 확인">
          <template #tag>
            <PixelTag v-if="result === 'ok'" tone="ok">출전 가능</PixelTag>
            <PixelTag v-else-if="result === 'no-webgpu'" tone="danger">실행 불가</PixelTag>
            <PixelTag v-else-if="result === 'no-space'" tone="danger">공간 부족</PixelTag>
            <PixelTag v-else tone="muted">확인 중</PixelTag>
          </template>
          <div class="stats">
            <StatCard
              label="WebGPU"
              :value="env ? (env.webgpu ? '지원됨' : '지원 안 됨') : '확인 중'"
              :state="env ? (env.webgpu ? 'ok' : 'fail') : 'pending'"
            />
            <StatCard
              label="GPU"
              :value="env ? (env.gpuName ?? '이름 확인 불가') : '확인 중'"
              :state="env ? (env.webgpu ? 'partial' : 'fail') : 'pending'"
            />
            <StatCard
              label="저장 공간"
              :value="storageText"
              :state="
                !env
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
            하드웨어 성능에 따라 응답 속도와 면접 품질이 달라질 수 있습니다. GPU 메모리가 부족하면
            경량 모델(E2B, 약 2.0GB)로 자동 전환되며, 그 경우 질문의 깊이가 얕아질 수 있습니다.
          </p>
          <p v-if="result === 'no-webgpu'" class="body2 danger">
            이 브라우저에서는 WebGPU를 쓸 수 없습니다. 최신 Chrome(데스크톱)과 전용 GPU가
            필요합니다.
          </p>
          <p v-else-if="result === 'no-space'" class="body2 danger">
            브라우저 저장 공간이 부족합니다. {{ sizeText }} 이상 비워 주세요.
          </p>
          <PixelButton
            data-test="start-download"
            :disabled="result !== 'ok' || envBusy"
            @click="startDownload"
          >
            확인했습니다. 내려받기 시작
          </PixelButton>
        </PixelWindow>
      </section>
    </div>
  </div>
</template>

<style scoped>
.landing {
  min-height: 100vh;
  padding-bottom: 120px;
}
.hero {
  height: 780px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-10);
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
.sub {
  margin: 0;
  font-size: var(--fs-body-md);
  color: var(--text-2);
}
.hint {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  font-size: var(--fs-button);
  color: var(--accent);
}
.content {
  max-width: var(--content-w);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--sp-10);
  padding: 0 var(--sp-4);
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
.danger {
  color: var(--danger);
}
.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--sp-4);
}
@media (max-width: 1280px) {
  .content {
    padding: 0 var(--sp-10);
  }
}
</style>
