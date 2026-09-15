<script setup lang="ts">
import { computed } from 'vue'
import { useInterviewStore } from '@/stores/interview'
import LandingView from '@/views/LandingView.vue'
import PrepareView from '@/views/PrepareView.vue'
import InterviewView from '@/views/InterviewView.vue'
import ReportView from '@/views/ReportView.vue'

const interview = useInterviewStore()
const view = computed(
  () =>
    ({ landing: LandingView, prepare: PrepareView, interview: InterviewView, report: ReportView })[
      interview.phase
    ],
)
</script>

<template>
  <component :is="view" />
</template>
