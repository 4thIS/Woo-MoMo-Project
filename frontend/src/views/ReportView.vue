<script setup lang="ts">
import { computed, ref } from 'vue'
import { FIELD_LABELS, useInterviewStore } from '@/stores/interview'
import { reportHeader, reportToText, splitEmphasis } from '@/utils/reportParser'
import PixelWindow from '@/components/ui/PixelWindow.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import PixelTag from '@/components/ui/PixelTag.vue'

const s = useInterviewStore()
const fieldLabel = computed(() => (s.profile.field ? FIELD_LABELS[s.profile.field] : ''))
const modelTurns = computed(() => s.messages.filter((m) => m.role === 'model').length)
const nQ = computed(() => s.report?.length ?? 0)
const nFollow = computed(() => Math.max(0, modelTurns.value - nQ.value))

const copied = ref(false)
async function copy() {
  const text = s.report
    ? reportToText(s.report, fieldLabel.value, s.profile.job)
    : `${reportHeader(fieldLabel.value, s.profile.job)}\n\n${s.reportRaw}`
  await navigator.clipboard.writeText(text)
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}

/** Chrome "PDF로 저장" 대화상자. 탭 제목이 기본 파일명이 되므로 잠깐 바꿨다가 afterprint에 복원 */
function printReport() {
  const prev = document.title
  const d = new Date()
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  document.title = `모의면접 리포트 - ${s.profile.job} - ${ymd}`
  window.addEventListener('afterprint', () => (document.title = prev), { once: true })
  window.print()
}
</script>

<template>
  <main class="report stars rise">
    <header class="head">
      <h1 class="display">면접 리포트</h1>
      <div class="meta">
        <PixelTag tone="muted">{{ fieldLabel }} · {{ s.profile.job }}</PixelTag>
        <PixelTag v-if="s.reportStatus === 'done' && s.report" tone="muted"
          >질문 {{ nQ }} · 꼬리질문 {{ nFollow }}</PixelTag
        >
      </div>
      <p class="mono note">이 리포트는 이 화면에만 있습니다. 새로고침하면 사라집니다.</p>
      <div class="btns">
        <PixelButton
          variant="secondary"
          data-test="copy"
          :disabled="s.reportStatus !== 'done'"
          @click="copy"
          >{{ copied ? '복사됨' : '텍스트 복사' }}</PixelButton
        >
        <PixelButton
          variant="secondary"
          data-test="print"
          :disabled="s.reportStatus !== 'done'"
          @click="printReport"
          >PDF로 저장</PixelButton
        >
        <PixelButton data-test="restart" @click="s.reset()">다시 면접 보기</PixelButton>
      </div>
    </header>

    <PixelWindow v-if="s.reportStatus === 'writing'" title="총평">
      <p class="mono">리포트를 쓰는 중…<span class="blink">▌</span></p>
    </PixelWindow>

    <PixelWindow v-else-if="s.reportStatus === 'error'" title="총평">
      <p class="mono danger">리포트 생성에 실패했습니다. {{ s.genError }}</p>
      <PixelButton variant="secondary" @click="s.finish()">다시 시도</PixelButton>
    </PixelWindow>

    <template v-else-if="s.report">
      <PixelWindow
        v-for="(it, i) in s.report"
        :key="i"
        :title="`Q${i + 1}. ${it.question}`"
        data-test="card"
      >
        <dl class="kv">
          <dt class="mono">답변 요약</dt>
          <dd>{{ it.answerSummary }}</dd>
          <dt class="mono">피드백</dt>
          <dd>
            <template v-for="(p, j) in splitEmphasis(it.feedback)" :key="j">
              <span :class="{ strong: p.strong }">{{ p.text }}</span>
            </template>
          </dd>
        </dl>
      </PixelWindow>
    </template>

    <PixelWindow v-else title="리포트 원문" data-test="raw">
      <pre class="mono raw">{{ s.reportRaw }}</pre>
    </PixelWindow>

    <!-- 긴 리포트를 다 읽은 뒤를 위한 하단 버튼. 쓰는 중엔 상단과 중복이라 숨긴다 -->
    <div v-if="s.reportStatus === 'done'" class="btns bottom">
      <PixelButton variant="secondary" :disabled="s.reportStatus !== 'done'" @click="copy">{{
        copied ? '복사됨' : '텍스트 복사'
      }}</PixelButton>
      <PixelButton variant="secondary" :disabled="s.reportStatus !== 'done'" @click="printReport"
        >PDF로 저장</PixelButton
      >
      <PixelButton @click="s.reset()">다시 면접 보기</PixelButton>
    </div>
  </main>
</template>

<style scoped>
.report {
  max-width: var(--content-w);
  margin: 0 auto;
  padding: var(--sp-8) var(--page-x) var(--sp-14);
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
}
.head {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.meta,
.btns {
  display: flex;
  gap: var(--sp-3);
}
.btns.bottom {
  justify-content: center;
}
.note {
  color: var(--text-3);
  font-size: var(--fs-meta);
  margin: 0;
}
.kv {
  display: grid;
  grid-template-columns: 80px 1fr;
  gap: var(--sp-2) var(--sp-4);
  margin: 0;
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
.danger {
  color: var(--danger);
}
.raw {
  white-space: pre-wrap;
  margin: 0;
}

@media print {
  .report {
    max-width: none;
    padding: 0;
    gap: var(--sp-4);
  }
  .btns,
  .note {
    display: none;
  }
  .head h1 {
    font-size: var(--fs-h2);
  }
  .strong {
    font-weight: 700;
    text-decoration: underline;
  }
  /* 카드가 페이지 중간에서 잘리지 않게 */
  .report > * {
    break-inside: avoid;
  }
}
</style>
