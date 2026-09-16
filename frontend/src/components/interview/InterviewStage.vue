<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import SpriteFrame from '@/components/ui/SpriteFrame.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import PixelTag from '@/components/ui/PixelTag.vue'
import type { Stage } from '@/stores/interview'
import { formatClock } from '@/utils/timing'
import { ANIMS, CANDIDATE_BACK, FPS, SCALE, animsFor } from './interviewerAnims'

const props = defineProps<{
  stage: Stage
  bubble: string
  streaming: boolean
  reactPending: boolean
  watchTick: number
  fieldLabel: string
  job: string
  elapsedMs?: number
}>()
const emit = defineEmits<{ 'react-done': []; end: [] }>()

const reacting = ref(false)
const watching = ref(false)
// react와 watch는 독립된 1회 재생이므로 타이머를 따로 둔다. 하나로 합치면 서로의 종료를 지워
// 애니가 멈추거나 react-done이 영영 안 나간다.
const timers: Record<'react' | 'watch', ReturnType<typeof setTimeout> | null> = {
  react: null,
  watch: null,
}
function playOnce(kind: 'react' | 'watch') {
  const t = timers[kind]
  if (t) clearTimeout(t)
  const flag = kind === 'react' ? reacting : watching
  flag.value = true
  const frames = ANIMS[kind === 'react' ? 'center_react' : 'center_watch'].frames
  timers[kind] = setTimeout(
    () => {
      timers[kind] = null
      flag.value = false
      if (kind === 'react') emit('react-done')
    },
    (frames - 1) * (1000 / FPS),
  )
}
watch(
  () => props.reactPending,
  (v) => v && playOnce('react'),
)
watch(
  () => props.watchTick,
  (v) => v > 0 && playOnce('watch'),
)
onBeforeUnmount(() => {
  for (const t of Object.values(timers)) if (t) clearTimeout(t)
})

const anims = computed(() =>
  animsFor(props.stage, { react: reacting.value, watch: watching.value }),
)
const sheet = (name: keyof typeof ANIMS) => ANIMS[name]
</script>

<template>
  <section class="stage" aria-label="면접실">
    <div class="topbar">
      <div class="left">
        <PixelTag tone="muted">{{ fieldLabel }} · {{ job }}</PixelTag>
        <span class="mono clock" data-test="clock" aria-label="경과 시간">{{
          formatClock(elapsedMs ?? 0)
        }}</span>
      </div>
      <PixelButton variant="secondary" data-test="end" @click="emit('end')">면접 종료</PixelButton>
    </div>

    <div class="bubble mono" :class="{ streaming }" aria-live="polite">
      <span>{{ bubble || '…' }}</span
      ><span v-if="streaming" class="blink">▌</span>
    </div>

    <div class="row">
      <SpriteFrame
        :src="sheet(anims.left).file"
        :frame-w="32"
        :frame-h="32"
        :frames="sheet(anims.left).frames"
        :scale="SCALE"
        :fps="FPS"
      />
      <SpriteFrame
        :src="sheet(anims.center).file"
        :frame-w="32"
        :frame-h="32"
        :frames="sheet(anims.center).frames"
        :scale="SCALE"
        :fps="FPS"
      />
      <SpriteFrame
        :src="sheet(anims.clerk).file"
        :frame-w="32"
        :frame-h="32"
        :frames="sheet(anims.clerk).frames"
        :scale="SCALE"
        :fps="FPS"
      />
    </div>
    <div class="desk" />
    <div class="candidate">
      <SpriteFrame
        :src="CANDIDATE_BACK.file"
        :frame-w="CANDIDATE_BACK.w"
        :frame-h="CANDIDATE_BACK.h"
        :frames="1"
        :scale="SCALE"
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
.bubble {
  margin-top: 72px;
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
  margin-top: var(--sp-6);
}
.desk {
  width: 80%;
  height: 48px;
  margin-top: -8px;
  background: var(--raise);
  border-bottom: 4px solid var(--bg);
}
.candidate {
  position: absolute;
  bottom: -64px;
  left: 50%;
  transform: translateX(-50%);
}
</style>
