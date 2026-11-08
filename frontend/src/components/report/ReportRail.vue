<script setup lang="ts">
/** 리포트 왼쪽 기둥 — 머리글 · 총평 · 문항 목차 · 액션 (2026-11-07).
 *
 * 리포트 화면과 **보관함 상세가 같은 것**을 쓴다. 둘이 다른 것은 머리글과 액션뿐이라
 * 그 둘만 슬롯으로 열어 둔다.
 *
 * 목차는 진짜 `<a href="#q4">`다 — Tab 차례·우클릭·새 탭으로 열기가 거저 따라온다.
 * 다만 **클릭은 가로챈다**: 해시 이동(fragment navigation)이 `popstate`를 쏘는데,
 * 보관함 상세가 그것을 듣고 화면을 닫기 때문이다 (2026-11-08).
 * 부드러운 스크롤은 쓰지 않는다(16문항 거리에서 멀미).
 */
import { computed, nextTick, ref, watch } from 'vue'
import { formatDuration, overBy } from '@/utils/timing'
import { scrollToId } from '@/utils/anchorScroll'
import type { ReportV2Summary } from '@/utils/reportV2'

export interface TocItem {
  id: string
  question: string
  /** 걸린 시간(ms). 모르면 null */
  ms: number | null
  follow: boolean
}

const props = defineProps<{
  items: TocItem[]
  /** 무료 리포트에는 총평이 없다 */
  summary: ReportV2Summary | null
  /** 지금 보고 있는 항목 */
  current?: string
}>()

/** 카드 하나에 한 자리. 꼬리줄은 제 카드와 id를 나눠 쓰므로 앞뒤로 오갈 때는 한 번만 센다 */
const stops = computed(() => [...new Set(props.items.map((i) => i.id))])
const at = computed(() => stops.value.indexOf(props.current ?? ''))
const hasPrev = computed(() => at.value > 0)
const hasNext = computed(() => at.value < stops.value.length - 1)
/* 목록은 제 안에서 스크롤된다(16문항이면 다 안 들어간다). 본문을 내려 Q12를 보고 있는데
   목차가 Q1~Q8에 머물러 있으면 지금 자리를 칠해 봐야 화면에 없다 — 따라오게 한다.
   `block: 'nearest'`라 이미 보이는 줄에서는 아무 데도 움직이지 않는다 (2026-11-08) */
const rows = ref<HTMLElement[]>([])
watch(
  () => props.current,
  async (id) => {
    if (!id) return
    await nextTick()
    rows.value[props.items.findIndex((it) => it.id === id)]?.scrollIntoView({ block: 'nearest' })
  },
)

/** 앞뒤로 한 칸. 아직 아무 데도 없으면 다음은 첫 문항으로 간다 */
function go(by: -1 | 1) {
  const i = at.value < 0 ? (by > 0 ? 0 : stops.value.length - 1) : at.value + by
  const id = stops.value[i]
  if (id) scrollToId(id)
}

const overCount = computed(
  () => props.items.filter((i) => i.ms !== null && overBy(i.ms) > 0).length,
)
</script>

