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
  <component :is="view" />
  <HintBar />
</template>
