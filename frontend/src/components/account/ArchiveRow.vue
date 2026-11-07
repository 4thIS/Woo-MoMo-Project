<script setup lang="ts">
/** 보관함 한 줄 — **열로 세운다** (2026-11-07 개편).
 *
 * 전에는 `날짜 · 12분 34초 · 질문 5개 · 백엔드 개발자 · 녹음`이 가운뎃점으로 이어 붙어
 * 눈이 매번 줄 처음부터 읽어야 했다. 열로 세우면 세로로 훑어 비교된다.
 *
 * **지원 직무가 제목 자리다.** 같은 면접관으로 세 번 보면 날짜로만 갈리는데,
 * 찾을 때 기억하는 것은 "토스 백엔드 면접"이다. **점수는 없다**(리포트 파서가 내지 않는 값이다).
 */
import { computed } from 'vue'
import type { ArchiveEntry } from '@/services/account'
import { interviewerById, CENTER_FRAME_PX, DEFAULT_INTERVIEWER } from '@/interviewers'
import { FIELD_LABELS, type Field } from '@/stores/interview'
import { formatDuration } from '@/utils/timing'
import SpriteFrame from '@/components/ui/SpriteFrame.vue'

const props = defineProps<{ entry: ArchiveEntry }>()
defineEmits<{ open: [] }>()

/** 줄에서는 멈춘 얼굴 하나만. 시트가 92px이므로 1/2배(46px)가 픽셀이 정확히 2:1로 줄어 또렷하다.
 *  그 사이 값(0.6배)은 뭉갠다 */
const ROW_SCALE = 0.5

const iv = computed(
  () => interviewerById(props.entry.interviewerId) ?? interviewerById(DEFAULT_INTERVIEWER)!,
)
/** 목록에서는 짧게 — 같은 해가 대부분이라 연도는 자리만 먹는다 */
const when = computed(() => {
  const d = new Date(props.entry.startedAt)
  return `${d.getMonth() + 1}. ${d.getDate()}.`
})
const took = computed(() =>
  formatDuration(
    Math.max(
      0,
      new Date(props.entry.endedAt).getTime() - new Date(props.entry.startedAt).getTime(),
    ),
  ),
)
/** 제목 자리에 오는 말 */
const title = computed(() =>
  props.entry.track === 'company'
    ? (props.entry.job ?? '면접')
    : (props.entry.department ?? '면접'),
)
/** 제목 아래 작게 — 회사는 분야, 대입은 대학 */
const sub = computed(() =>
  props.entry.track === 'company'
    ? props.entry.field
      ? FIELD_LABELS[props.entry.field as Field]
      : ''
    : (props.entry.university ?? ''),
)
/** 좁은 화면에서는 면접관 열이 사라지므로 이 줄이 이름을 떠안는다.
 *  matchMedia로 글을 갈아 끼우지 않는다 — span 둘을 두고 CSS가 하나씩 감춘다 */
const subNarrow = computed(() => [sub.value, iv.value.displayName].filter(Boolean).join(' · '))
</script>

<template>
  <button type="button" class="row" data-test="archive-row" @click="$emit('open')">
    <SpriteFrame
      class="face"
      :src="iv.sprites.idle.file"
      :frame-w="CENTER_FRAME_PX"
      :frame-h="CENTER_FRAME_PX"
      :frames="iv.sprites.idle.frames"
      :scale="ROW_SCALE"
    />
    <span class="who">
      <span class="nm">{{ iv.displayName }}</span>
      <!-- 녹음·프리미엄은 표식이다. 문장에 끼워 넣으면 줄이 또 길어진다 -->
      <span v-if="entry.premium" class="mono mk p" data-test="row-premium">★</span>
      <span v-if="entry.hasRecording" class="mono mk" data-test="row-rec">녹음</span>
    </span>
    <span class="mono trk">{{ entry.track === 'company' ? '회사' : '대입' }}</span>
    <span class="subject" data-test="row-subject">
      <span class="ttl">{{ title }}</span>
      <span v-if="sub" class="mono sub wide">{{ sub }}</span>
      <span class="mono sub narrow">{{ subNarrow }}</span>
    </span>
    <span class="mono num" data-test="row-count">{{ entry.questionCount }}문항</span>
    <span class="mono num" data-test="row-took">{{ took }}</span>
    <span class="mono num" data-test="row-when">{{ when }}</span>
  </button>
</template>

<style scoped>
.row {
  display: grid;
  grid-template-columns: auto minmax(104px, auto) auto 1fr auto auto auto;
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
  border-color: var(--accent);
}
.who {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}
.nm {
  font-size: var(--fs-body-sm);
}
.mk {
  font-size: var(--fs-meta);
  padding: 0 var(--sp-1);
  border: 2px solid var(--raise);
  color: var(--text-3);
}
.mk.p {
  border-color: var(--accent);
  color: var(--accent);
}
.subject {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.subject .ttl {
  font-size: var(--fs-body-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub,
.trk {
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.sub.narrow {
  display: none;
}
/* 숫자는 자릿수 고정 — 그래야 세로로 훑어 비교된다 */
.num {
  text-align: right;
  font-size: var(--fs-meta);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
/* 640px 아래에서는 열이 안 선다 — 두 줄로 돌아가되 지원 직무가 첫 줄이다 */
@media (max-width: 640px) {
  .row {
    grid-template-columns: auto 1fr;
    row-gap: var(--sp-1);
  }
  .who,
  .trk,
  .sub.wide {
    display: none;
  }
  .sub.narrow {
    display: inline;
  }
  .subject {
    grid-column: 2;
  }
  .num {
    grid-column: 2;
    text-align: left;
    display: inline;
  }
}
</style>
