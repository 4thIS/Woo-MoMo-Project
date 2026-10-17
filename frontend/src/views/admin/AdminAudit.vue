<script setup lang="ts">
import { computed } from 'vue'
import { useAdminStore } from '@/stores/admin'
import PixelButton from '@/components/ui/PixelButton.vue'
import { fmtDateTime } from './format'

const admin = useAdminStore()
const pages = computed(() => {
  const a = admin.audit
  return a ? Math.max(1, Math.ceil(a.total / a.pageSize)) : 1
})
</script>

<template>
  <div class="stack">
    <p v-if="admin.error" class="err" role="alert" data-test="admin-error">{{ admin.error }}</p>
    <p v-if="!admin.audit" class="mono muted">불러오는 중…</p>
    <template v-else>
      <div class="scroll">
        <table class="atable">
          <thead>
            <tr>
              <th scope="col">시각</th>
              <th scope="col">관리자</th>
              <th scope="col">동작</th>
              <th scope="col">대상</th>
              <th scope="col">수량</th>
              <th scope="col">사유</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in admin.audit.items" :key="i" data-test="admin-audit-row">
              <td>{{ fmtDateTime(r.at) }}</td>
              <td>{{ r.adminEmail }}</td>
              <td>{{ r.action }}</td>
              <td>{{ r.targetEmail }}</td>
              <td>{{ r.delta > 0 ? `+${r.delta}` : r.delta }}</td>
              <td>{{ r.reason }}</td>
            </tr>
            <tr v-if="admin.audit.items.length === 0">
              <td colspan="6" class="muted">기록 없음</td>
            </tr>
          </tbody>
        </table>
      </div>
      <nav class="pager" aria-label="페이지">
        <PixelButton
          variant="secondary"
          :disabled="admin.auditPage <= 1"
          data-test="admin-prev"
          @click="admin.goPage(admin.auditPage - 1)"
          >이전</PixelButton
        >
        <span class="mono" data-test="admin-page">{{ admin.auditPage }} / {{ pages }}</span>
        <PixelButton
          variant="secondary"
          :disabled="admin.auditPage >= pages"
          data-test="admin-next"
          @click="admin.goPage(admin.auditPage + 1)"
          >다음</PixelButton
        >
      </nav>
    </template>
  </div>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}
.pager {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
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
