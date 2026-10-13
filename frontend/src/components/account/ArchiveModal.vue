<script setup lang="ts">
/** 보관함 — 시안 C (탭) (spec 7.4).
 *
 * 상세는 **같은 모달 안에서** 갈아 낀다. 모달을 쌓으면 Esc가 어디를 닫는지 흐려진다.
 */
import { computed, ref, watch } from 'vue'
import { useAccountStore } from '@/stores/account'
import type { ArchiveDetail as Detail } from '@/services/account'
import { ARCHIVE_LIMIT, freeEntries, premiumEntries } from '@/utils/archive'
import PixelModal from '@/components/ui/PixelModal.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import ArchiveRow from './ArchiveRow.vue'
import ArchiveDetail from './ArchiveDetail.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; 'need-premium': [] }>()

const account = useAccountStore()

type Tab = 'all' | 'free' | 'premium'
const tab = ref<Tab>('all')
/** null이면 목록. 상세를 들고 있으면 상세 */
const detail = ref<Detail | null>(null)

const free = computed(() => freeEntries(account.archive))
const premium = computed(() => premiumEntries(account.archive))
const shown = computed(() =>
  tab.value === 'free' ? free.value : tab.value === 'premium' ? premium.value : account.archive,
)

watch(
  () => props.open,
  (on) => {
    // 열 때마다 목록부터. 지난번에 보던 상세가 남아 있으면 엉뚱한 기록이 먼저 보인다
    if (!on) return
    tab.value = 'all'
    detail.value = null
    void account.refreshArchive()
  },
  { immediate: true },
)

async function openDetail(id: string) {
  detail.value = await account.getArchive(id)
}

async function remove() {
  const id = detail.value?.id
  if (!id) return
  detail.value = null
  await account.deleteArchive(id)
}
</script>

<template>
  <PixelModal :open="open" title="보관함" width="wide" @close="emit('close')">
    <ArchiveDetail v-if="detail" :entry="detail" @back="detail = null" @remove="remove()" />

    <template v-else>
      <div class="tabs">
        <button
          v-for="t in ['all', 'free', 'premium'] as Tab[]"
          :key="t"
          type="button"
          class="mono tab"
          :class="{ on: tab === t }"
          data-test="archive-tab"
          @click="tab = t"
        >
          <template v-if="t === 'all'">전체 {{ account.archive.length }}</template>
          <template v-else-if="t === 'free'">일반 {{ free.length }}/{{ ARCHIVE_LIMIT }}</template>
          <template v-else>★ 프리미엄 {{ premium.length }}</template>
        </button>
      </div>

      <div class="pane">
        <p v-if="account.archiveFull" class="mono warn" data-test="archive-full">
          일반 기록이 {{ ARCHIVE_LIMIT }}개로 찼습니다 — 다음 면접을 마치면 가장 오래된 하나가
          사라집니다.
        </p>

        <ArchiveRow v-for="e in shown" :key="e.id" :entry="e" @open="openDetail(e.id)" />

        <!-- 프리미엄 탭은 비어도 숨기지 않는다. 비어 있는 자리가 가장 좋은 권유 자리다 -->
        <div v-if="!shown.length && tab === 'premium'" class="cta" data-test="premium-cta">
          <p class="mono">벤과 본 면접은 보관 한도에 들어가지 않고, 녹음까지 함께 남습니다.</p>
          <PixelButton @click="emit('need-premium')">모모 프리미엄 보기</PixelButton>
        </div>
        <p v-else-if="!shown.length" class="mono none" data-test="archive-empty">
          아직 남은 면접이 없습니다. 면접을 마치면 여기에 쌓입니다.
        </p>
      </div>
    </template>
  </PixelModal>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 0;
}
.tab {
  font-size: var(--fs-label);
  color: var(--text-3);
  background: none;
  border: 2px solid var(--raise);
  border-bottom-width: 0;
  padding: var(--sp-3) var(--sp-5);
  cursor: pointer;
}
.tab.on {
  color: var(--accent);
  border-color: var(--line);
}
.pane {
  border: 2px solid var(--line);
  padding: var(--sp-5);
  margin-top: -2px;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  /* 요금 카드와 같은 어법 — 높이를 묶어 작은 화면에서도 모달이 넘치지 않게 */
  max-height: clamp(280px, 56vh, 620px);
  overflow-y: auto;
}
.warn {
  margin: 0;
  font-size: var(--fs-meta);
  color: var(--text-2);
}
.none {
  margin: 0;
  color: var(--text-3);
}
.cta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--sp-4);
}
.cta p {
  margin: 0;
  color: var(--text-2);
}
</style>
