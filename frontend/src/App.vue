<script setup lang="ts">
import { computed } from 'vue'
import { useInterviewStore } from '@/stores/interview'
import LandingView from '@/views/LandingView.vue'
import PrepareView from '@/views/PrepareView.vue'
import InterviewView from '@/views/InterviewView.vue'
import ReportView from '@/views/ReportView.vue'
import HintBar from '@/components/ui/HintBar.vue'
import TopBar from '@/components/TopBar.vue'

const interview = useInterviewStore()
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
  <Transition name="view" mode="out-in">
    <component :is="view" :key="interview.phase" />
  </Transition>
  <HintBar />
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
