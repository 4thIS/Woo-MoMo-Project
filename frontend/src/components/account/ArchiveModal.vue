<script setup lang="ts">
/** 보관함 목록 — 시안 C (탭) (spec 7.4).
 *
 * 상세는 **화면으로 나갔다** (2026-11-07 개편). 줄을 누르면 이 모달이 닫히고
 * `ArchiveDetailView`가 뜬다 — 모달을 쌓지 않으니 Esc가 어디를 닫는지도 흐려지지 않는다.
 */
import { computed, ref, watch } from 'vue'
import { useAccountStore } from '@/stores/account'
import { useArchiveViewStore } from '@/stores/archiveView'
import { ARCHIVE_LIMIT, freeEntries, premiumEntries } from '@/utils/archive'
import PixelModal from '@/components/ui/PixelModal.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import ArchiveRow from './ArchiveRow.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; 'need-premium': [] }>()

const account = useAccountStore()
const archiveView = useArchiveViewStore()

type Tab = 'all' | 'free' | 'premium'
const tab = ref<Tab>('all')

const free = computed(() => freeEntries(account.archive))
const premium = computed(() => premiumEntries(account.archive))
const shown = computed(() =>
  tab.value === 'free' ? free.value : tab.value === 'premium' ? premium.value : account.archive,
)

watch(
  () => props.open,
  (on) => {
    if (!on) return
    tab.value = 'all'
    void account.refreshArchive()
  },
  { immediate: true },
)
</script>

<template>
  <PixelModal :open="open" title="보관함" width="wide" @close="emit('close')">
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
      <!-- 한도는 일반 기록 얘기다. 프리미엄 탭에서 꺼내면 엉뚱한 자리에서 겁을 준다.
             꽉 차기 **전에도** 적는다 — 그때만 말하면 그전까지는 한도가 있는 줄 모른다 -->
      <p v-if="tab !== 'premium'" class="mono warn" data-test="archive-limit">
        <template v-if="account.archiveFull">
          일반 기록이 {{ ARCHIVE_LIMIT }}개로 찼습니다 — 다음 면접을 마치면 가장 오래된 하나가
          사라집니다.
        </template>
        <template v-else>
          일반 기록은 {{ ARCHIVE_LIMIT }}개까지 남습니다 — 넘으면 오래된 것부터 밀려납니다.
        </template>
      </p>

      <ArchiveRow v-for="e in shown" :key="e.id" :entry="e" @open="archiveView.open(e.id)" />

      <!-- 프리미엄 탭은 비어도 숨기지 않는다. 비어 있는 자리가 가장 좋은 권유 자리다 -->
      <div v-if="!shown.length && tab === 'premium'" class="cta" data-test="premium-cta">
        <p class="mono">벤과 본 면접은 보관 한도에 들어가지 않고, 녹음까지 함께 남습니다.</p>
        <PixelButton @click="emit('need-premium')">모모 프리미엄 보기</PixelButton>
      </div>
      <p v-else-if="!shown.length" class="mono none" data-test="archive-empty">
        아직 남은 면접이 없습니다. 면접을 마치면 여기에 쌓입니다.
      </p>
    </div>
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
