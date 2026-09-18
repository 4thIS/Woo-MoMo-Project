<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  RATE_WINDOW_MS,
  SCROLL,
  STAGES,
  approach,
  captionFor,
  distanceAhead,
  progressRate,
  stageIndexFor,
  type OnceAnim,
  type Sample,
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
 * 캐릭터는 트레드밀처럼 일정 속도(SCROLL)로 걷고 바닥·구름도 그 속도로 흐른다(#25: 물건이 바닥에 붙어 보이려면
 * 물건도 같은 속도여야 한다). 물건·건물은 "도착 예정 시각 × 걷는 속도"만큼 앞에 놓여 바닥과 함께 다가오며,
 * 진행 속도 추정이 바뀌면 점프 대신 천천히 보정된다. 진행이 멈추면(초기화 구간) 모두 함께 멈춘다.
 * 물건 줍기·도착은 물건이 캐릭터에게 닿을 때 일어나므로 위치와 어긋나지 않는다. */
type SheetMeta = { file: string; frames: number; w: number; h: number; img?: HTMLImageElement }
const canvas = ref<HTMLCanvasElement | null>(null)
const W = 320
const H = 64 // 하늘 여백을 줄인 높이. 회사(64px)는 윗부분 6px만 잘린다
const GROUND = H - 8
const CHAR_X = 60
const FPS = 10
const MAX_DT = 0.1 // 탭이 잠들었다 깨어나도 한 번에 크게 뛰지 않게
const ITEM_GAP = 18 // 물건이 캐릭터 발 앞에 놓이는 간격
const BUILDING_GAP = 40
let sheets: Record<string, SheetMeta> = {}
let state: StageState = { stage: 0, queue: [] }
let once: { name: OnceAnim; start: number } | null = null
let scroll = 0 // 바닥·구름 위상(px)
let last = 0
let raf = 0
let colors = { ink: '', sky: '' }
/** 진행률 표본(진행 속도 추정용) */
let samples: Sample[] = []
/** 물건·건물의 화면 x. null = 아직 자리를 못 잡음(진행 속도를 모름) → 그리지 않는다. 주운 것은 done */
type Prop = { stage: number; at: number; gap: number; x: number | null; done: boolean }
let props_: Prop[] = []

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

const arrived = () => state.stage === STAGES.length - 1

/** 진행률 p에서 장면을 세운다. 이미 지난 구간의 물건은 주운 것으로(전환 애니 없이), 마지막 구간이면 도착 상태 */
function setScene(p: number) {
  const stage = stageIndexFor(p)
  state = { stage, queue: [] }
  once = null
  scroll = 0
  samples = []
  props_ = STAGES.map((s, i) => ({
    stage: i,
    at: s.at,
    gap: s.item ? ITEM_GAP : BUILDING_GAP,
    x: i === STAGES.length - 1 && stage === i ? CHAR_X + BUILDING_GAP : null,
    done: i <= stage,
  })).filter((pr) => pr.stage > 0) // 0번 구간(출발)은 물건이 없다
}

function frame(now: number) {
  const ctx = canvas.value?.getContext('2d')
  if (!ctx) return
  const dt = Math.min(MAX_DT, last ? (now - last) / 1000 : 0)
  last = now

  // 1) 진행 속도(%/s). 멈춰 있으면 0 → 장면도 멈춘다
  samples.push({ t: now, p: props.progress })
  while (samples.length && now - samples[0].t > RATE_WINDOW_MS) samples.shift()
  const rate = progressRate(samples, now)
  // 진행률은 이미 지났는데 물건이 아직 안 닿았으면(속도를 낮게 봤음) 마저 걸어가 닿게 한다
  const overdue = props_.some((pr) => !pr.done && props.progress >= pr.at)
  const walking = !once && !arrived() && (rate > 0 || overdue)
  const step = walking ? dt : 0
  scroll += SCROLL * step

  // 2) 물건·건물: 예상 거리로 자리 잡고 바닥과 함께 다가온다. 닿으면 줍기(도착) 전환
  for (const pr of props_) {
    if (pr.done) continue
    const dist = distanceAhead(pr.at, props.progress, rate)
    const target = dist === null ? null : CHAR_X + pr.gap + dist
    if (pr.x === null) {
      if (target !== null) pr.x = target
      continue
    }
    pr.x = approach(pr.x, target, step)
    if (pr.x <= CHAR_X + pr.gap + 0.5) {
      pr.x = CHAR_X + pr.gap
      pr.done = true
      const s = STAGES[pr.stage]
      state = { stage: pr.stage, queue: s.once ? [...state.queue, s.once] : state.queue }
    }
  }

  const stage = STAGES[state.stage]
  if (!once && state.queue.length) {
    const next = state.queue.shift()
    if (next) once = { name: next, start: now }
  }

  // 3) 캐릭터 시트: 1회성(줍기·올려다보기) > 걷기 > 서 있기
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
  if (!sheet && walking && stage.walk) {
    sheet = sheets[stage.walk]
    if (sheet) idx = 1 + (Math.floor((now / 1000) * FPS) % (sheet.frames - 1))
  }
  if (!sheet) {
    if (arrived() && sheets.look_up) {
      sheet = sheets.look_up
      idx = sheet.frames - 1
    } else {
      sheet = sheets[stage.walk ?? 'walk_suit_bag']
      idx = 0
    }
  }

  // 4) 그리기 — 픽셀 아트라 정수 좌표로 스냅(소수 좌표는 매 프레임 서브픽셀 리샘플링으로 가장자리가 흔들린다)
  const sx = Math.round(scroll)
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = colors.ink
  for (let x = -(sx % 24); x < W; x += 24) ctx.fillRect(x, GROUND + 3, 8, 1)
  ctx.fillStyle = colors.sky
  for (let x = -(Math.round(sx * 0.3) % 90); x < W; x += 90) {
    ctx.fillRect(x + 10, 14, 14, 3)
    ctx.fillRect(x + 14, 11, 8, 3)
  }
  for (const pr of props_) {
    const s = STAGES[pr.stage]
    const picking = once && once.name === s.once
    if (pr.x === null) continue
    if (pr.done && !(picking && idx < 4) && s.item) continue // 주운 물건은 사라진다(줍는 첫 프레임들만 남김)
    const img = s.item ? sheets[s.item] : sheets.company2
    const x = Math.round(pr.x)
    if (ready(img) && x < W) ctx.drawImage(img.img, x, GROUND - img.h + 2)
  }
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

/* 진행률이 되돌아가면(다시 시도·모델 교체) 장면을 처음부터. 올라가는 건 frame()이 표본으로 알아서 따라간다 */
watch(
  () => props.progress,
  (p, prev) => {
    if (p < (prev ?? 0)) setScene(p)
  },
)

onMounted(async () => {
  const css = getComputedStyle(document.documentElement)
  colors = {
    ink: css.getPropertyValue('--text-3').trim(),
    sky: css.getPropertyValue('--raise').trim(),
  }
  setScene(props.progress) // 캐시 히트 등으로 중간(또는 도착 상태)에서 시작하면 걸어오는 연출 없이 그 자리에서
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
