<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FIELD_LABELS, useInterviewStore } from '@/stores/interview'
import { reportHeader, reportToText } from '@/utils/reportParser'
import { itemsInOrder, reportV2ToText } from '@/utils/reportV2'
import { formatDuration, totalDuration, turnDurations } from '@/utils/timing'
import { answersForReport, matchQuestions } from '@/utils/reportAnswers'
import PixelWindow from '@/components/ui/PixelWindow.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import ReportCards from '@/components/report/ReportCards.vue'
import ReportV2Cards from '@/components/report/ReportV2Cards.vue'
import ReportRail, { type TocItem } from '@/components/report/ReportRail.vue'
import { useAccountStore } from '@/stores/account'
import { useModalStore } from '@/stores/modal'
import { ARCHIVE_LIMIT } from '@/utils/archive'

const s = useInterviewStore()
const acc = useAccountStore()
const modal = useModalStore()
const fieldLabel = computed(() => (s.profile.field ? FIELD_LABELS[s.profile.field] : ''))
const modelTurns = computed(() => s.messages.filter((m) => m.role === 'model').length)
const nQ = computed(() => s.report?.length ?? 0)
const nFollow = computed(() => Math.max(0, modelTurns.value - nQ.value))
/* 카드의 답변은 모델 요약(answerSummary)이 아니라 지원자가 입력한 원문 — 대화 기록에서 짝짓는다 */
const answers = computed(() => (s.report ? answersForReport(s.report, s.messages) : []))

const total = computed(() => totalDuration(s.startedAt, s.endedAt))
// 자연 종료(ended)면 마지막 모델 턴은 항상 인사말(store.send()가 ended 이후 거부)이라
// endAt을 주지 않아 표에서 제외한다. 진행 중 종료면 답 없는 마지막 질문이니 endedAt까지 센다.
const turns = computed(() => turnDurations(s.messages, s.ended ? null : s.endedAt))
/* 60초 제한: 시간은 카드에 흩어놓지 않고 "시간" 창 한 곳에만 모은다 (초과 문항 수 + 행마다 초과분) */
const timing = computed(() =>
  total.value > 0 || turns.value.length ? { total: total.value, turns: turns.value } : undefined,
)

/** 목차 한 줄씩. 벤(v2)은 제 id를, 무료는 Q번호를 쓴다.
 *  무료 리포트는 꼬리질문을 카드 하나에 합치므로 턴 수 ≠ 카드 수다 —
 *  카드 질문을 턴에 짝지어(answersForReport와 같은 짝) 그 사이 턴을 꼬리줄로 편다.
 *  꼬리줄은 제 카드와 같은 id를 가리킨다(앵커가 카드 하나뿐이라). */
const tocItems = computed<TocItem[]>(() => {
  if (s.reportV2) {
    return itemsInOrder(s.reportV2.items).map((it, i) => ({
      id: `item-${it.id}`,
      question: it.question,
      ms: turns.value[i]?.ms ?? null,
      follow: it.kind === 'follow',
    }))
  }
  if (!s.report) return []
  const starts = matchQuestions(
    s.report,
    turns.value.map((t) => t.question),
  )
  const rows: TocItem[] = []
  s.report.forEach((it, i) => {
    const from = starts[i]
    rows.push({
      id: `q${i + 1}`,
      question: it.question,
      ms: turns.value[from]?.ms ?? null,
      follow: false,
    })
    if (from < 0) return
    const next = starts.slice(i + 1).find((v) => v >= 0) ?? turns.value.length
    for (let k = from + 1; k < next; k++)
      rows.push({
        id: `q${i + 1}`,
        question: turns.value[k].question,
        ms: turns.value[k].ms,
        follow: true,
      })
  })
  return rows
})

/* 지금 보는 문항과 읽은 데까지 — IntersectionObserver로 정한다.
   scrollTop을 읽지 않는다(1번 철거에서 못 박은 원칙). 한 번 읽으면 지우지 않는다 */
const current = ref<string>()
const read = ref(new Set<string>())
const body = ref<HTMLElement | null>(null)
let io: IntersectionObserver | null = null
function watchCards() {
  io?.disconnect()
  if (typeof IntersectionObserver !== 'function' || !body.value) return
  io = new IntersectionObserver(
    (es) => {
      for (const e of es)
        if (e.isIntersecting) {
          const id = (e.target as HTMLElement).id
          current.value = id
          read.value = new Set(read.value).add(id)
        }
    },
    { rootMargin: `-${20}% 0px -60% 0px` },
  )
  for (const el of body.value.querySelectorAll('[id]')) io.observe(el)
}
onMounted(watchCards)
watch(tocItems, () => nextTick(watchCards))
onBeforeUnmount(() => io?.disconnect())