<template>
  <aside class="rail" data-test="report-rail">
    <div class="head">
      <slot name="head" />
    </div>

    <!-- 긴 리포트에서는 접어 목차에 자리를 내준다 -->
    <details v-if="summary" class="sum" open data-test="rail-summary">
      <summary class="mono">총평</summary>
      <div class="sum-body">
        <template v-if="summary.strengths.length">
          <span class="mono lbl ok">잘한 것</span>
          <p v-for="(p, i) in summary.strengths" :key="`s${i}`" class="read">
            {{ p.point }}
            <span v-if="p.refs.length" class="mono refs">{{ p.refs.join(' ') }}</span>
          </p>
        </template>
        <template v-if="summary.improvements.length">
          <span class="mono lbl warn">고칠 것</span>
          <p v-for="(p, i) in summary.improvements" :key="`i${i}`" class="read">
            {{ p.point }}
            <span v-if="p.refs.length" class="mono refs">{{ p.refs.join(' ') }}</span>
          </p>
        </template>
        <template v-if="summary.delivery">
          <span class="mono lbl">전달력</span>
          <p class="read">{{ summary.delivery }}</p>
        </template>
        <template v-if="summary.postingFit">
          <span class="mono lbl">공고 적합도</span>
          <p class="read">
            <span v-if="summary.postingFit.met.length" class="ok">충족</span>
            {{ summary.postingFit.met.join(' · ') }}
            <span v-if="summary.postingFit.gaps.length" class="warn">부족</span>
            {{ summary.postingFit.gaps.join(' · ') }}
          </p>
        </template>
      </div>
    </details>

    <nav class="toc" aria-label="문항 목차">
      <div class="toc-head">
        <span class="mono lbl">문항</span>
        <span class="mono cnt" data-test="toc-count">{{ stops.length }}개</span>
        <span v-if="overCount" class="mono cnt over" data-test="toc-over">
          60초 초과 {{ overCount }}
        </span>
      </div>
      <ul class="list">
        <!-- key가 id가 아니라 자리인 이유: 무료 리포트의 꼬리줄은 제 카드와 id를 나눠 쓴다 -->
        <li v-for="(it, i) in items" :key="i">
          <a
            ref="rows"
            class="row"
            :class="{ follow: it.follow, on: current === it.id }"
            :href="`#${it.id}`"
            :aria-current="current === it.id ? 'true' : undefined"
            data-test="toc-item"
            @click.prevent="scrollToId(it.id)"
          >
            <!-- 읽음 네모는 **보는 것**이지 누르는 것이 아니었는데 체크박스처럼 보였다.
                 그 자리를 번호 칩이 받는다 — 본문 카드의 Q1과 짝이 맞는다 (2026-11-08) -->
            <span class="mono chip" data-test="toc-chip">{{
              it.follow ? '꼬리' : it.id.toUpperCase()
            }}</span>
            <span class="q">{{ it.question }}</span>
            <span v-if="it.ms !== null" class="mono t" :class="{ over: overBy(it.ms) > 0 }">{{
              formatDuration(it.ms)
            }}</span>
          </a>
        </li>
      </ul>

      <!-- 본문을 읽다가 목차를 보지 않고도 옮겨 다닌다 -->
      <div class="steps">
        <button
          type="button"
          class="mono step"
          :disabled="!hasPrev"
          data-test="toc-prev"
          @click="go(-1)"
        >
          ◀ 이전
        </button>
        <button
          type="button"
          class="mono step"
          :disabled="!hasNext"
          data-test="toc-next"
          @click="go(1)"
        >
          다음 ▶
        </button>
      </div>
    </nav>

    <div class="actions">
      <slot name="actions" />
    </div>
  </aside>
</template>

<style scoped>
.rail {
  flex: none;
  width: 336px;
  /* 전역 상단바 아래에 붙는다. height: 100vh는 쓰지 않는다(1번 철거 원칙) */
  position: sticky;
  top: calc(var(--topbar-h) + var(--sp-4));
  max-height: calc(100svh - var(--topbar-h) - var(--sp-8));
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.head,
.sum,
.toc,
.actions {
  border: var(--win-border);
  background: var(--win);
  box-shadow: 4px 4px 0 var(--ink);
}
.head {
  padding: var(--sp-4);
}
.sum {
  padding: var(--sp-3) var(--sp-4);
  border-color: var(--accent);
}
.sum > summary {
  font-size: var(--fs-label);
  color: var(--accent);
  cursor: pointer;
}
.sum-body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding-top: var(--sp-3);
}
.lbl {
  font-size: var(--fs-meta);
  letter-spacing: 0.1em;
  color: var(--text-3);
}
.lbl + .read {
  margin-bottom: var(--sp-2);
}
.read {
  margin: 0;
  font-family: var(--font-read);
  font-size: var(--fs-label);
  line-height: var(--lh-read);
  color: var(--text);
}
.refs {
  font-size: var(--fs-meta);
  color: var(--accent-2);
}
.ok {
  color: var(--ok);
}
.warn {
  color: var(--danger);
}
/* 본문을 읽다가 목차를 보지 않고도 옮겨 다니는 줄 */
.steps {
  flex: none;
  display: flex;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-4) 0;
  border-top: var(--rule);
  margin-top: var(--sp-2);
}
.step {
  flex: 1 1 0;
  min-height: 36px;
  background: none;
  border: 2px solid var(--raise);
  color: var(--text-2);
  font-size: var(--fs-meta);
  cursor: pointer;
}
.step:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.step:disabled {
  color: var(--raise);
  cursor: default;
}

