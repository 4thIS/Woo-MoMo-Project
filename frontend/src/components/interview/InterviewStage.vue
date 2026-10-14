<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, watch } from 'vue'
import SpriteFrame from '@/components/ui/SpriteFrame.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import PixelTag from '@/components/ui/PixelTag.vue'
import SpeakerIcon from '@/components/ui/icons/SpeakerIcon.vue'
import type { Stage } from '@/stores/interview'
import { CENTER_FRAME_PX, SIDE_SPRITES, type CenterSprites, type SideSprites } from '@/interviewers'
import { formatClock } from '@/utils/timing'
import {
  CANDIDATE_BACK,
  CANDIDATE_SCALE,
  DESK_OVERLAP,
  FPS,
  LIFE,
  SCALE,
  SPEECH_CLIPS,
  baseAnims,
  sheetFor,
  speechClip,
  watchAnim,
  type AnimName,
  type Char,
} from './interviewerAnims'

const props = withDefaults(
  defineProps<{
    stage: Stage
    bubble: string
    streaming: boolean
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
    /** 좌우 배석자 시트 — 없으면 새 시트(sl·sr) */
    sideSprites?: SideSprites
    interviewerName?: string
  }>(),
  { muted: false, voice: true, sideSprites: () => SIDE_SPRITES },
)
const emit = defineEmits<{ end: []; 'toggle-mute': [] }>()

/*
 * 세 사람의 애니 = 상태별 기본(baseAnims) 위에 캐릭터별 1회성 덮어쓰기(over).
 * 덮어쓰기는 SpriteFrame이 마지막 프레임에서 done을 주면 풀린다(1회성 시트는 마지막 프레임이 기본 자세).
 * 우선순위: 말하기 클립(question_in·out) > 답변 지연 신호 > 평시 잔동작.
 */
const CHARS: Char[] = ['left', 'center', 'right']
const over = reactive<Record<Char, AnimName | null>>({ left: null, center: null, right: null })
/** 말하기 클립이 재생 중일 때 다음에 이어 붙일 클립(들기 도중 말이 끝나면 다 든 뒤 내려놓기) */
let queuedCenter: AnimName | null = null

function playOnce(char: Char, anim: AnimName) {
  over[char] = anim
}
function onDone(char: Char) {
  over[char] = null
  if (char === 'center' && queuedCenter) {
    playOnce('center', queuedCenter)
    queuedCenter = null
  }
}
const centerSpeaking = () =>
  props.stage === 'speaking' || (over.center !== null && SPEECH_CLIPS.includes(over.center))

/* 말하기: question_in(1회) → question(반복, baseAnims) → 말이 끝나면 question_out(1회) → idle.
 * 이음새 포즈가 맞춰져 있으니 클립 도중에 끊지 않고 뒤에 이어 붙인다 */
watch(
  () => props.stage,
  (st, prev) => {
    const clip = speechClip(prev, st)
    if (!clip) return
    const cur = over.center
    if (cur && SPEECH_CLIPS.includes(cur)) queuedCenter = cur === clip ? null : clip
    else {
      queuedCenter = null
      playOnce('center', clip)
    }
  },
)
/* 답변 지연: 시계 ↔ 펜 톡톡 번갈아. 가운데가 말하는 중(클립 포함)이면 가운데는 건드리지 않고 서기만 */
watch(
  () => props.watchTick,
  (t) => {
    if (t <= 0) return
    const w = watchAnim(t)
    if (w.char === 'center' && centerSpeaking()) playOnce('right', 'right_pentap')
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
      if (!over[char]) {
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
const sheet = (name: AnimName) => sheetFor(name, props.centerSprites, props.sideSprites)
</script>

<template>
  <section class="stage" :style="{ '--overlap': `${DESK_OVERLAP}px` }" aria-label="면접실">
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
      <!-- 스크롤은 **안쪽**에 둔다 — .bubble에 걸면 말꼬리(::after)가 잘린다 -->
      <div class="says">
        <span>{{ bubble || '…' }}</span
        ><span v-if="streaming" class="blink">▌</span>
      </div>
    </div>
    <p v-if="warning" class="mono warning" data-test="tts-warning">{{ warning }}</p>

    <!-- 상판(스프라이트 책상)과 앞판을 한 덩어리로 묶는다 — 앞판이 상판보다 넓으면 딴 물건으로 보인다 -->
    <div class="board">
      <div class="row">
        <!-- 동작이 바뀔 때마다 새로 그린다: 대체 세트에선 in·out이 같은 시트라 props만으론 다시 재생되지 않는다 -->
        <SpriteFrame
          v-for="c in CHARS"
          :key="`${c}:${anims[c]}`"
          :src="sheet(anims[c]).file"
          :frame-w="CENTER_FRAME_PX"
          :frame-h="CENTER_FRAME_PX"
          :frames="sheet(anims[c]).frames"
          :loop="sheet(anims[c]).loop"
          :scale="SCALE"
          :fps="FPS"
          :data-char="c"
          @done="onDone(c)"
        />
      </div>
      <div class="desk" />
    </div>
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
  box-shadow: var(--win-shadow);
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
  /* 무대가 좁아도 좌우 숨통을 남긴다 */
  max-width: min(720px, calc(100% - var(--sp-10)));
  min-height: 72px;
  /* 질문은 눌리지 않는다 — flex 부모가 줄이면 글자가 상자 밖으로 샌다 */
  flex-shrink: 0;
  padding: var(--sp-4) var(--sp-5);
  background: var(--bg);
  color: var(--text);
  border: var(--win-border);
  font-size: var(--fs-body-md);
  line-height: 1.6;
  white-space: pre-wrap;
  position: relative;
}
/* 아주 긴 질문은 상자 안에서 스크롤한다. 전문은 아래 대화창에도 남는다 */
.says {
  max-height: clamp(72px, 26vh, 220px);
  overflow-y: auto;
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
.board {
  display: flex;
  flex-direction: column;
  margin-top: var(--sp-5);
}
.row {
  display: flex;
  gap: 0;
}
/* 프레임 양옆 빈 칸만큼 서로 파고들게 해 세 책상이 한 줄로 이어진다.
   몸통은 책상보다 좁아 겹쳐도 닿지 않는다 */
.row > * {
  margin-inline: calc(var(--overlap) * -1);
}
/* 책상의 앞판. 나무 상판 바로 아래에 붙어 한 덩어리로 보인다 —
   프레임 아래쪽 빈 칸(= 겹침 폭과 같다)만큼 끌어올려 상판 끝에 맞춘다 */
.desk {
  /* 상판과 같은 폭 — .board가 스프라이트 줄 너비로 줄어든다 */
  width: 100%;
  height: 40px;
  margin-top: calc(var(--overlap) * -1);
  background: var(--raise);
  border-bottom: 4px solid var(--bg);
}
/* 지원자(내 정수리)는 책상 앞판에 살짝 걸친 채 아래가 잘려 보인다 — 면접관과의 거리감.
   무대 바닥이 아니라 **책상에** 매달아 둔다. 바닥 기준이면 창이 낮을 때 머리가 올라와
   면접관을 덮는다 — 낮아지면 더 잘리기만 해야 한다 */
.candidate {
  margin-top: calc(var(--sp-8) * -1);
  flex-shrink: 0;
}
</style>
