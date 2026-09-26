<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import SpriteFrame from '@/components/ui/SpriteFrame.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import PixelTag from '@/components/ui/PixelTag.vue'
import SpeakerIcon from '@/components/ui/icons/SpeakerIcon.vue'
import type { Stage } from '@/stores/interview'
import type { CenterSprites } from '@/interviewers'
import { formatClock } from '@/utils/timing'
import {
  CANDIDATE_BACK,
  CANDIDATE_SCALE,
  FPS,
  LIFE,
  REACT,
  SCALE,
  baseAnims,
  sheetFor,
  watchAnim,
  type AnimName,
  type Char,
} from './interviewerAnims'

const props = withDefaults(
  defineProps<{
    stage: Stage
    bubble: string
    streaming: boolean
    reactPending: boolean
    watchTick: number
    fieldLabel: string
    job: string
    elapsedMs?: number
    muted?: boolean
    /** TTS 사용 중인지. 아니면(텍스트 전용) 음소거 토글과 합성 음성 안내를 숨긴다 */
    voice?: boolean
    warning?: string
    /** 가운데(말하는) 면접관 시트 — 없으면 기본 면접관 */
    centerSprites?: CenterSprites
    interviewerName?: string
  }>(),
  { muted: false, voice: true },
)
const emit = defineEmits<{ 'react-done': []; end: []; 'toggle-mute': [] }>()

/*
 * 세 사람의 애니 = 상태별 기본(baseAnims) 위에 캐릭터별 1회성 덮어쓰기(over).
 * 덮어쓰기는 SpriteFrame이 마지막 프레임에서 done을 주면 풀린다(1회성 시트는 마지막 프레임이 idle 자세).
 * 우선순위: 좋은 답변 반응 > 답변 지연 신호 > 평시 잔동작.
 */
const CHARS: Char[] = ['left', 'center', 'right']
const over = reactive<Record<Char, AnimName | null>>({ left: null, center: null, right: null })
const reacting = ref(false)

function playOnce(char: Char, anim: AnimName) {
  over[char] = anim
}
function onDone(char: Char) {
  const finished = over[char]
  over[char] = null
  if (char === 'center' && finished === 'center_nod' && reacting.value) {
    reacting.value = false
    emit('react-done')
  }
}

/* 좋은 답변: 세 명이 동시에 1회씩. react-done은 가운데 끄덕임이 끝날 때 */
watch(
  () => props.reactPending,
  (v) => {
    if (!v) return
    reacting.value = true
    for (const c of CHARS) playOnce(c, REACT[c])
  },
)
/* 답변 지연: 시계 ↔ 펜 톡톡 번갈아. 반응 중이면 가운데는 건드리지 않고 서기만 */
watch(
  () => props.watchTick,
  (t) => {
    if (t <= 0) return
    const w = watchAnim(t)
    if (w.char === 'center' && reacting.value) playOnce('right', 'right_pentap')
    else playOnce(w.char, w.anim)
  },
)

/* 평시 잔동작: 상태별·캐릭터별 무작위 간격으로 1회성 동작. 이미 무언가 하는 중이면 건너뛴다 */
const lifeTimers: Record<Char, ReturnType<typeof setTimeout> | null> = {
  left: null,
  center: null,
  right: null,
}
const rand = (a: number, b: number) => a + Math.random() * (b - a)
function scheduleLife(char: Char) {
  if (lifeTimers[char]) clearTimeout(lifeTimers[char]!)
  lifeTimers[char] = null
  const cfg = LIFE[props.stage]?.[char]
  if (!cfg) return
  lifeTimers[char] = setTimeout(
    () => {
      lifeTimers[char] = null
      if (!over[char] && !reacting.value) {
        const anim = cfg.anims[Math.floor(Math.random() * cfg.anims.length)]
        playOnce(char, anim)
      }
      scheduleLife(char)
    },
    rand(cfg.every[0], cfg.every[1]),
  )
}
watch(
  () => props.stage,
  () => CHARS.forEach(scheduleLife),
  { immediate: true },
)
onBeforeUnmount(() => {
  for (const c of CHARS) if (lifeTimers[c]) clearTimeout(lifeTimers[c]!)
})

const anims = computed(() => {
  const base = baseAnims(props.stage)
  return {
    left: over.left ?? base.left,
    center: over.center ?? base.center,
    right: over.right ?? base.right,
  }
})
const sheet = (name: AnimName) => sheetFor(name, props.centerSprites)
</script>

