<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import SpriteFrame from '@/components/ui/SpriteFrame.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import PixelTag from '@/components/ui/PixelTag.vue'
import type { Stage } from '@/stores/interview'
import { ANIMS, CANDIDATE_BACK, FPS, SCALE, animsFor } from './interviewerAnims'

const props = defineProps<{
  stage: Stage
  bubble: string
  streaming: boolean
  reactPending: boolean
  watchTick: number
  fieldLabel: string
  job: string
}>()
const emit = defineEmits<{ 'react-done': []; end: [] }>()

const reacting = ref(false)
const watching = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null
function playOnce(kind: 'react' | 'watch') {
  if (timer) clearTimeout(timer)
  const flag = kind === 'react' ? reacting : watching
  flag.value = true
  const frames = ANIMS[kind === 'react' ? 'center_react' : 'center_watch'].frames
  timer = setTimeout(
    () => {
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
onBeforeUnmount(() => timer && clearTimeout(timer))

const anims = computed(() =>
  animsFor(props.stage, { react: reacting.value, watch: watching.value }),
)
const sheet = (name: keyof typeof ANIMS) => ANIMS[name]
</script>

<template>
  <section class="stage" aria-label="면접실">
    <div class="topbar">
      <PixelTag tone="muted">{{ fieldLabel }} · {{ job }}</PixelTag>
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
