<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FIELD_LABELS, useInterviewStore } from '@/stores/interview'
import { useModelStore } from '@/stores/model'
import { useInterviewerStore } from '@/stores/interviewer'
import PixelWindow from '@/components/ui/PixelWindow.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import InterviewStage from '@/components/interview/InterviewStage.vue'
import ChatLog from '@/components/interview/ChatLog.vue'
import AnswerInput from '@/components/interview/AnswerInput.vue'
import HintBar from '@/components/ui/HintBar.vue'
import { answerLeftMs } from '@/utils/timing'

const s = useInterviewStore()
const model = useModelStore()
const iv = useInterviewerStore()
onMounted(() => void iv.probeSprites()) // 새 면접관 스프라이트를 하나라도 못 불러오면 그 면접관은 기존 가운데 시트 전체로, 배석자도 마찬가지(spec 11.2)

const fieldLabel = computed(() => (s.profile.field ? FIELD_LABELS[s.profile.field] : ''))
const inputDisabled = computed(
  () => s.ended || s.overLimit || s.reportStatus !== 'idle' || s.interviewerTurn,
)
/** 알림 상자는 띄울 알림이 하나라도 있을 때만 — 비어 있으면 빈 틈만 남는다 */
const hasNote = computed(
  () => !!(s.briefing || s.overLimit || s.genError || s.recordingOn || s.recordingWarning),
)

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

/* 경과 시계: 1초마다 now를 갱신. 언마운트 시 정리 */
const now = ref(Date.now())
const clock = setInterval(() => (now.value = Date.now()), 1000)
onBeforeUnmount(() => clearInterval(clock))
const elapsedMs = computed(() => (s.startedAt ? now.value - s.startedAt : 0))
/* 질문별 답변 타이머: 마지막 메시지가 면접관 질문(생성 끝)일 때만, 그 질문이 끝난 시각부터 */
const questionAt = computed(() => {
  const last = s.messages.at(-1)
  return !s.interviewerTurn && !s.ended && last?.role === 'model' && last.at !== undefined
    ? last.at
    : null
})
const answerLeft = computed(() => answerLeftMs(questionAt.value, now.value))

/* 종료: 면접관의 마지막 인사가 끝나면 바로 넘기지 않고 마무리 창을 띄운다. 리포트는 버튼으로 */
const confirming = ref(false)
const closing = computed(() => s.ended && !s.interviewerTurn && s.reportStatus === 'idle')
</script>

<template>
  <main class="interview">
    <div class="stage-area">
      <InterviewStage
        :stage="s.stage"
        :bubble="s.revealed"
        :streaming="s.speaking"
        :watch-tick="watchTick"
        :field-label="fieldLabel"
        :job="s.profile.job"
        :elapsed-ms="elapsedMs"
        :muted="s.muted"
        :voice="model.ttsEnabled"
        :warning="s.ttsWarning ?? ''"
        :center-sprites="iv.spritesFor(s.sessionInterviewer.id)"
        :side-sprites="iv.sideSprites"
        :interviewer-name="s.sessionInterviewer.displayName"
        @toggle-mute="s.toggleMuted()"
        @end="confirming = true"
      />
      <HintBar variant="note" />
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
      <div v-else-if="closing" class="confirm closing" role="dialog" data-test="closing">
        <div class="confirm-backdrop" />
        <PixelWindow padding="sm" class="confirm-win rise" title="면접이 끝났습니다">
          <p class="mono">수고하셨습니다. 면접관이 답변을 정리해 피드백을 드리겠습니다.</p>
          <p class="mono dim">대화 기록은 아래에서 다시 볼 수 있습니다.</p>
          <div class="btns">
            <PixelButton data-test="get-report" @click="s.finish()">리포트 받기</PixelButton>
          </div>
        </PixelWindow>
      </div>
    </div>

    <div class="dock left">
      <PixelWindow padding="sm" class="log-win">
        <ChatLog :messages="s.messages" />
      </PixelWindow>
    </div>

    <div class="dock right">
      <PixelWindow padding="sm" class="input-win">
        <!-- 알림은 한 상자에 모은다 — 낱개로 두면 알림마다 입력판을 아래로 밀어
             버튼이 카드를 벗어난다. 자리가 모자라면 이 상자만 접히고 버튼은 남는다 -->
        <div v-if="hasNote" class="notes">
          <!-- 회사 브리핑(첫 턴만). 조사는 20~40초 걸려 가만히 두면 멈춘 것처럼 보인다 -->
          <p v-if="s.briefing === 'researching'" class="mono note" data-test="briefing">
            벤이 {{ s.profile.companyName || '회사' }}를 살펴보는 중…
          </p>
          <p v-else-if="s.briefing === 'failed'" class="mono note" data-test="briefing-failed">
            회사 최신 정보를 찾지 못해 이력서 중심으로 진행해요
          </p>
          <p v-if="s.overLimit" class="mono note">
            면접관이 마무리하려 합니다. 면접 종료를 눌러 리포트를 받으세요.
          </p>
          <p v-if="s.genError" class="mono note danger">
            응답이 끊겼습니다.
            <PixelButton variant="secondary" data-test="retry" @click="s.retryLast()">
              다시 물어보기
            </PixelButton>
          </p>
          <p v-if="s.recordingOn" class="mono note rec" data-test="rec">
            <span class="dot" aria-hidden="true" />이 면접의 답변은 녹음되어 보관함에 함께 남습니다.
          </p>
          <p v-else-if="s.recordingWarning" class="mono note" data-test="rec-warn">
            {{ s.recordingWarning }}
          </p>
        </div>
        <AnswerInput
          :generating="s.generating"
          :disabled="inputDisabled"
          :left-ms="answerLeft"
          @send="s.send($event)"
          @abort="s.abort()"
          @typing="s.setListening($event)"
        />
      </PixelWindow>
    </div>
  </main>
