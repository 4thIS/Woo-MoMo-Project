<script setup lang="ts">
import { computed } from 'vue'
import { useAdminStore } from '@/stores/admin'
import BarChart from './BarChart.vue'
import { fmtDate, fmtInt, fmtText, fmtUsd } from './format'

const admin = useAdminStore()
const u = computed(() => admin.usage)
const daily = computed(() =>
  (u.value?.byDay ?? []).map((d) => ({ label: d.date, value: d.costUsd })),
)
const KIND: Record<string, string> = { turn: '면접 턴', report: '리포트', research: '조사' }
const total = computed(() => (u.value?.byDay ?? []).reduce((s, d) => s + d.costUsd, 0))
</script>

<template>
  <div class="stack">
    <div class="range" role="group" aria-label="기간">
      <button
        v-for="d in [7, 30, 90]"
        :key="d"
        type="button"
        class="mono chip"
        :class="{ on: admin.usageDays === d }"
        :aria-pressed="admin.usageDays === d"
        :data-test="`admin-days-${d}`"
        @click="admin.setUsageDays(d)"
      >
        {{ d }}일
      </button>
    </div>
    <p v-if="admin.error" class="err" role="alert" data-test="admin-error">{{ admin.error }}</p>
    <p v-if="!u" class="mono muted">불러오는 중…</p>
    <template v-else>
      <p class="mono muted" data-test="admin-since">
        {{ u.since ? `기록 시작일 ${fmtDate(u.since)}` : '아직 기록이 없습니다' }} · 기간 합계
        {{ fmtUsd(total) }}
      </p>
      <section>
        <h3 class="display h3">일별 비용 (USD)</h3>
        <BarChart :items="daily" :format="fmtUsd" title="일별 비용" />
      </section>
      <section>
        <h3 class="display h3">종류별</h3>
        <table class="atable">
          <thead>
            <tr>
              <th scope="col">종류</th>
              <th scope="col">호출</th>
              <th scope="col">비용</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="k in u.byKind" :key="k.kind" data-test="admin-kind-row">
              <td>{{ KIND[k.kind] ?? k.kind }}</td>
              <td>{{ fmtInt(k.calls) }}</td>
              <td>{{ fmtUsd(k.costUsd) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section>
        <h3 class="display h3">비용 상위 면접</h3>
        <div class="scroll">
          <table class="atable">
            <thead>
              <tr>
                <th scope="col">면접</th>
                <th scope="col">사용자</th>
                <th scope="col">호출</th>
                <th scope="col">비용</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in u.topInterviews" :key="t.interviewId" data-test="admin-top-row">
                <td>{{ t.interviewId }}</td>
                <td>{{ fmtText(t.userEmail) }}</td>
                <td>{{ fmtInt(t.calls) }}</td>
                <td>{{ fmtUsd(t.costUsd) }}</td>
              </tr>
              <tr v-if="u.topInterviews.length === 0">
                <td colspan="4" class="muted">기록 없음</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h3 class="display h3">요금표 ({{ u.pricing.model }}, /100만 토큰)</h3>
        <table class="atable" data-test="admin-pricing">
          <tbody>
            <tr>
              <th scope="row">입력</th>
              <td>{{ fmtUsd(u.pricing.inputPerMTok) }}</td>
            </tr>
            <tr>
              <th scope="row">출력</th>
              <td>{{ fmtUsd(u.pricing.outputPerMTok) }}</td>
            </tr>
            <tr>
              <th scope="row">캐시 읽기</th>
              <td>{{ fmtUsd(u.pricing.cacheReadPerMTok) }}</td>
            </tr>
            <tr>
              <th scope="row">캐시 쓰기</th>
              <td>{{ fmtUsd(u.pricing.cacheWritePerMTok) }}</td>
            </tr>
            <tr>
              <th scope="row">웹 검색 (회)</th>
              <td>{{ fmtUsd(u.pricing.webSearch) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
}
.range {
  display: flex;
  gap: var(--sp-2);
}
.chip {
  padding: var(--sp-2) var(--sp-4);
  background: none;
  color: var(--text-2);
  border: 2px solid var(--line);
  cursor: pointer;
}
.chip.on {
  color: var(--bg);
  background: var(--accent-2);
  border-color: var(--accent-2);
}
.h3 {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-body);
}
.scroll {
  overflow-x: auto;
}
.err {
  margin: 0;
  color: var(--danger);
}
.muted {
  color: var(--text-3);
  margin: 0;
}
</style>