/* 16줄이 넘치면 **목차 안에서만** 스크롤한다. 본문 스크롤과 분리된다.
   basis가 0이면 안 된다 — 높이가 내용에 맞는(auto) 기둥에서는 0으로 접혀 목록이 사라진다 */
.toc {
  flex: 0 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: var(--sp-3) 0;
}
.toc-head {
  flex: none;
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  padding: 0 var(--sp-4) var(--sp-2);
  border-bottom: var(--rule);
}
.toc-head .cnt {
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.toc-head .cnt.over {
  margin-left: auto;
  color: var(--danger);
}
.list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: var(--sp-1) 0;
}
/* 손가락이 쓰는 과녁은 44px이다 — 28px 줄은 누르기 어려웠다 (2026-11-08) */
.row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: 46px;
  padding: var(--sp-2) var(--sp-4);
  border-left: 4px solid transparent;
  font-size: var(--fs-label);
  color: var(--text-2);
  text-decoration: none;
}
.row:hover,
.row:focus-visible {
  background: var(--raise);
  color: var(--text);
}
.row.on {
  border-left-color: var(--accent);
  background: var(--raise);
  color: var(--text);
}
.row.follow {
  padding-left: var(--sp-8);
}
/* 번호 칩. 지금 보는 줄에서는 뒤집혀 과녁의 가운데를 알린다 */
.row .chip {
  flex: none;
  min-width: 38px;
  text-align: center;
  padding: 2px var(--sp-1);
  border: 2px solid var(--raise);
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.row.on .chip {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg);
}
.row.follow .chip {
  border-style: dashed;
}
.row .q {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row .t {
  flex: none;
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.row .t.over {
  color: var(--danger);
}
/* 좁은 기둥에 버튼 셋을 나란히 두면 글자가 세로로 쪼개진다 — 쌓는다 */
.actions {
  flex: none;
  padding: var(--sp-3);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.actions :deep(button) {
  width: 100%;
  white-space: nowrap;
}
/* 넓은 화면에서 기둥이 눕는 자리에서는 버튼도 한 줄로 돌아간다 */
@media (max-width: 1024px) {
  .actions {
    flex-direction: row;
    flex-wrap: wrap;
  }
  .actions :deep(button) {
    width: auto;
  }
}
/* 종이에는 고정 기둥이 설 자리가 없다 — 머리글과 총평만 남기고 한 줄기로 편다.
   목차는 종이에서 쓸모가 없고(앵커를 누를 수 없다) 액션은 더 그렇다 */
@media print {
  .rail {
    width: 100%;
    position: static;
    max-height: none;
  }
  .toc,
  .actions {
    display: none;
  }
  .head,
  .sum {
    box-shadow: none;
  }
}
/* 좁으면 기둥이 안 선다 — 위로 눕고 목차는 제 높이만큼만 */
@media (max-width: 1024px) {
  .rail {
    width: 100%;
    position: static;
    max-height: none;
  }
  .list {
    max-height: 40svh;
  }
}
</style>
