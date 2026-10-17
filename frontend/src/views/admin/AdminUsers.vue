<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAdminStore } from '@/stores/admin'
import PixelButton from '@/components/ui/PixelButton.vue'
import PixelTag from '@/components/ui/PixelTag.vue'
import AdminUserDetail from './AdminUserDetail.vue'
import { fmtDate, fmtDateTime } from './format'

const admin = useAdminStore()
const q = ref(admin.query)
const pages = computed(() => {
  const u = admin.users
  return u ? Math.max(1, Math.ceil(u.total / u.pageSize)) : 1
})
const search = () => void admin.searchUsers(q.value.trim())
</script>

<template>
  <AdminUserDetail v-if="admin.detail" />
  <div v-else class="stack">
    <form class="search" role="search" @submit.prevent="search">
      <label class="mono" for="admin-q">사용자 검색</label>
      <input
        id="admin-q"
        v-model="q"
        type="search"
        maxlength="100"
        placeholder="이메일 또는 이름"
        data-test="admin-search-input"
      />
      <PixelButton variant="secondary" data-test="admin-search" @click="search">검색</PixelButton>
    </form>

    <p v-if="admin.error" class="err" role="alert" data-test="admin-error">{{ admin.error }}</p>
    <p v-if="!admin.users" class="mono muted">불러오는 중…</p>
    <template v-else>
      <p class="mono muted" data-test="admin-user-total">총 {{ admin.users.total }}명</p>
      <div class="scroll">
        <table class="atable">
          <thead>
            <tr>
              <th scope="col">이메일</th>
              <th scope="col">이름</th>
              <th scope="col">가입일</th>
              <th scope="col">티켓</th>
              <th scope="col">관리자</th>
              <th scope="col">보관</th>
              <th scope="col">벤</th>
              <th scope="col">마지막 활동</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in admin.users.items" :key="u.id" data-test="admin-user-row">
              <td>
                <button
                  type="button"
                  class="rowbtn"
                  data-test="admin-user-open"
                  @click="admin.openUser(u.id)"
                >
                  {{ u.email }}
                </button>
              </td>
              <td>{{ u.name ?? '—' }}</td>
              <td>{{ fmtDate(u.createdAt) }}</td>
              <td>{{ u.tickets }}</td>
              <td><PixelTag v-if="u.isAdmin">관리자</PixelTag></td>
              <td>{{ u.archiveCount }}</td>
              <td>{{ u.benCount }}</td>
              <td>{{ fmtDateTime(u.lastActiveAt) }}</td>
            </tr>
            <tr v-if="admin.users.items.length === 0">
              <td colspan="8" class="muted">결과 없음</td>
            </tr>
          </tbody>
        </table>
      </div>
      <nav class="pager" aria-label="페이지">
        <PixelButton
          variant="secondary"
          :disabled="admin.usersPage <= 1"
          data-test="admin-prev"
          @click="admin.goPage(admin.usersPage - 1)"
          >이전</PixelButton
        >
        <span class="mono" data-test="admin-page">{{ admin.usersPage }} / {{ pages }}</span>
        <PixelButton
          variant="secondary"
          :disabled="admin.usersPage >= pages"
          data-test="admin-next"
          @click="admin.goPage(admin.usersPage + 1)"
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
.search {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex-wrap: wrap;
}
.search label {
  font-size: var(--fs-label);
  color: var(--text-2);
}
.search input {
  flex: 1;
  min-width: 180px;
  padding: var(--sp-3);
  background: var(--bg);
  color: var(--text);
  border: 2px solid var(--line);
  font: inherit;
}
.rowbtn {
  background: none;
  border: none;
  color: var(--accent-2);
  cursor: pointer;
  font: inherit;
  padding: 0;
  text-align: left;
  text-decoration: underline;
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
