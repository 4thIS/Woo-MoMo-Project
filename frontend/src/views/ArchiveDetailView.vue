<script setup lang="ts">
/** 보관함 상세 — **리포트 화면과 같은 것**을 보여 준다 (2026-11-07 개편).
 *
 * 2열 모달을 버린 이유: 가독성이 나빴던 진짜 원인은 2열이 아니라 같은 내용을
 * 두 레이아웃으로 그리고 있다는 것이었다. 레일은 `ReportRail`을 그대로 쓴다 —
 * 두 벌을 만들면 리포트 화면과 조금씩 어긋난다.
 */
import { computed, ref } from 'vue'
import type { ArchiveDetail } from '@/services/account'
import ReportRail, { type TocItem } from '@/components/report/ReportRail.vue'
import ReportCards from '@/components/report/ReportCards.vue'
import ReportV2Cards from '@/components/report/ReportV2Cards.vue'
import PixelWindow from '@/components/ui/PixelWindow.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import PixelAudio from '@/components/ui/PixelAudio.vue'
import { answersForReport } from '@/utils/reportAnswers'
import { asReportV2, itemsInOrder } from '@/utils/reportV2'
import { useReadingToc } from '@/composables/useReadingToc'
import { clipsByCard } from '@/utils/archiveClips'
import { interviewerById, DEFAULT_INTERVIEWER } from '@/interviewers'
import { formatDuration } from '@/utils/timing'

const props = defineProps<{ entry: ArchiveDetail }>()
defineEmits<{ back: []; remove: [] }>()

type Tab = 'report' | 'transcript'
const tab = ref<Tab>('report')
/** 지울지 묻는 중. 기록은 되돌릴 수도, 다시 만들 수도 없어 한 번 더 묻는다 */
const asking = ref(false)
const body = ref<HTMLElement | null>(null)

