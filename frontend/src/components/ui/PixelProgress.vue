<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  STAGES,
  advance,
  captionFor,
  stageIndexFor,
  type OnceAnim,
  type StageState,
} from '@/utils/progressStages'
import { formatBytes } from '@/utils/format'

const props = withDefaults(
  defineProps<{
    progress: number
    phase: 'download' | 'init' | 'ready' | 'error'
    received: number
    total: number
    fileName: string
    eta?: string
    errorText?: string
    scale?: number
  }>(),
  { eta: '', errorText: '', scale: 3 },
)

const caption = computed(() => {
  if (props.phase === 'init') return '출근 완료 — 자리에 앉는 중'
  if (props.phase === 'ready') return '면접관이 자리에 앉았습니다'
  if (props.phase === 'error') return props.errorText
  return captionFor(props.progress)
})
const right = computed(() =>
  props.phase === 'download'
    ? [`${props.progress}%`, props.eta].filter(Boolean).join(' · ')
    : props.phase === 'init'
      ? '초기화 중'
      : '',
)

/* ---------- 캔버스 장면 (pixel-progress/index.html 이식) ---------- */
type SheetMeta = { file: string; frames: number; w: number; h: number; img?: HTMLImageElement }
const canvas = ref<HTMLCanvasElement | null>(null)
const W = 320
const H = 80
const GROUND = H - 8
const CHAR_X = 60
const FPS = 10
const SCROLL = 40
const APPROACH = 8
let sheets: Record<string, SheetMeta> = {}
let state: StageState = { stage: 0, queue: [] }
let once: { name: OnceAnim; start: number } | null = null
let scroll = 0
let last = 0
let raf = 0
let colors = { ink: '', sky: '' }

async function loadSheets() {
  try {
    const res = await fetch('/sprites/manifest.json')
    const m = (await res.json()) as Record<string, SheetMeta>
    for (const [k, v] of Object.entries(m)) {
      const img = new Image()
      img.src = `/sprites/${v.file.split('/').pop()}`
      sheets[k] = { ...v, img }
    }
  } catch {
    sheets = {}
  }
}

/** 깨진 이미지(404 등)는 complete === true여도 naturalWidth === 0이라 drawImage가 던진다. */
function ready(s?: SheetMeta): s is SheetMeta & { img: HTMLImageElement } {
  return !!s?.img && s.img.complete && s.img.naturalWidth > 0
}

function resetScene() {
  state = { stage: 0, queue: [] }
  once = null
  scroll = 0
}

function frame(now: number) {
  const ctx = canvas.value?.getContext('2d')
  if (!ctx) return
  const dt = last ? (now - last) / 1000 : 0
  last = now
  const stage = STAGES[state.stage]
  if (!once && state.queue.length) {
    const next = state.queue.shift()
    if (next) once = { name: next, start: now }
  }

  let sheet: SheetMeta | undefined
  let idx = 0
  if (once) {
    const s = sheets[once.name]
    idx = Math.floor(((now - once.start) / 1000) * FPS)
    if (s && idx >= s.frames) {
      if (once.name === 'look_up') idx = s.frames - 1
      else once = null
    }
    if (once) sheet = s
  }
  const walking = !once && props.phase === 'download' && stage.walk
  if (walking) {
    sheet = sheets[stage.walk!]
    if (sheet) idx = 1 + (Math.floor((now / 1000) * FPS) % (sheet.frames - 1))
    scroll += dt * SCROLL
  }
  if (!sheet) {
    sheet = sheets[stage.walk ?? 'walk_suit_bag']
    idx = props.phase !== 'download' && sheets.look_up ? sheets.look_up.frames - 1 : 0
    if (props.phase !== 'download' && sheets.look_up) sheet = sheets.look_up
  }

  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = colors.ink
  for (let x = -(scroll % 24); x < W; x += 24) ctx.fillRect(x, GROUND + 3, 8, 1)
  ctx.fillStyle = colors.sky
  for (let x = -((scroll * 0.3) % 90); x < W; x += 90) {
    ctx.fillRect(x + 10, 14, 14, 3)
    ctx.fillRect(x + 14, 11, 8, 3)
  }
  const approachX = (at: number, gap: number) =>
    CHAR_X + gap + Math.max(0, at - props.progress) * APPROACH
  const b = sheets.company2
  if (ready(b)) {
    const bx = approachX(90, 40)
    if (bx < W) ctx.drawImage(b.img, bx, GROUND - b.h + 2)
  }
  STAGES.forEach((s, i) => {
    if (!s.item) return
    const picking = once && once.name === s.once
    if (i <= state.stage && !(picking && idx < 4)) return
    const it = sheets[s.item]
    const x = approachX(s.at, 18)
    if (ready(it) && x < W) ctx.drawImage(it.img, x, GROUND - it.h + 2)
  })
  if (ready(sheet))
    ctx.drawImage(
      sheet.img,
      idx * sheet.w,
      0,
      sheet.w,
      sheet.h,
      CHAR_X,
      GROUND - sheet.h + 2,
      sheet.w,
      sheet.h,
    )
  raf = requestAnimationFrame(frame)
}

watch(
  () => props.progress,
  (p, prev) => {
    if (p < (prev ?? 0)) resetScene()
    state = advance(state, p)
  },
  { immediate: true },
)

onMounted(async () => {
  const css = getComputedStyle(document.documentElement)
  colors = {
    ink: css.getPropertyValue('--text-3').trim(),
    sky: css.getPropertyValue('--raise').trim(),
  }
  state = { stage: stageIndexFor(props.progress), queue: [] } // 캐시 히트 등으로 중간에서 시작하면 전환 애니 없이 그 구간부터
  await loadSheets()
  raf = requestAnimationFrame(frame)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <div class="progress">
    <canvas
      ref="canvas"
      class="px scene"
      :width="W"
      :height="H"
      :style="{ width: `${W * scale}px`, height: `${H * scale}px` }"
    />
    <div class="bar">
      <div
        class="fill"
        :class="{ ok: phase === 'ready', danger: phase === 'error' }"
        :style="{ width: `${progress}%` }"
      />
    </div>
    <div class="mono meta">
      <span>{{ formatBytes(received) }} / {{ formatBytes(total) }}</span>
      <span class="caption" :class="{ danger: phase === 'error' }">{{ caption }}</span>
      <span>{{ right }}</span>
    </div>
    <div v-if="phase === 'error'" class="actions"><slot name="actions" /></div>
    <div class="mono file">{{ fileName }}</div>
  </div>
</template>

<style scoped>
.progress {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}
.scene {
  display: block;
  margin: 0 auto;
  background: var(--bg);
}
.bar {
  height: 22px;
  border: 3px solid var(--line);
  background: var(--bg);
  padding: 2px;
}
.fill {
  height: 100%;
  background: var(--accent);
}
.fill.ok {
  background: var(--ok);
}
.fill.danger {
  background: var(--danger);
}
.meta {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-4);
  font-size: var(--fs-body-sm);
  color: var(--text-2);
}
.caption {
  color: var(--text);
}
.caption.danger {
  color: var(--danger);
}
.actions {
  display: flex;
  gap: var(--sp-3);
}
.file {
  font-size: var(--fs-meta);
  color: var(--text-3);
  text-align: right;
}
</style>
