<script setup lang="ts">
/** 보관함 한 줄. 면접관 얼굴 하나와 메타 한 줄 — **점수는 없다**(리포트 파서가 내지 않는 값이다). */
import { computed } from 'vue'
import type { ArchiveEntry } from '@/services/account'
import { interviewerById, CENTER_FRAME_PX, DEFAULT_INTERVIEWER } from '@/interviewers'
import { FIELD_LABELS, type Field } from '@/stores/interview'
import { formatDuration } from '@/utils/timing'
import SpriteFrame from '@/components/ui/SpriteFrame.vue'

const props = defineProps<{ entry: ArchiveEntry }>()
defineEmits<{ open: [] }>()

/** 줄에서는 멈춘 얼굴 하나만. 여러 줄이 각자 애니메이션을 돌리면 목록이 어지럽다 */
const ROW_SCALE = 0.6

const iv = computed(
  () => interviewerById(props.entry.interviewerId) ?? interviewerById(DEFAULT_INTERVIEWER)!,
)
const when = computed(() => {
  const d = new Date(props.entry.startedAt)
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`
})
const took = computed(() =>
  formatDuration(
    Math.max(
      0,
      new Date(props.entry.endedAt).getTime() - new Date(props.entry.startedAt).getTime(),
    ),
  ),
)
/** 트랙이 보는 칸만 적는다 — 회사는 분야·직무, 대입은 대학·학과 */
const subject = computed(() => {
  const e = props.entry
  if (e.track === 'company')
    return [e.field ? FIELD_LABELS[e.field as Field] : null, e.job].filter(Boolean).join(' · ')
  return [e.university, e.department].filter(Boolean).join(' · ')
})
</script>

<template>
  <button type="button" class="row press" data-test="archive-row" @click="$emit('open')">
    <SpriteFrame
      :src="iv.sprites.idle.file"
      :frame-w="CENTER_FRAME_PX"
      :frame-h="CENTER_FRAME_PX"
      :frames="iv.sprites.idle.frames"
      :scale="ROW_SCALE"
    />
    <span class="mid">
      <span class="top">
        <span class="nm">{{ iv.displayName }}</span>
        <span class="mono trk">{{ entry.track === 'company' ? '회사' : '대입' }}</span>
        <span v-if="entry.premium" class="mono p" data-test="row-premium">★ 프리미엄</span>
      </span>
      <span class="mono meta">
        {{ when }} · {{ took }} · 질문 {{ entry.questionCount }}개<template v-if="subject">
          · {{ subject }}</template
        ><template v-if="entry.hasRecording"> · 녹음</template>
      </span>
    </span>
    <span class="go" aria-hidden="true">›</span>
  </button>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  width: 100%;
  text-align: left;
  background: none;
  border: 2px solid var(--raise);
  padding: var(--sp-2) var(--sp-4);
  cursor: pointer;
  color: var(--text);
}
.row:hover,
.row:focus-visible {
  border-color: var(--line);
}
.mid {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  flex: 1;
  min-width: 0;
}
.top {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.nm {
  font-size: var(--fs-body-sm);
}
.trk,
.meta {
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.p {
  font-size: var(--fs-meta);
  color: var(--accent);
}
.go {
  color: var(--text-3);
  font-size: var(--fs-h3);
}
</style>