/** 서버가 받은 그대로 돌려주므로 여기서 다시 모양을 본다 — 옛 기록에는 아예 없다 */
const reportV2 = computed(() => asReportV2(props.entry.reportV2))
const answers = computed(() => answersForReport(props.entry.report, props.entry.messages))
const iv = computed(
  () => interviewerById(props.entry.interviewerId) ?? interviewerById(DEFAULT_INTERVIEWER)!,
)
/** 제목 자리는 목록과 같다 — 찾을 때 기억하는 것이 거기 있어야 한다 */
const title = computed(() =>
  props.entry.track === 'company'
    ? (props.entry.job ?? '면접')
    : (props.entry.department ?? '면접'),
)
const when = computed(() =>
  new Date(props.entry.startedAt).toLocaleString('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }),
)
const took = computed(() =>
  formatDuration(
    Math.max(
      0,
      new Date(props.entry.endedAt).getTime() - new Date(props.entry.startedAt).getTime(),
    ),
  ),
)

/** 보관함 기록의 메시지에는 시각(at)이 없다 — 문항별 시간은 비워 둔다.
 *  `docs/API.md`의 보관함 응답에 생기면 그때 채운다 */
const tocItems = computed<TocItem[]>(() => {
  if (reportV2.value) {
    return itemsInOrder(reportV2.value.items).map((it) => ({
      id: `item-${it.id}`,
      question: it.question,
      ms: null,
      follow: it.kind === 'follow',
    }))
  }
  return props.entry.report.map((it, i) => ({
    id: `q${i + 1}`,
    question: it.question,
    ms: null,
    follow: false,
  }))
})

const { current, read } = useReadingToc(body, tocItems)

/** 카드마다 그 문항에 속한 녹음들. v2 리포트는 제 문항 목록으로 짝짓는다 */
const clips = computed(() =>
  clipsByCard(
    reportV2.value
      ? itemsInOrder(reportV2.value.items).map((it) => ({ question: it.question }))
      : props.entry.report,
    props.entry.messages,
    props.entry.recordings,
  ),
)

/** 이 메시지가 몇 번째 면접관 턴인가 — 대화 전문에서도 목차의 앵커가 살아 있게 한다 */
function anchorOf(i: number): string | undefined {
  if (props.entry.messages[i].role !== 'model') return undefined
  const n = props.entry.messages.slice(0, i + 1).filter((m) => m.role === 'model').length
  return `q${n}`
}

/** 리포트 화면과 같은 방식: Chrome "PDF로 저장" 대화상자.
 *  탭 제목이 기본 파일명이 되므로 잠깐 바꿨다가 afterprint에 되돌린다 */
function printReport() {
  const prev = document.title
  const d = new Date(props.entry.startedAt)
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  document.title = `모모_리포트_${ymd}_${iv.value.displayName}`
  window.addEventListener('afterprint', () => (document.title = prev), { once: true })
  window.print()
}
</script>

<template>
  <main class="report stars" data-test="archive-detail">
    <div class="cols">
      <ReportRail
        :items="tocItems"
        :summary="reportV2?.summary ?? null"
        :read="read"
        :current="current"
      >
        <template #head>
          <button type="button" class="mono link" data-test="archive-back" @click="$emit('back')">
            ← 보관함으로
          </button>
          <h1 class="display ttl">{{ title }}</h1>
          <p class="mono sub">{{ iv.displayName }} · {{ when }} · {{ took }}</p>
          <!-- 목차 위에 탭. .press를 붙이지 않는다 — 기본 그림자가 없어 hover에서만 튀어나온다 -->
          <div class="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              class="mono tab"
              :class="{ on: tab === 'report' }"
              :aria-selected="tab === 'report'"
              data-test="tab-report"
              @click="tab = 'report'"
            >
              리포트
            </button>
            <button
              type="button"
              role="tab"
              class="mono tab"
              :class="{ on: tab === 'transcript' }"
              :aria-selected="tab === 'transcript'"
              data-test="tab-transcript"
              @click="tab = 'transcript'"
            >
              대화 전문
            </button>
          </div>
        </template>

        <template #actions>
          <PixelButton variant="secondary" data-test="archive-print" @click="printReport">
            PDF로 저장
          </PixelButton>
          <template v-if="!asking">
            <PixelButton variant="secondary" data-test="archive-delete" @click="asking = true">
              지우기
            </PixelButton>
          </template>
          <template v-else>
            <span class="mono ask" data-test="archive-delete-ask">
              이 기록을 지울까요? 되돌릴 수 없습니다
            </span>
            <!-- 강조는 안전한 쪽에 준다 — 되돌릴 수 없는 쪽이 가장 눈에 띄면 안 된다 -->
            <PixelButton data-test="archive-delete-cancel" @click="asking = false">
              그대로 두기
            </PixelButton>
            <PixelButton
              variant="secondary"
              data-test="archive-delete-confirm"
              @click="$emit('remove')"
            >
              지우기
            </PixelButton>
          </template>
        </template>
      </ReportRail>

      <div ref="body" class="body">
        <template v-if="tab === 'report'">
          <ReportV2Cards v-if="reportV2" :report="reportV2">
            <template #foot="{ i }">
              <PixelAudio
                v-for="c in clips[i]"
                :key="c.url"
                class="clip"
                data-test="archive-clip"
                :src="c.url"
                :duration="c.durationSec ?? null"
                :label="`답변 ${c.turn + 1} 녹음`"
              />
            </template>
          </ReportV2Cards>
          <ReportCards v-else-if="entry.report.length" :report="entry.report" :answers="answers">
            <template #foot="{ i }">
              <PixelAudio
                v-for="c in clips[i]"
                :key="c.url"
                class="clip"
                data-test="archive-clip"
                :src="c.url"
                :duration="c.durationSec ?? null"
                :label="`답변 ${c.turn + 1} 녹음`"
              />
            </template>
          </ReportCards>
          <PixelWindow v-else title="리포트">
            <p class="mono none">리포트가 남지 않았습니다.</p>
          </PixelWindow>
        </template>

        <ol v-else class="log" data-test="transcript">
          <li v-for="(m, i) in entry.messages" :id="anchorOf(i)" :key="i" :class="m.role">
            <span class="mono who">{{ m.role === 'model' ? iv.displayName : '나' }}</span>
            <p class="read">{{ m.text }}</p>
          </li>
        </ol>
      </div>
    </div>
  </main>
</template>

<style scoped>
/* 레일·기둥 어법은 리포트 화면과 **같은 값**을 쓴다 — 어긋나면 "같은 화면"이 아니게 된다.
   폭만 다르다: 준비 화면과 같은 1280px이다(2026-11-08). 여기는 대화 전문 탭이 있어
   넓은 폭이 실제로 일하고, 리포트는 읽는 화면이라 --read-w가 본문 줄을 어차피 묶는다 */
.report {
  max-width: 1280px;
  margin: 0 auto;
  /* 좌우는 --page-x(120px)가 아니라 준비 화면과 같은 16px이다 — 120px씩 떼면
     1280px을 줘도 내용은 1040px로 되돌아가 넓힌 뜻이 없어진다 (2026-11-08) */
  padding: var(--sp-8) var(--sp-4) calc(var(--sp-14) + var(--hint-space, 0px));
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
}
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
  margin: var(--sp-2) 0 0;
  font-size: var(--fs-h2);
  color: var(--text);
}
.sub {
  margin: var(--sp-1) 0 0;
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
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}
.tab {
  padding: var(--sp-2) var(--sp-3);
  border: var(--win-border);
  background: none;
  color: var(--text-3);
  font-size: var(--fs-label);
  cursor: pointer;
}
.tab:hover:not(.on) {
  color: var(--text);
  border-color: var(--accent);
}
.tab.on {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg);
}
.ask {
  font-size: var(--fs-meta);
  color: var(--danger);
}
/* 대화 전문도 카드와 같은 읽기 꼴을 쓴다 */
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
  padding: var(--sp-4);
}
.log li.user {
  border-color: var(--line);
}
.who {
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.read {
  margin: var(--sp-1) 0 0;
  max-width: var(--read-w);
  font-family: var(--font-read);
  line-height: var(--lh-read);
  white-space: pre-wrap;
}
.none {
  color: var(--text-3);
}
.clip {
  width: 100%;
  margin-top: var(--sp-4);
}
@media (max-width: 1024px) {
  .cols {
    flex-direction: column;
    align-items: stretch;
  }
}
@media print {
  .report {
    max-width: none;
    padding: 0 var(--sp-4);
    gap: var(--sp-4);
  }
  /* 종이에는 두 기둥이 없다 — 머리글 다음에 문항이 한 줄기로 이어진다 */
  .cols {
    display: block;
  }
  .body {
    margin-top: var(--sp-4);
  }
  .link,
  .tabs,
  .clip {
    display: none;
  }
}
</style>
