<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  STAGES,
  TRACK,
  advance,
  captionFor,
  followScroll,
  scrollProgress,
  stageIndexFor,
  targetScroll,
  type OnceAnim,
  type StageState,
} from '@/utils/progressStages'
import { formatBytes } from '@/utils/format'

const props = withDefaults(
  defineProps<{
    progress: number
    phase: 'download' | 'init' | 'voice' | 'ready' | 'error'
    received: number
    total: number
    fileName: string
    eta?: string
    errorText?: string
    scale?: number
  }>(),
  { eta: '', errorText: '', scale: 3 },
)

/** 표시용 정수 % (장면은 소수 progress를 그대로 쓴다) */
const pct = computed(() => Math.round(props.progress))
const caption = computed(() => {
  // 초기화는 전체 진행률(모델+TTS)로는 88% 언저리 — 아직 길 위라 "자리에 앉는 중"이 아니다 (#26)
  if (props.phase === 'init') return '잠깐 숨 고르는 중…'
  if (props.phase === 'voice') return '목소리 준비 중'
  if (props.phase === 'ready') return '면접관이 자리에 앉았습니다'
  if (props.phase === 'error') return props.errorText
  return captionFor(pct.value)
})
const right = computed(() =>
  props.phase === 'download' || props.phase === 'voice'
    ? [`${pct.value}%`, props.eta].filter(Boolean).join(' · ')
    : props.phase === 'init'
      ? '초기화 중'
      : '',
)

/* ---------- 캔버스 장면 (pixel-progress/index.html 이식) ----------
 * 월드 좌표 하나(scroll)로 바닥·구름·물건·건물을 함께 움직인다(#25). 진행률은 목표 거리로만 쓰고,
 * scroll은 매 프레임 일정 속도로 목표를 따라간다 — 다운로드가 튀어도 화면은 걷는 속도로만 움직인다.
 * 물건 줍기·도착 전환은 scroll에서 되돌린 진행률로 판정해 캐릭터가 그 자리에 닿을 때 나온다. */
type SheetMeta = { file: string; frames: number; w: number; h: number; img?: HTMLImageElement }
const canvas = ref<HTMLCanvasElement | null>(null)
const W = 320
const H = 64 // 하늘 여백을 줄인 높이. 회사(64px)는 윗부분 6px만 잘린다
const GROUND = H - 8
const CHAR_X = 60
const FPS = 10
let sheets: Record<string, SheetMeta> = {}
let state: StageState = { stage: 0, queue: [] }
let once: { name: OnceAnim; start: number } | null = null
let scroll = 0 // 캐릭터가 걸어온 월드 거리(px)
let target = 0 // 진행률이 가리키는 목표 거리
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
  target = 0
}
/** 물건·건물의 월드 X: 진행률 at 지점에 캐릭터가 왔을 때 바로 앞(gap)에 있도록 */
const worldX = (at: number, gap: number) => (at / 100) * TRACK + CHAR_X + gap
const arrived = () => state.stage === STAGES.length - 1

function frame(now: number) {
  const ctx = canvas.value?.getContext('2d')
  if (!ctx) return
  const dt = last ? (now - last) / 1000 : 0
  last = now
  // 1) 걷기: 목표를 향해 일정 속도로. 줍는 동안은 멈춘다. 도착 지점에 닿으면 look_up이 큐에 들어가고 그 뒤로는 서 있는다
  const before = scroll
  if (!once && !arrived()) scroll = followScroll(scroll, target, dt)
  const moving = scroll > before
  state = advance(state, scrollProgress(scroll))
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
  if (!sheet && moving && stage.walk) {
    sheet = sheets[stage.walk]
    if (sheet) idx = 1 + (Math.floor((now / 1000) * FPS) % (sheet.frames - 1))
  }
  if (!sheet) {
    // 서 있기: 도착했으면 look_up 마지막 프레임, 아니면 그 구간 걷기 시트의 첫 프레임
    if (arrived() && sheets.look_up) {
      sheet = sheets.look_up
      idx = sheet.frames - 1
    } else {
      sheet = sheets[stage.walk ?? 'walk_suit_bag']
      idx = 0
    }
  }

  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = colors.ink
  for (let x = -(scroll % 24); x < W; x += 24) ctx.fillRect(x, GROUND + 3, 8, 1)
  ctx.fillStyle = colors.sky
  for (let x = -((scroll * 0.3) % 90); x < W; x += 90) {
    ctx.fillRect(x + 10, 14, 14, 3)
    ctx.fillRect(x + 14, 11, 8, 3)
  }
  const b = sheets.company2
  if (ready(b)) {
    const bx = worldX(STAGES[STAGES.length - 1].at, 40) - scroll
    if (bx < W) ctx.drawImage(b.img, bx, GROUND - b.h + 2)
  }
  STAGES.forEach((s, i) => {
    if (!s.item) return
    const picking = once && once.name === s.once
    if (i <= state.stage && !(picking && idx < 4)) return
    const it = sheets[s.item]
    const x = worldX(s.at, 18) - scroll
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

/* 진행률은 목표 거리만 바꾼다. 되돌아가면(다시 시도·모델 교체) 장면을 처음부터 */
watch(
  () => props.progress,
  (p, prev) => {
    if (p < (prev ?? 0)) resetScene()
    target = targetScroll(p)
  },
  { immediate: true },
)

onMounted(async () => {
  const css = getComputedStyle(document.documentElement)
  colors = {
    ink: css.getPropertyValue('--text-3').trim(),
    sky: css.getPropertyValue('--raise').trim(),
  }
  // 캐시 히트 등으로 중간(또는 도착 상태)에서 시작하면 걸어오는 연출 없이 그 자리에서 시작한다
  scroll = target
  state = { stage: stageIndexFor(scrollProgress(scroll)), queue: [] }
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
      <span
        >{{ formatBytes(received) }} / {{ formatBytes(total) }}
        <span class="file">· {{ fileName }}</span></span
      >
      <span class="caption" :class="{ danger: phase === 'error' }">{{ caption }}</span>
      <span>{{ right }}</span>
    </div>
    <div v-if="phase === 'error'" class="actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.progress {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
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
}
</style>
