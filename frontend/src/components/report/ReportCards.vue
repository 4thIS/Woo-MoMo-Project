<script setup lang="ts">
/** 리포트 본문 카드. 리포트 화면과 보관함 상세가 **같은 것**을 보여 준다 —
 *  두 벌을 만들면 둘이 어긋난다. 모양은 리포트 화면에 있던 그대로다. */
import { splitEmphasis, type ReportItem } from '@/utils/reportParser'
import PixelWindow from '@/components/ui/PixelWindow.vue'

defineProps<{
  report: ReportItem[]
  /** 문항별 답변 원문(꼬리질문 포함). 짧아도 되게 옵셔널 체이닝으로 읽는다 */
  answers: string[][]
}>()
</script>

<template>
  <PixelWindow
    v-for="(it, i) in report"
    :key="i"
    :title="`Q${i + 1}. ${it.question}`"
    data-test="card"
  >
    <dl class="kv">
      <dt class="mono">내 답변</dt>
      <dd class="answers" data-test="answers">
        <p v-for="(a, j) in answers[i]" :key="j">{{ a }}</p>
        <p v-if="!answers[i]?.length" class="none">(답변 없음)</p>
      </dd>
      <dt class="mono">피드백</dt>
      <dd>
        <template v-for="(p, j) in splitEmphasis(it.feedback)" :key="j">
          <span :class="{ strong: p.strong }">{{ p.text }}</span>
        </template>
      </dd>
      <!-- 벤이 녹음 측정을 받았을 때만. 숫자는 따로 깔지 않는다 — 서버에 남지 않아
           보관함에서 다시 열면 사라지고, 벤이 문장 안에 이미 근거로 적는다 (#99) -->
      <template v-if="it.delivery">
        <dt class="mono">전달력</dt>
        <dd data-test="delivery">{{ it.delivery }}</dd>
      </template>
    </dl>
  </PixelWindow>
</template>

<style scoped>
.kv {
  display: grid;
  grid-template-columns: 80px 1fr;
  gap: var(--sp-2) var(--sp-4);
  margin: 0;
}
.answers p {
  margin: 0;
  white-space: pre-wrap; /* 지원자가 친 줄바꿈 그대로 */
}
.answers p + p {
  margin-top: var(--sp-2);
  padding-top: var(--sp-2);
  border-top: 2px dashed var(--raise); /* 꼬리질문 답변 구분 */
}
.answers .none {
  color: var(--text-3);
}
.kv dt {
  color: var(--text-3);
}
.kv dd {
  margin: 0;
  line-height: 1.6;
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
