<script setup lang="ts">
/** 관리자 대시보드 (`/admin`). 관리자가 아니면 아무것도 읽지 않는다. */
import { computed, onMounted, ref, watch } from 'vue'
import { useAccountStore } from '@/stores/account'
import { useAdminStore, type AdminTab } from '@/stores/admin'
import PixelWindow from '@/components/ui/PixelWindow.vue'
import AdminOverview from './AdminOverview.vue'
import AdminUsers from './AdminUsers.vue'
import AdminUsage from './AdminUsage.vue'
import AdminAudit from './AdminAudit.vue'

const account = useAccountStore()
const admin = useAdminStore()

/** 세션을 한 번 읽어 보기 전에는 판단하지 않는다. load()는 TopBar와 겹쳐도 한 번만 읽는다 */
const checked = ref(false)
const allowed = computed(() => account.session?.isAdmin === true)
/** 연결 문제로 세션을 못 읽은 것과 관리자가 아닌 것을 구분한다 */
const connectionFailed = computed(
  () => account.session === null && account.error?.code === 'network',
)

const TABS: { id: AdminTab; label: string }[] = [
  { id: 'overview', label: '개요' },
  { id: 'users', label: '사용자' },
  { id: 'usage', label: '비용' },
  { id: 'audit', label: '감사 로그' },
]
const COMPONENTS = {
  overview: AdminOverview,
  users: AdminUsers,
  usage: AdminUsage,
  audit: AdminAudit,
}

onMounted(async () => {
  await account.load()
  checked.value = true
})
watch(
  () => checked.value && allowed.value,
  (ok) => {
    if (ok) void admin.loadTab('overview')
  },
  { immediate: true },
)
</script>

<template>
  <main class="admin">
    <p v-if="!checked" class="mono" data-test="admin-checking">확인 중…</p>
    <PixelWindow v-else-if="connectionFailed" title="관리자">
      <p role="alert" data-test="admin-connection-error">
        연결하지 못했습니다 — 잠시 뒤 다시 시도해 주세요
      </p>
      <a class="mono" href="/">모모로 돌아가기</a>
    </PixelWindow>
    <PixelWindow v-else-if="!allowed" title="관리자">
      <p data-test="admin-denied">관리자만 볼 수 있습니다</p>
      <a class="mono" href="/">모모로 돌아가기</a>
    </PixelWindow>
    <PixelWindow v-else title="관리자 대시보드">
      <div class="tabs" role="tablist" aria-label="관리자 메뉴">
        <button
          v-for="t in TABS"
          :id="`admin-tab-${t.id}`"
          :key="t.id"
          type="button"
          role="tab"
          class="mono tab"
          :class="{ on: admin.tab === t.id }"
          :aria-selected="admin.tab === t.id"
          aria-controls="admin-panel"
          :data-test="`admin-tab-${t.id}`"
          @click="admin.loadTab(t.id)"
        >
          {{ t.label }}
        </button>
      </div>
      <div id="admin-panel" role="tabpanel" :aria-labelledby="`admin-tab-${admin.tab}`">
        <component :is="COMPONENTS[admin.tab]" />
      </div>
    </PixelWindow>
  </main>
</template>

<style>
.admin {
  max-width: var(--content-w);
  margin: 0 auto;
  padding: 72px var(--sp-6) var(--sp-10);
  color: var(--text);
}
.admin .tabs {
  display: flex;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.admin .tab {
  padding: var(--sp-2) var(--sp-5);
  background: none;
  color: var(--text-2);
  border: 2px solid var(--line);
  cursor: pointer;
}
.admin .tab.on {
  color: var(--bg);
  background: var(--accent);
  border-color: var(--accent);
}
.admin .atable {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-body-sm);
}
.admin .atable th,
.admin .atable td {
  text-align: left;
  padding: var(--sp-2) var(--sp-3);
  border-bottom: var(--rule);
  white-space: nowrap;
}
.admin .atable th {
  color: var(--text-3);
  font-weight: normal;
  font-size: var(--fs-meta);
}
</style>
