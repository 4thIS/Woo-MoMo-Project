<script lang="ts">
/** 지금 소리를 내는 하나. `<script setup>`은 인스턴스마다 실행되므로
 *  여기(모듈 스코프)에 둬야 컴포넌트 사이에서 공유된다 */
let current: HTMLAudioElement | null = null
</script>

<script setup lang="ts">
/** 사이트 모양에 맞춘 재생바 (이슈 126).
 *
 * 브라우저 기본 `controls`는 크롬·사파리가 저마다 다르게 그려 사이트와 어울리지 않는다.
 * `<audio>`는 소리만 내고 버튼·막대·시간은 여기서 그린다.
 *
 * **한 번에 하나만 운다** — 보관함에 클립이 여럿이라, 다른 것을 누르면 앞의 것을 멈춘다.
 */
import { onBeforeUnmount, ref } from 'vue'
import { formatClock } from '@/utils/timing'

const props = defineProps<{ src: string; label?: string }>()

const el = ref<HTMLAudioElement | null>(null)
const bar = ref<HTMLElement | null>(null)
const playing = ref(false)
const at = ref(0)
const total = ref(0)
/** 드래그 중인가 — 끌고 있는 동안에는 timeupdate가 위치를 되돌리지 못하게 */
let dragging = false

const pct = () => (total.value > 0 ? (at.value / total.value) * 100 : 0)

function toggle() {
  const a = el.value
  if (!a) return
  if (playing.value) {
    a.pause()
    return
  }
  // 앞서 울던 것을 먼저 재운다
  if (current && current !== a) current.pause()
  current = a
  void a.play().catch(() => undefined)
}

function onMeta() {
  const d = el.value?.duration
  total.value = Number.isFinite(d) ? (d as number) : 0
}
function onTime() {
  if (!dragging) at.value = el.value?.currentTime ?? 0
}
function onPlay() {
  playing.value = true
  current = el.value
}
function onPause() {
  playing.value = false
}
function onEnded() {
  playing.value = false
  at.value = 0
}

/** 막대 위 x좌표를 초로 바꿔 옮긴다 */
function seekTo(clientX: number) {
  const box = bar.value?.getBoundingClientRect()
  const a = el.value
  if (!box || !a || box.width === 0 || total.value <= 0) return
  const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width))
  at.value = ratio * total.value
  a.currentTime = at.value
}
function onDown(e: PointerEvent) {
  dragging = true
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  seekTo(e.clientX)
}
function onMove(e: PointerEvent) {
  if (dragging) seekTo(e.clientX)
}
function onUp() {
  dragging = false
}

/** 키보드: 좌우 5초, Space·Enter로 재생·정지 */
function onKey(e: KeyboardEvent) {
  const a = el.value
  if (!a) return
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault()
    const next = Math.min(
      total.value,
      Math.max(0, a.currentTime + (e.key === 'ArrowRight' ? 5 : -5)),
    )
    a.currentTime = next
    at.value = next
  }
}

onBeforeUnmount(() => {
  if (current === el.value) current = null
})
</script>

<template>
  <div class="player" data-test="audio-player">
    <audio
      ref="el"
      :src="props.src"
      preload="none"
      @loadedmetadata="onMeta"
      @timeupdate="onTime"
      @play="onPlay"
      @pause="onPause"
      @ended="onEnded"
    />
    <button
      type="button"
      class="mono btn press"
      :aria-label="`${props.label ?? '녹음'} ${playing ? '멈추기' : '재생'}`"
      data-test="audio-toggle"
      @click="toggle"
    >
      {{ playing ? '❚❚' : '▶' }}
    </button>
    <div
      ref="bar"
      class="bar"
      role="slider"
      tabindex="0"
      :aria-label="`${props.label ?? '녹음'} 재생 위치`"
      :aria-valuemin="0"
      :aria-valuemax="Math.round(total)"
      :aria-valuenow="Math.round(at)"
      data-test="audio-bar"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @keydown="onKey"
    >
      <span class="fill" :style="{ width: `${pct()}%` }" />
    </div>
    <span class="mono time" data-test="audio-time">
      {{ formatClock(at * 1000) }} / {{ formatClock(total * 1000) }}
    </span>
  </div>
</template>

<style scoped>
.player {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.btn {
  flex: none;
  min-width: 2.2em;
  padding: var(--sp-1) var(--sp-2);
  color: var(--text-1);
  background: var(--raise);
  border: 2px solid var(--line);
  cursor: pointer;
}
.bar {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 10px;
  background: var(--raise);
  border: 2px solid var(--line);
  cursor: pointer;
}
.bar:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--accent);
}
.time {
  flex: none;
  font-size: var(--fs-meta);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
</style>
