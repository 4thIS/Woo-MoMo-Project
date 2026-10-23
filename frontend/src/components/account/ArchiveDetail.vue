<script setup lang="ts">
/** 기록 상세 — 시안 B (좌우 2단) (spec 7.4).
 *
 * 왼쪽은 대화 전문, 오른쪽은 리포트. 리포트는 `ReportCards`를 그대로 쓴다 —
 * 두 벌을 만들면 리포트 화면과 어긋난다. **점수는 없다.**
 */
import { computed } from 'vue'
import type { ArchiveDetail } from '@/services/account'
import { interviewerById, DEFAULT_INTERVIEWER } from '@/interviewers'
import { FIELD_LABELS, type Field } from '@/stores/interview'
import { formatDuration } from '@/utils/timing'
import { answersForReport } from '@/utils/reportAnswers'
import ReportCards from '@/components/report/ReportCards.vue'
import ReportV2Cards from '@/components/report/ReportV2Cards.vue'
import { asReportV2 } from '@/utils/reportV2'
import PixelButton from '@/components/ui/PixelButton.vue'

const props = defineProps<{ entry: ArchiveDetail }>()
defineEmits<{ back: []; remove: [] }>()

/** 서버가 받은 그대로 돌려주므로 여기서 다시 모양을 본다 — 옛 기록에는 아예 없다 */
const reportV2 = computed(() => asReportV2(props.entry.reportV2))

const iv = computed(
  () => interviewerById(props.entry.interviewerId) ?? interviewerById(DEFAULT_INTERVIEWER)!,
)
const answers = computed(() => answersForReport(props.entry.report, props.entry.messages))
const took = computed(() =>
  formatDuration(
    Math.max(
      0,
      new Date(props.entry.endedAt).getTime() - new Date(props.entry.startedAt).getTime(),
    ),
  ),
)
const when = computed(() =>
  new Date(props.entry.startedAt).toLocaleString('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }),
)
const subject = computed(() => {
  const e = props.entry
  if (e.track === 'company')
    return [e.field ? FIELD_LABELS[e.field as Field] : null, e.job].filter(Boolean).join(' · ')
  return [e.university, e.department].filter(Boolean).join(' · ')
})
/** 답변 순번으로 녹음을 찾는다. 리포트 카드는 꼬리질문을 한 장에 합치므로
 *  카드 번호에는 맞출 수 없다 — 녹음은 **답변 옆**이 제 자리다 */
const clipOf = (turn: number) => props.entry.recordings.find((r) => r.turn === turn)
/** 이 메시지가 몇 번째 답변인가. 면접관 턴이면 -1 */
function answerIndex(i: number): number {
  if (props.entry.messages[i].role !== 'user') return -1
  return props.entry.messages.slice(0, i + 1).filter((m) => m.role === 'user').length - 1
}
</script>

<template>
  <div class="detail" data-test="archive-detail">
    <header class="head">
      <button type="button" class="mono link press" data-test="archive-back" @click="$emit('back')">
        ← 보관함
      </button>
      <span class="mono meta">
        {{ iv.displayName }} · {{ when }} · {{ took
        }}<template v-if="subject"> · {{ subject }}</template>
      </span>
      <PixelButton variant="secondary" data-test="archive-delete" @click="$emit('remove')"
        >지우기</PixelButton
      >
    </header>

    <div class="cols">
      <section class="pane">
        <h3 class="mono ttl">대화</h3>
        <ol class="log">
          <li v-for="(m, i) in entry.messages" :key="i" :class="m.role">
            <span class="mono who">{{ m.role === 'model' ? iv.displayName : '나' }}</span>
            <p>{{ m.text }}</p>
            <!-- 녹음이 없는 답변에는 줄을 그리지 않는다 — 빈 플레이어는 고장처럼 보인다 -->
            <audio
              v-if="clipOf(answerIndex(i))"
              class="clip"
              data-test="archive-clip"
              :src="clipOf(answerIndex(i))!.url"
              controls
              preload="none"
            />
          </li>
        </ol>
      </section>

      <section class="pane">
        <h3 class="mono ttl">리포트</h3>
        <ReportV2Cards v-if="reportV2" :report="reportV2" />
        <ReportCards v-else-if="entry.report.length" :report="entry.report" :answers="answers" />
        <p v-else class="mono none">리포트가 남지 않았습니다.</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
  min-height: 0;
}
.head {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
}
.head .meta {
  flex: 1;
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.link {
  font-size: var(--fs-label);
  color: var(--accent-2);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.cols {
  display: grid;
  grid-template-columns: 2fr 3fr;
  gap: var(--sp-5);
  min-height: 0;
}
.pane {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  /* 요금 카드와 같은 어법 — 높이를 묶어 작은 화면에서도 모달이 넘치지 않게 */
  max-height: clamp(280px, 56vh, 620px);
  overflow-y: auto;
  /* 스크롤바가 카드 오른쪽 테두리를 먹지 않게 */
  padding-right: var(--sp-3);
}
.ttl {
  margin: 0;
  font-size: var(--fs-label);
  color: var(--text-3);
}
.log {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.log li {
  border: 2px solid var(--raise);
  padding: var(--sp-3);
}
.log li.user {
  border-color: var(--line);
}
.who {
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.log p {
  margin: var(--sp-1) 0 0;
  white-space: pre-wrap;
  line-height: 1.6;
}
.none {
  color: var(--text-3);
}
.clip {
  width: 100%;
  margin-top: var(--sp-2);
}

@media (max-width: 760px) {
  .cols {
    grid-template-columns: 1fr;
  }
}
</style>
