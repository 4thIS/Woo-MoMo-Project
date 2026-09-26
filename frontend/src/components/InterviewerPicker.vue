<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import SpriteFrame from '@/components/ui/SpriteFrame.vue'
import PixelTag from '@/components/ui/PixelTag.vue'
import { INTERVIEWERS, type InterviewerId } from '@/interviewers'
import { useInterviewerStore } from '@/stores/interviewer'
import { useModelStore } from '@/stores/model'

/**
 * 면접관 고르기(spec 3.1): 카드 클릭·키보드 선택 = 선택 + 포커스 + 미리 듣기(항상 재생).
 * 스피커 버튼·미리 듣기 음소거는 두지 않는다. 랜딩과 준비 화면 "바꾸기"에서 같이 쓴다.
 */
const iv = useInterviewerStore()
const model = useModelStore()
const cards = ref<HTMLButtonElement[]>([])
onMounted(() => void iv.probeSprites())

function pick(id: InterviewerId) {
  void model.chooseInterviewer(id)
  void iv.preview(id)
}
function onKey(e: KeyboardEvent) {
  const dir =
    e.key === 'ArrowRight' || e.key === 'ArrowDown'
      ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
        ? -1
        : 0
  if (!dir) return
  e.preventDefault()
  const n = INTERVIEWERS.length
  const i = INTERVIEWERS.findIndex((p) => p.id === iv.id)
  const j = i === -1 ? (dir > 0 ? 0 : n - 1) : (i + dir + n) % n
  pick(INTERVIEWERS[j].id)
  void nextTick(() => cards.value[j]?.focus())
}
const tabbable = (id: InterviewerId) => (iv.id === null ? id === INTERVIEWERS[0].id : iv.id === id)
const sheet = (id: InterviewerId) => {
  const s = iv.spritesFor(id)
  return iv.playingId === id ? s.question : s.idle
}
</script>

<template>
  <div class="picker-wrap">
    <div class="picker" role="radiogroup" aria-label="면접관 고르기" @keydown="onKey">
      <button
        v-for="p in INTERVIEWERS"
        :key="p.id"
        ref="cards"
        type="button"
        role="radio"
        class="card press"
        :class="{ selected: iv.id === p.id, dim: iv.id !== null && iv.id !== p.id }"
        :aria-checked="iv.id === p.id"
        :tabindex="tabbable(p.id) ? 0 : -1"
        :data-test="`interviewer-${p.id}`"
        @click="pick(p.id)"
      >
        <SpriteFrame
          :src="sheet(p.id).file"
          :frame-w="32"
          :frame-h="32"
          :frames="sheet(p.id).frames"
          :scale="4"
          :fps="8"
        />
        <span class="name">{{ p.name }}</span>
        <span class="tagline mono">{{ p.tagline }}</span>
        <PixelTag v-if="iv.id === p.id" tone="ok">선택됨</PixelTag>
      </button>
    </div>
    <p v-if="iv.previewFailed" class="mono err" data-test="preview-error">
      미리 듣기를 재생할 수 없습니다
    </p>
    <p class="mono note" data-test="ai-voice-preview">
      면접관 목소리는 AI로 합성한 목소리입니다 (Supertonic 3)
    </p>
  </div>
</template>

<style scoped>
.picker-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.picker {
  display: flex;
  justify-content: center;
  gap: var(--sp-5);
}
.card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-4);
  background: var(--raise);
  color: var(--text);
  border: 2px solid var(--line);
  --press-shadow: var(--raise);
  box-shadow: 4px 4px 0 var(--press-shadow);
  cursor: pointer;
  transition:
    transform 120ms steps(2),
    opacity 120ms steps(2);
}
.card.selected {
  border-color: var(--accent);
  transform: scale(1.08);
}
.card.dim {
  opacity: 0.55;
}
.name {
  font-size: var(--fs-label);
}
.tagline {
  font-size: var(--fs-meta);
  color: var(--text-2);
}
.err {
  margin: 0;
  color: var(--danger);
  font-size: var(--fs-meta);
}
.note {
  margin: 0;
  color: var(--text-3);
  font-size: var(--fs-meta);
}
</style>
