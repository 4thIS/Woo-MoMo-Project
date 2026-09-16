<script lang="ts">
/** 말하기 중 마지막 음성 결과 뒤 이만큼 조용하면 자동 전송. Chrome이 무음으로 인식을 스스로 끊는 시간(약 5~8초)보다 짧게 */
export const SILENCE_MS = 3000
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import { speechSupported, startSpeech, stopSpeech } from '@/services/speech'
import { ANSWER_LIMIT_MS, ANSWER_WARN_MS, formatSignedClock } from '@/utils/timing'

/** leftMs: 이 질문에 남은 답변 시간(ms, 음수 가능). null이면 타이머를 그리지 않는다 */
const props = defineProps<{ generating: boolean; disabled: boolean; leftMs?: number | null }>()
const emit = defineEmits<{ send: [text: string]; abort: []; typing: [hasText: boolean] }>()

const text = ref('')
const interim = ref('')
const listening = ref(false)
const micError = ref('')
const supported = speechSupported()

watch(text, (v) => emit('typing', v.trim().length > 0))

/* 침묵 자동 전송: 음성 결과(interim/final)가 올 때마다 타이머 리셋. 첫 결과 전엔 무장하지 않는다 */
let silenceTimer: ReturnType<typeof setTimeout> | null = null
const silenceArmed = ref(0) // 0 = 꺼짐, n>0 = n번째 무장(카운트다운 애니메이션 재시작용 key)
function disarmSilence() {
  if (silenceTimer) clearTimeout(silenceTimer)
  silenceTimer = null
  silenceArmed.value = 0
}
function armSilence() {
  if (silenceTimer) clearTimeout(silenceTimer)
  silenceArmed.value++
  silenceTimer = setTimeout(() => {
    silenceTimer = null
    silenceArmed.value = 0
    // 받아쓴 게 없으면(공백뿐) 보내지 않고 계속 듣는다
    if ((text.value + interim.value).trim()) {
      text.value = (text.value + interim.value).trim()
      interim.value = ''
      submit()
    }
  }, SILENCE_MS)
}

function submit() {
  if (props.generating) {
    emit('abort')
    return
  }
  const t = text.value.trim()
  if (!t || props.disabled) return
  emit('send', t)
  text.value = ''
  interim.value = ''
  disarmSilence()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    submit()
  }
}
function toggleMic() {
  if (!supported || props.disabled || props.generating) return
  if (listening.value) {
    disarmSilence()
    stopSpeech()
    listening.value = false
    interim.value = ''
    emit('typing', text.value.trim().length > 0)
    return
  }
  micError.value = ''
  listening.value = true
  emit('typing', true)
  startSpeech(
    (t) => {
      if (!listening.value) return
      interim.value = t
      armSilence()
    },
    (t) => {
      // 토글을 끈 뒤 늦게 도착한 결과는 버린다 ("다시 누르면 종료")
      if (!listening.value) return
      text.value += t
      interim.value = ''
      armSilence()
    },
    (err) => {
      micError.value =
        err === 'not-allowed' ? '마이크 권한이 거부되었습니다' : `음성 인식 오류: ${err}`
      listening.value = false
      interim.value = ''
      disarmSilence()
    },
    () => {
      // 브라우저가 무음 등으로 스스로 끝냄 — 토글 표시를 내린다 (침묵 타이머는 살려 둔다)
      listening.value = false
      interim.value = ''
    },
  )
}
// 생성이 시작되거나 입력이 잠기면(종료·토큰 한도) 듣기도 멈춘다
watch(
  () => props.generating || props.disabled,
  (locked) => {
    if (!locked) return
    disarmSilence()
    if (listening.value) {
      stopSpeech()
      listening.value = false
      interim.value = ''
    }
  },
)
onBeforeUnmount(() => {
  disarmSilence()
  if (listening.value) stopSpeech()
})

