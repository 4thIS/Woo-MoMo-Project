<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { FIELD_LABELS, useInterviewStore } from '@/stores/interview'
import PixelWindow from '@/components/ui/PixelWindow.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import InterviewStage from '@/components/interview/InterviewStage.vue'
import ChatLog from '@/components/interview/ChatLog.vue'
import AnswerInput from '@/components/interview/AnswerInput.vue'

const s = useInterviewStore()

const fieldLabel = computed(() => (s.profile.field ? FIELD_LABELS[s.profile.field] : ''))
const lastModel = computed(
  () => [...s.messages].reverse().find((m) => m.role === 'model')?.text ?? '',
)
const bubble = computed(() => (s.generating ? s.streaming : lastModel.value))
const inputDisabled = computed(() => s.ended || s.overLimit || s.reportStatus !== 'idle')

/* 답변 지연 watch: waiting 20초 → 1회, 이후 30초마다 */
const watchTick = ref(0)
let idleTimer: ReturnType<typeof setTimeout> | null = null
function armIdle(ms: number) {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (s.stage === 'waiting') {
      watchTick.value++
      armIdle(30_000)
    }
  }, ms)
}
watch(
  () => s.stage,
  (st) => {
    if (st === 'waiting') armIdle(20_000)
    else if (idleTimer) clearTimeout(idleTimer)
  },
  { immediate: true },
)
onBeforeUnmount(() => idleTimer && clearTimeout(idleTimer))

/* 종료 */
const confirming = ref(false)
watch(
  () => s.ended,
  (e) => e && !s.generating && void s.finish(),
  { immediate: true },
)
</script>

<template>
  <main class="interview">
    <div class="stage-area">
      <InterviewStage
        :stage="s.stage"
        :bubble="bubble"
        :streaming="s.generating"
        :react-pending="s.reactPending"
        :watch-tick="watchTick"
        :field-label="fieldLabel"
        :job="s.profile.job"
        @react-done="s.consumeReact()"
        @end="confirming = true"
      />
      <div v-if="confirming" class="confirm" role="dialog">
        <div class="confirm-backdrop" />
        <PixelWindow padding="sm" class="confirm-win">
          <p class="mono">지금까지의 답변으로 리포트를 만들까요?</p>
          <div class="btns">
            <PixelButton variant="secondary" @click="confirming = false">계속 진행</PixelButton>
            <PixelButton data-test="end-confirm" @click="s.finish()">리포트 만들기</PixelButton>
          </div>
        </PixelWindow>
      </div>
    </div>

    <div class="panel">
      <PixelWindow padding="sm" class="log-win">
        <ChatLog :messages="s.messages" />
      </PixelWindow>
      <PixelWindow padding="sm" class="input-win">
        <p v-if="s.overLimit" class="mono note">
          면접관이 마무리하려 합니다. 면접 종료를 눌러 리포트를 받으세요.
        </p>
        <p v-if="s.genError" class="mono note danger">
          응답이 끊겼습니다.
          <PixelButton variant="secondary" data-test="retry" @click="s.retryLast()">
            다시 물어보기
          </PixelButton>
        </p>
        <AnswerInput
          :generating="s.generating"
          :disabled="inputDisabled"
          @send="s.send($event)"
          @abort="s.abort()"
          @typing="s.setListening($event)"
        />
      </PixelWindow>
    </div>
  </main>
</template>

<style scoped>
.interview {
  height: 100vh;
  display: grid;
  grid-template-rows: 2fr 1fr;
  gap: var(--sp-4);
  padding: var(--sp-4) var(--page-x);
  box-sizing: border-box;
  overflow: hidden;
}
.stage-area {
  position: relative;
  min-height: 0;
}
.confirm {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  z-index: 5;
}
.confirm-backdrop {
  position: absolute;
  inset: 0;
  background: var(--bg);
  opacity: 0.85;
}
.confirm-win {
  position: relative;
}
.btns {
  display: flex;
  gap: var(--sp-3);
  justify-content: flex-end;
}
.panel {
  display: grid;
  grid-template-columns: 7fr 5fr;
  gap: var(--sp-4);
  min-height: 0;
}
.log-win,
.input-win {
  min-height: 0;
}
.note {
  margin: 0 0 var(--sp-2);
  color: var(--text-2);
  font-size: var(--fs-meta);
}
.note.danger {
  color: var(--danger);
}
</style>