const copied = ref(false)
async function copy() {
  const text = s.reportV2
    ? reportV2ToText(s.reportV2, fieldLabel.value, s.profile.job)
    : s.report
      ? reportToText(s.report, answers.value, fieldLabel.value, s.profile.job, timing.value)
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
    <div class="cols">
      <ReportRail
        :items="tocItems"
        :summary="s.reportV2?.summary ?? null"
        :read="read"
        :current="current"
      >
        <template #head>
          <h1 class="display ttl">면접 리포트</h1>
          <p class="mono sub">
            {{ fieldLabel }} · {{ s.profile.job }} · 면접관: {{ s.sessionInterviewer.displayName }}
          </p>
          <p class="mono sub" data-test="counts">
            질문 {{ nQ }} · 꼬리질문 {{ nFollow
            }}<template v-if="total > 0"> · 총 {{ formatDuration(total) }}</template>
          </p>
          <p v-if="!s.archiveSaved" class="mono note">
            이 리포트는 이 화면에만 있습니다. 새로고침하면 사라집니다.
          </p>
        </template>
        <template #actions>
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
        </template>
      </ReportRail>

      <div ref="body" class="body">
        <!-- 보관 안내. 리포트가 다 나온 뒤에만 말한다 — 쓰는 중에 꺼내면 아직 거짓이다 -->
        <div v-if="s.reportStatus === 'done'" class="shelf mono">
          <p v-if="!acc.signedIn" data-test="save-cta">
            <span>로그인하면 이 리포트가 보관함에 남습니다.</span>
            <PixelButton variant="secondary" @click="modal.show('login')">로그인</PixelButton>
          </p>
          <p v-else-if="s.archiveSaved" class="ok" data-test="saved">보관함에 남겼습니다.</p>
          <p v-else data-test="save-failed">
            보관함에 남기지 못했습니다 — 이 리포트는 이 화면에만 있습니다.
          </p>
          <p v-if="s.archiveEvicted.length" class="gone" data-test="evicted">
            보관 한도({{ ARCHIVE_LIMIT }}개)를 넘어 가장 오래된 기록
            {{ s.archiveEvicted.length }}개가 사라졌습니다.
          </p>
        </div>

        <PixelWindow v-if="s.reportStatus === 'writing'" title="총평">
          <p class="mono">리포트를 쓰는 중…<span class="blink">▌</span></p>
        </PixelWindow>

        <PixelWindow v-else-if="s.reportStatus === 'error'" title="총평">
          <p class="mono err">리포트 생성에 실패했습니다. {{ s.genError }}</p>
          <PixelButton variant="secondary" @click="s.finish()">다시 시도</PixelButton>
        </PixelWindow>

        <ReportV2Cards v-else-if="s.reportV2" :report="s.reportV2" />
        <ReportCards v-else-if="s.report" :report="s.report" :answers="answers" />

        <PixelWindow v-else title="리포트 원문" data-test="raw">
          <pre class="mono raw">{{ s.reportRaw }}</pre>
        </PixelWindow>
      </div>
    </div>
  </main>
</template>

<style scoped>
/* 준비 화면과 같은 어법 — 왼쪽 기둥이 붙어 따라오고 오른쪽만 흐른다 (2026-11-07) */
.cols {
  display: flex;
  gap: var(--sp-6);
  align-items: flex-start;
}
.body {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-card);
}
.ttl {
  margin: 0;
  font-size: var(--fs-h2);
  color: var(--text);
}
.sub {
  margin: var(--sp-1) 0 0;
  font-size: var(--fs-meta);
  color: var(--text-3);
}
@media (max-width: 1024px) {
  .cols {
    flex-direction: column;
    align-items: stretch;
  }
}
.report {
  max-width: var(--content-w);
  margin: 0 auto;
  padding: var(--sp-8) var(--page-x) calc(var(--sp-14) + var(--hint-space, 0px));
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
}
.shelf {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  font-size: var(--fs-label);
}
.shelf p {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin: 0;
  color: var(--text-2);
}
.shelf .ok {
  color: var(--accent-2);
}
.shelf .gone {
  color: var(--text-3);
}
.note {
  color: var(--text-3);
  font-size: var(--fs-meta);
  margin: 0;
}
/* .danger를 쓰지 않는 이유: scoped 규칙이 자식(PixelTag) 루트의 tone 클래스에도 걸려 태그 글자색을 덮어쓴다 */
.err {
  color: var(--danger);
}
.raw {
  white-space: pre-wrap;
  margin: 0;
}
@media print {
  .report {
    max-width: none;
    padding: 0 var(--sp-4);
    gap: var(--sp-4);
  }
  /* 종이에는 두 기둥이 없다 — 머리글·총평 다음에 문항이 한 줄기로 이어진다 */
  .cols {
    display: block;
  }
  .note,
  .shelf {
    display: none;
  }
}
</style>