/* 질문별 60초 게이지: 왼쪽으로 줄어들고 10초 이하면 붉게, 0을 지나면 비운 채 음수 숫자 */
const timerPct = computed(() =>
  Math.round(Math.min(1, Math.max(0, (props.leftMs ?? 0) / ANSWER_LIMIT_MS)) * 100),
)
const timerWarn = computed(() => (props.leftMs ?? Infinity) <= ANSWER_WARN_MS)
// 깜빡임은 10초→0초 구간에서만. 0을 지나면 붉은 음수 숫자로 고정(계속 깜빡이면 소음)
const timerBlink = computed(() => timerWarn.value && (props.leftMs ?? 0) > 0)

const micTitle = computed(() =>
  !supported
    ? '이 브라우저는 음성 인식을 지원하지 않습니다'
    : micError.value || (listening.value ? '듣는 중 — 다시 누르면 종료' : '말하기'),
)
</script>

<template>
  <div class="input-panel">
    <div
      v-if="leftMs !== null && leftMs !== undefined"
      class="timer"
      :class="{ warn: timerWarn }"
      data-test="answer-timer"
      aria-label="남은 답변 시간"
    >
      <div class="bar"><div class="fill" :style="{ width: `${timerPct}%` }" /></div>
      <span class="mono num tab" :class="{ blink: timerBlink }">{{
        formatSignedClock(leftMs)
      }}</span>
    </div>
    <div class="ta-wrap" :class="{ listening }">
      <textarea
        v-model="text"
        class="input mono"
        rows="4"
        placeholder="답변을 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)"
        :disabled="generating || disabled"
        @keydown="onKey"
        @focus="micError = ''"
      />
      <div v-if="interim" class="interim mono" aria-live="polite">{{ interim }}</div>
    </div>
    <div v-if="silenceArmed" :key="silenceArmed" class="silence mono" data-test="silence">
      <span class="bar" :style="{ animationDuration: `${SILENCE_MS}ms` }" />
      <span>말을 멈추면 {{ SILENCE_MS / 1000 }}초 뒤 전송</span>
    </div>
    <div class="actions">
      <button
        type="button"
        class="mic display"
        :class="{ on: listening }"
        data-test="mic"
        :title="micTitle"
        :disabled="!supported || generating || disabled || !!micError"
        @click="toggleMic"
      >
        <span v-if="listening" class="dot blink" />{{ listening ? '듣는 중' : '말하기' }}
      </button>
      <PixelButton data-test="send" :disabled="disabled && !generating" @click="submit">
        {{ generating ? '중단' : '전송' }}
      </PixelButton>
    </div>
    <p v-if="micError" class="mono err">{{ micError }}</p>
  </div>
</template>

<style scoped>
.input-panel {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  height: 100%;
}
.timer {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.timer .bar {
  flex: 1;
  height: 14px;
  border: 2px solid var(--line);
  background: var(--bg);
  padding: 2px;
}
.timer .fill {
  height: 100%;
  background: var(--accent);
}
.timer.warn .fill {
  background: var(--danger);
}
.timer .num {
  min-width: 64px;
  text-align: right;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
.timer.warn .num {
  color: var(--danger);
}
.ta-wrap {
  position: relative;
  flex: 1;
}
.ta-wrap textarea {
  width: 100%;
  height: 100%;
  resize: none;
}
.ta-wrap.listening textarea {
  border-color: var(--accent);
}
.interim {
  position: absolute;
  left: var(--sp-3);
  bottom: var(--sp-2);
  color: var(--text-2);
  font-size: var(--fs-meta);
  pointer-events: none;
}
.actions {
  display: flex;
  gap: var(--sp-3);
  justify-content: flex-end;
}
.mic {
  background: var(--raise);
  color: var(--text);
  border: var(--win-border);
  padding: var(--sp-2) var(--sp-4);
  font-size: var(--fs-button);
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  cursor: pointer;
}
.mic.on {
  background: var(--accent);
  color: var(--bg);
}
.mic:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dot {
  width: 8px;
  height: 8px;
  background: currentColor;
}
.err {
  color: var(--danger);
  font-size: var(--fs-meta);
  margin: 0;
}
.silence {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  font-size: var(--fs-meta);
  color: var(--text-2);
}
.silence .bar {
  width: 96px;
  height: 8px;
  background: var(--accent);
  transform-origin: left;
  animation: silence-drain linear forwards;
}
@keyframes silence-drain {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .silence .bar {
    animation: none;
  }
}
</style>
