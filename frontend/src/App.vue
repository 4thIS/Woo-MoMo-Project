<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted } from 'vue'
import { useInterviewStore } from '@/stores/interview'
import { useArchiveViewStore } from '@/stores/archiveView'
import { useAccountStore } from '@/stores/account'
import { useModalStore } from '@/stores/modal'
import ArchiveDetailView from '@/views/ArchiveDetailView.vue'
import LandingView from '@/views/LandingView.vue'
import PrepareView from '@/views/PrepareView.vue'
import InterviewView from '@/views/InterviewView.vue'
import ReportView from '@/views/ReportView.vue'
import HintBar from '@/components/ui/HintBar.vue'
import TopBar from '@/components/TopBar.vue'
import { isAdminPath } from '@/services/route'

// 관리자 화면은 따로 쪼개 내려받는다 — 일반 사용자의 번들에 들어가지 않게
const AdminView = defineAsyncComponent(() => import('@/views/admin/AdminView.vue'))
const onAdmin = isAdminPath()

const interview = useInterviewStore()
/* 보관함 상세는 화면이다. 뒤로 가기로 목록에 돌아와야 하므로 popstate를 여기서 듣는다 —
   스토어가 전역 리스너를 달면 테스트마다 쌓인다 */
const archive = useArchiveViewStore()
/* 해시 이동도 popstate를 쏜다(state: null). 목차는 이제 해시를 쓰지 않지만,
   남이 붙인 앵커 링크 하나에 화면이 닫히는 일이 다시 없도록 state로 가린다:
   상세를 열며 민 항목에는 momoArchive가 있고, 그 항목을 빠져나오면 없다 (2026-11-08) */
function onPop(e: PopStateEvent) {
  const st = e.state as { momoArchive?: string } | null
  if (archive.detail && !st?.momoArchive) archive.close()
}
onMounted(() => window.addEventListener('popstate', onPop))
onBeforeUnmount(() => window.removeEventListener('popstate', onPop))

/** 상세에서 목록으로. 셋을 같이 해야 한다 (2026-11-08) —
 *  ①② 상세를 닫고 히스토리 항목을 되감고(`leave()`) ③ 보관함 모달을 다시 연다.
 *  ①②를 빼면 뒤로 가기가 한 번 헛돌고, ③을 빼면 사용자는 어디로 갔는지 모른 채
 *  이전 페이지로 나가게 된다. 상단바의 "처음으로"는 ③만 다르다 */
function backToArchive() {
  archive.leave()
  useModalStore().show('archive')
}

async function removeArchive() {
  const id = archive.detail?.id
  backToArchive()
  if (id) await useAccountStore().deleteArchive(id)
}
const view = computed(
  () =>
    ({ landing: LandingView, prepare: PrepareView, interview: InterviewView, report: ReportView })[
      interview.phase
    ],
)
</script>

<template>
  <TopBar />
  <!-- 화면 전환: 나가는 화면이 먼저 사라지고 들어오는 화면이 떠오른다.
       둘을 겹치면 100vh 화면끼리 포개져 스크롤이 튄다 -->
  <AdminView v-if="onAdmin" />
  <!-- 보관함 상세는 면접 단계보다 앞선다 — 면접 중에는 애초에 열리지 않는다(archiveView.open) -->
  <ArchiveDetailView
    v-else-if="archive.detail"
    :entry="archive.detail"
    @back="backToArchive()"
    @remove="removeArchive()"
  />
  <Transition v-else name="view" mode="out-in">
    <component :is="view" :key="interview.phase" />
  </Transition>
  <!-- 면접 화면은 무대 안에 쪽지로 띄운다(InterviewView) — 여기서 또 띄우면 둘이 된다 -->
  <HintBar v-if="!onAdmin && !archive.detail && interview.phase !== 'interview'" />
</template>

<style>
.view-enter-active,
.view-leave-active {
  transition:
    opacity var(--dur-2) var(--ease),
    transform var(--dur-2) var(--ease);
}
.view-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.view-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
@media (prefers-reduced-motion: reduce) {
  .view-enter-active,
  .view-leave-active {
    transition: none;
  }
}
</style>