<template>
  <section class="stage" aria-label="면접실">
    <div class="topbar">
      <div class="left">
        <PixelTag tone="muted"
          >{{ fieldLabel }} · {{ job
          }}<template v-if="interviewerName"> · 면접관: {{ interviewerName }}</template></PixelTag
        >
        <span class="mono clock" data-test="clock" aria-label="경과 시간">{{
          formatClock(elapsedMs ?? 0)
        }}</span>
      </div>
      <div class="right">
        <button
          v-if="voice"
          type="button"
          class="mute press"
          :class="{ off: muted }"
          data-test="mute"
          :aria-pressed="muted"
          :title="muted ? '소리 켜기' : '소리 끄기'"
          :aria-label="muted ? '소리 켜기' : '소리 끄기'"
          @click="emit('toggle-mute')"
        >
          <span><SpeakerIcon :muted="muted" /></span>
        </button>
        <PixelButton variant="secondary" data-test="end" @click="emit('end')"
          >면접 종료</PixelButton
        >
      </div>
    </div>

    <div class="bubble mono" :class="{ streaming }" aria-live="polite">
      <span>{{ bubble || '…' }}</span
      ><span v-if="streaming" class="blink">▌</span>
    </div>
    <p v-if="warning" class="mono warning" data-test="tts-warning">{{ warning }}</p>

    <div class="row">
      <SpriteFrame
        v-for="c in CHARS"
        :key="c"
        :src="sheet(anims[c]).file"
        :frame-w="32"
        :frame-h="32"
        :frames="sheet(anims[c]).frames"
        :loop="sheet(anims[c]).loop"
        :scale="SCALE"
        :fps="FPS"
        :data-char="c"
        @done="onDone(c)"
      />
    </div>
    <div class="desk" />
    <!-- Supertonic 3 OpenRAIL-M 사용 제한: 기계 생성 음성임을 명시 (#34). 음소거와 무관하게 상시 표시 -->
    <p v-if="voice" class="mono ai-voice" data-test="ai-voice">
      면접관 음성은 AI로 합성한 목소리입니다 (Supertonic 3)
    </p>
    <div class="candidate">
      <SpriteFrame
        :src="CANDIDATE_BACK.file"
        :frame-w="CANDIDATE_BACK.w"
        :frame-h="CANDIDATE_BACK.h"
        :frames="1"
        :scale="CANDIDATE_SCALE"
      />
    </div>
  </section>
</template>

<style scoped>
.stage {
  position: relative;
  background: var(--win);
  border: var(--win-border);
  box-shadow: var(--win-inner);
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.stage::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 24px;
  background: var(--bg);
}
.topbar {
  position: absolute;
  inset: var(--sp-4) var(--sp-4) auto var(--sp-4);
  display: flex;
  justify-content: space-between;
  align-items: center;
  z-index: 2;
}
.left {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.clock {
  font-size: var(--fs-label);
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.right {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.mute {
  width: 36px;
  height: 36px;
  display: inline-grid;
  place-items: center;
  background: var(--raise);
  color: var(--accent);
  border: 2px solid var(--line);
  --press-shadow: var(--raise);
  box-shadow: 4px 4px 0 var(--press-shadow);
  cursor: pointer;
}
.mute.off {
  color: var(--text-3);
}
.ai-voice {
  position: absolute;
  left: var(--sp-4);
  bottom: var(--sp-3);
  margin: 0;
  font-size: var(--fs-meta);
  color: var(--text-3);
  z-index: 2;
}
.warning {
  margin: var(--sp-3) 0 0;
  font-size: var(--fs-meta);
  color: var(--danger);
}
.bubble {
  margin-top: 56px;
  max-width: 720px;
  min-height: 72px;
  padding: var(--sp-4) var(--sp-5);
  background: var(--bg);
  color: var(--text);
  border: var(--win-border);
  font-size: var(--fs-body-md);
  line-height: 1.6;
  white-space: pre-wrap;
  position: relative;
}
.bubble::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -12px;
  width: 12px;
  height: 12px;
  background: var(--bg);
  transform: translateX(-50%) rotate(45deg);
}
.row {
  display: flex;
  gap: var(--sp-8);
  margin-top: var(--sp-5);
}
.desk {
  width: 80%;
  height: 40px;
  margin-top: -8px;
  background: var(--raise);
  border-bottom: 4px solid var(--bg);
}
/* 지원자(내 정수리)는 책상에서 한참 떨어진 아래에서 걸쳐 보인다 — 면접관과의 거리감 */
.candidate {
  position: absolute;
  bottom: -80px;
  left: 50%;
  transform: translateX(-50%);
}
</style>
