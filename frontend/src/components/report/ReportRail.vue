<script setup lang="ts">
/** 리포트 왼쪽 기둥 — 머리글 · 총평 · 문항 목차 · 액션 (2026-11-07).
 *
 * 리포트 화면과 **보관함 상세가 같은 것**을 쓴다. 둘이 다른 것은 머리글과 액션뿐이라
 * 그 둘만 슬롯으로 열어 둔다.
 *
 * 목차는 진짜 `<a href="#q4">`다 — Tab 차례와 브라우저 뒤로 가기가 거저 따라온다.
 * 직접 만든 클릭 핸들러로는 둘 다 안 된다. 부드러운 스크롤은 쓰지 않는다(16문항 거리에서 멀미).
 */
import { computed } from 'vue'
import { formatDuration, overBy } from '@/utils/timing'
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
  /** 읽은 항목 id. 한 번 들어오면 지우지 않는다 */
  read: Set<string>
  /** 지금 보고 있는 항목 */
  current?: string
}>()

const overCount = computed(
  () => props.items.filter((i) => i.ms !== null && overBy(i.ms) > 0).length,
)
const readCount = computed(() => props.items.filter((i) => props.read.has(i.id)).length)
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
        <span class="mono cnt" data-test="toc-read">
          읽음 {{ readCount }} / {{ items.length }}
        </span>
        <span v-if="overCount" class="mono cnt over" data-test="toc-over">
          60초 초과 {{ overCount }}
        </span>
      </div>
      <ul class="list">
        <!-- key가 id가 아니라 자리인 이유: 무료 리포트의 꼬리줄은 제 카드와 id를 나눠 쓴다 -->
        <li v-for="(it, i) in items" :key="i">
          <a
            class="row"
            :class="{ follow: it.follow, read: read.has(it.id), on: current === it.id }"
            :href="`#${it.id}`"
            :aria-current="current === it.id ? 'true' : undefined"
            data-test="toc-item"
          >
            <span class="mark" aria-hidden="true" />
            <!-- 꼬리줄은 제 카드와 같은 id라 번호를 숨긴다 — 두 번 적으면 같은 문항처럼 읽힌다 -->
            <span v-if="!it.follow" class="mono id">{{ it.id.toUpperCase() }}</span>
            <span class="q">{{ it.question }}</span>
            <span v-if="it.ms !== null" class="mono t" :class="{ over: overBy(it.ms) > 0 }">{{
              formatDuration(it.ms)
            }}</span>
          </a>
        </li>
      </ul>
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
/* 16줄이 넘치면 **목차 안에서만** 스크롤한다. 본문 스크롤과 분리된다 */
.toc {
  flex: 1 1 0;
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
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: var(--sp-1) 0;
}
.row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-1) var(--sp-4);
  border-left: 3px solid transparent;
  font-size: var(--fs-label);
  color: var(--text-2);
  text-decoration: none;
}
.row:hover,
.row:focus-visible {
  color: var(--accent);
}
.row.on {
  border-left-color: var(--accent);
  background: var(--raise);
  color: var(--text);
}
.row.follow {
  padding-left: var(--sp-10);
}
.row .mark {
  flex: none;
  width: 8px;
  height: 8px;
  border: 2px solid var(--off);
}
.row.read .mark {
  background: var(--ok);
  border-color: var(--ok);
}
.row.read .q {
  color: var(--text-3);
}
.row .id {
  flex: none;
  font-size: var(--fs-meta);
  color: var(--text-3);
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
.actions {
  flex: none;
  padding: var(--sp-3);
  display: flex;
  gap: var(--sp-2);
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