</template>

<style scoped>
.rec {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.rec .dot {
  width: 8px;
  height: 8px;
  background: var(--danger);
  border-radius: 50%;
}
/* 방이 곧 화면이다 — 창으로 감싸지 않고 브라우저 전체를 면접실로 쓴다.
   면접관과 지원자가 가운데 세로축에 서고, 대화·답변은 아래 양 구석에 떠 있다 */
.interview {
  position: relative;
  height: 100vh;
  overflow: hidden;
}
.stage-area {
  position: absolute;
  inset: 0;
}
/* 아래 양 구석 — 방 위에 떠 있게 반투명으로 깔고 가운데(지원자) 자리를 비운다 */
.dock {
  position: absolute;
  bottom: var(--sp-5);
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  --dock-h: clamp(180px, 29vh, 260px);
  height: var(--dock-h);
  width: clamp(300px, 37vw, 530px);
}
.dock.left {
  left: var(--sp-5);
}
.dock.right {
  right: var(--sp-5);
  /* 알림이 뜨면 그만큼 위로 자란다 — 높이를 묶어 두면 알림이 입력칸을 눌러 버린다.
     방을 다 덮지 않게 상한을 두고, 거기까지 차면 알림 상자가 접힌다 */
  height: auto;
  min-height: var(--dock-h);
  max-height: 60vh;
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
/* 마무리 창은 면접관의 마지막 말이 잠깐 보이도록 반투명이 옅고, 한 박자 뒤에 올라온다 */
.closing .confirm-backdrop {
  opacity: 0.6;
}
/* 말풍선·면접관은 그대로 보이게, 창은 지원자 자리(아래쪽)에 */
.closing {
  align-items: end;
  padding-bottom: var(--sp-8);
}
.closing .confirm-win {
  animation-delay: 0.8s;
}
.dim {
  color: var(--text-2);
  font-size: var(--fs-meta);
}
.confirm-win {
  position: relative;
}
.btns {
  display: flex;
  gap: var(--sp-3);
  justify-content: flex-end;
}

.log-win,
.input-win {
  flex: 1;
  min-height: 0;
  /* 방 위에 떠 있는 판 — 뒤 면접실이 살짝 비친다 */
  background-color: var(--dock);
}
/* 알림이 많아도 입력판 자리를 다 먹지 않게 카드 높이의 일부로 묶고, 넘치면 그 안에서 스크롤 */
.notes {
  display: grid;
  gap: var(--sp-2);
  max-height: 35%;
  min-height: 0;
  overflow-y: auto;
}
.note {
  margin: 0;
  color: var(--text-2);
  font-size: var(--fs-meta);
}
.note.danger {
  color: var(--danger);
}
</style>
