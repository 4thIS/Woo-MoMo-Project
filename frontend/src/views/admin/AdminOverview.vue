<script setup lang="ts">
import { computed } from 'vue'
import { useAdminStore } from '@/stores/admin'
import BarChart from './BarChart.vue'
import { fmtInt, fmtMB } from './format'

const admin = useAdminStore()
const o = computed(() => admin.overview)
const cards = computed(() => {
  const v = o.value
  if (!v) return []
  return [
    ['가입자 전체', fmtInt(v.users.total)],
    ['최근 7일 가입', fmtInt(v.users.last7Days)],
    ['최근 30일 가입', fmtInt(v.users.last30Days)],
    ['티켓 보유 사용자', fmtInt(v.users.withTickets)],
    ['남은 티켓 합', fmtInt(v.tickets.outstanding)],
    ['오늘 벤 면접', `${v.ben.today} / ${v.ben.dailyLimit}`],
    ['보관 기록', fmtInt(v.archive.entries)],
    ['보관 중 벤 기록', fmtInt(v.archive.ben)],
    ['녹음', `${fmtInt(v.recordings.count)}개 · ${fmtMB(v.recordings.bytes)} MB`],
    ['브리핑 캐시', fmtInt(v.briefings.cached)],
  ] as [string, string][]
})
const days = computed(() =>
  (o.value?.ben.byDay ?? []).map((d) => ({ label: d.date, value: d.count })),
)
</script>

<template>
  <p v-if="admin.error && !o" class="err" role="alert" data-test="admin-error">
    {{ admin.error }}
  </p>
  <p v-else-if="!o" class="mono muted" data-test="admin-loading">불러오는 중…</p>
  <div v-else class="stack">
    <p v-if="o.weakEmergencyPassword" class="warn" role="alert" data-test="admin-weak-password">
      비상용 관리자 비밀번호가 12자 미만입니다 — 운영 전에 바꿔 주세요
    </p>
    <dl class="cards">
      <div v-for="[label, value] in cards" :key="label" class="card" data-test="admin-card">
        <dt class="mono">{{ label }}</dt>
        <dd>{{ value }}</dd>
      </div>
    </dl>
    <section>
      <h3 class="display h3">최근 30일 벤 면접</h3>
      <BarChart :items="days" title="일별 벤 면접 수" />
    </section>
  </div>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
}
.warn {
  margin: 0;
  padding: var(--sp-3) var(--sp-4);
  border: 2px solid var(--danger);
  color: var(--danger);
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 2px;
  margin: 0;
  background: var(--raise);
}
.card {
  background: var(--bg);
  padding: var(--sp-4) var(--sp-5);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
dt {
  font-size: var(--fs-meta);
  color: var(--text-3);
}
dd {
  margin: 0;
  font-size: 18px;
}
.h3 {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-body);
}
.err {
  margin: 0;
  color: var(--danger);
}
.muted {
  color: var(--text-3);
}
</style>
