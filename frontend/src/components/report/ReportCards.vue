<script setup lang="ts">
/** 리포트 본문 카드. 리포트 화면과 보관함 상세가 **같은 것**을 보여 준다 —
 *  두 벌을 만들면 둘이 어긋난다.
 *
 *  2026-11-07 개편: 라벨을 본문 **위**로 올려 본문이 폭을 다 쓰고, 질문이 제목 줄이 되며
 *  그 줄 오른쪽에 걸린 시간이 붙는다("시간" 창이 사라지는 자리). 읽는 글은 산세·줄간 1.8에
 *  한 줄 68자 상한. 강조는 **카드마다 하나**만 — 넷이 칠해지면 아무것도 강조되지 않는다.
 */
import { splitEmphasis, type ReportItem } from '@/utils/reportParser'
import { formatDuration } from '@/utils/timing'
import PixelWindow from '@/components/ui/PixelWindow.vue'

defineProps<{
  report: ReportItem[]
  /** 문항별 답변 원문(꼬리질문 포함). 짧아도 되게 옵셔널 체이닝으로 읽는다 */
  answers: string[][]
  /** 문항별 걸린 시간(ms). 안 넘기면 그 줄을 그리지 않는다 — 보관함은 아직 넘기지 않는다 */
  durations?: (number | null)[]
}>()

/** 가장 앞의 강조 하나만 남긴다 */
function firstEmphasis(raw: string) {
  let used = false
  return splitEmphasis(raw).map((p) => {
    if (!p.strong) return p
    if (used) return { ...p, strong: false }
    used = true
    return p
  })
}
</script>

<template>
  <PixelWindow v-for="(it, i) in report" :key="i" data-test="card">
    <div class="head" data-test="card-head">
      <span class="mono no">Q{{ i + 1 }}</span>
      <span class="display q">{{ it.question }}</span>
      <span v-if="durations?.[i] != null" class="mono t" data-test="card-time">
        {{ formatDuration(durations[i] as number) }}
      </span>
    </div>

    <div class="block">
      <span class="mono lbl">내 답변</span>
      <div class="answers" data-test="answers">
        <p v-for="(a, j) in answers[i]" :key="j" class="read">{{ a }}</p>
        <p v-if="!answers[i]?.length" class="read none">(답변 없음)</p>
      </div>
    </div>

    <div class="block">
      <span class="mono lbl">피드백</span>
      <p class="read dim">
        <template v-for="(p, j) in firstEmphasis(it.feedback)" :key="j">
          <span :class="{ strong: p.strong }">{{ p.text }}</span>
        </template>
      </p>
    </div>

    <!-- 벤이 녹음 측정을 받았을 때만. 숫자는 따로 깔지 않는다 — 서버에 남지 않아
         보관함에서 다시 열면 사라지고, 벤이 문장 안에 이미 근거로 적는다 (#99) -->
    <div v-if="it.delivery" class="block">
      <span class="mono lbl">전달력</span>
      <p class="read dim" data-test="delivery">{{ it.delivery }}</p>
    </div>
  </PixelWindow>
</template>

<style scoped>
/* 질문이 제목 줄이다. 시간은 그 줄 오른쪽 끝에 */
.head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-3);
  margin-bottom: var(--sp-4);
}
.head .no {
  flex: none;
  background: var(--accent);
  color: var(--bg);
  padding: 0 var(--sp-2);
}
.head .q {
  flex: 1 1 0;
  min-width: 0;
  font-size: var(--fs-h2);
  color: var(--text);
}
.head .t {
  flex: none;
  font-size: var(--fs-meta);
  color: var(--text-3);
}
/* 라벨은 본문 **위**에. 가로로 두면 본문 폭을 먹는다 */
.block {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.block + .block {
  margin-top: var(--sp-4);
}
.lbl {
  font-size: var(--fs-meta);
  color: var(--text-3);
  letter-spacing: 0.1em;
}
.read {
  margin: 0;
  max-width: var(--read-w);
  font-family: var(--font-read);
  line-height: var(--lh-read);
  white-space: pre-wrap; /* 지원자가 친 줄바꿈 그대로 */
}
.read.dim {
  color: var(--text-2);
}
.answers p + p {
  margin-top: var(--sp-3);
  padding-top: var(--sp-3);
  border-top: 2px dashed var(--raise); /* 꼬리질문 답변 구분 */
}
.answers .none {
  color: var(--text-3);
}
.strong {
  color: var(--accent);
}

@media print {
  .strong {
    font-weight: 700;
    text-decoration: underline;
  }
  /* 카드가 페이지 중간에서 잘리지 않게. 부모의 `.report > *`는 이제 이 조각들에 닿지 않는다 */
  [data-test='card'] {
    break-inside: avoid;
  }
}
</style>
