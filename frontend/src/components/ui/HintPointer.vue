<script setup lang="ts">
/** 힌트가 가리키는 곳으로 날아가 까딱이는 픽셀 커서 (spec 2026-10-12-hints-design).
 *
 * 글로만 "면접 시작을 누르세요"라고 하면 읽고 지나간다. 누를 것을 직접 가리킨다.
 * 누르는 곳은 마우스 커서, 쓰는 곳은 키보드다. 대상이 화면 밖이면 스크롤해 보여 준다.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { POINTER, needsScroll, pointerSpot, type PointerSpot } from '@/utils/hints'

const props = defineProps<{ selector: string; kind: 'click' | 'type' }>()

/* 픽셀 모양 — '#'은 테두리, '.'은 채움, 공백은 투명 */
const CURSOR = [
  '#         ',
  '##        ',
  '#.#       ',
  '#..#      ',
  '#...#     ',
  '#....#    ',
  '#.....#   ',
  '#......#  ',
  '#.......# ',
  '#....#####',
  '#..#.#    ',
  '#.# #.#   ',
  '##  #.#   ',
  '     #.#  ',
  '      ##  ',
]
/* 안쪽은 비워 입력칸 바탕이 비치게 하고 자판만 칠한다 — 꽉 채우면 작은 크기에서 그냥 네모로 보인다 */
const KEYBOARD = [
  '############',
  '#          #',
  '# .. .. .. #',
  '#          #',
  '# .. .. .. #',
  '#          #',
  '############',
]

interface Cell {
  x: number
  y: number
  w: number
  fill: boolean
}
/** 같은 색이 이어지는 칸을 한 사각형으로 묶는다 — 셀마다 하나씩 그리면 수백 개가 된다 */
function cells(rows: readonly string[]): Cell[] {
  const out: Cell[] = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      let w = 1
      while (row[x + w] === ch) w++
      if (ch !== ' ') out.push({ x, y, w, fill: ch === '.' })
      x += w
    }
  })
  return out
}

const shape = computed(() => (props.kind === 'type' ? KEYBOARD : CURSOR))
const rects = computed(() => cells(shape.value))
const grid = computed(() => ({ w: shape.value[0].length, h: shape.value.length }))

const spot = ref<PointerSpot | null>(null)
let raf = 0

const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** 선택자에 여럿이 걸릴 수 있다(재방문 여부로 갈리는 자리). 실제로 보이는 것을 고른다 */
function find(): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(props.selector)) {
    if (el.getClientRects().length) return el
  }
  return null
}

function track() {
  const el = find()
  spot.value = el
    ? pointerSpot(
        el.getBoundingClientRect(),
        window.innerWidth,
        window.innerHeight,
        props.kind === 'type' ? 'inside' : 'outside',
      )
    : null
  raf = requestAnimationFrame(track)
}

/** 대상이 화면 밖이면 보이는 데까지 끌어온다 — "어디를 보고 있어야 하지"가 여기서 풀린다 */
function reveal() {
  const el = find()
  if (!el || !needsScroll(el.getBoundingClientRect(), window.innerHeight)) return
  el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' })
}

onMounted(() => {
  reveal()
  track()
})
watch(() => props.selector, reveal)
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <div
    v-if="spot"
    class="pointer"
    :class="{ flip: spot.above, key: kind === 'type' }"
    :style="{ left: `${spot.x}px`, top: `${spot.y}px` }"
    aria-hidden="true"
    data-test="hint-pointer"
  >
    <svg
      :viewBox="`0 0 ${grid.w} ${grid.h}`"
      :width="POINTER.w"
      :height="POINTER.h"
      shape-rendering="crispEdges"
    >
      <rect
        v-for="(c, i) in rects"
        :key="i"
        :x="c.x"
        :y="c.y"
        :width="c.w"
        height="1"
        :class="c.fill ? 'fill' : 'edge'"
      />
    </svg>
  </div>
</template>

<style scoped>
.pointer {
  position: fixed;
  z-index: 60; /* 힌트 바(50)보다 위 — 바 가장자리에 겹쳐도 보여야 한다 */
  pointer-events: none;
  /* 자리를 옮길 때 날아가듯이. 픽셀 톤에 맞춰 계단식으로 */
  transition:
    left 320ms steps(8),
    top 320ms steps(8);
  animation: bob 900ms steps(2) infinite;
}
.pointer.flip {
  /* 대상 위에 놓였으면 아래를 가리킨다 */
  transform: scaleY(-1);
  animation-name: bob-up;
}
.edge {
  fill: var(--line);
}
.fill {
  fill: var(--accent);
}
/* 키보드는 입력칸 안에 들어간다 — 테두리 흰색, 자판 노란색이라야 어두운 칸에서 보인다 */
.key svg {
  width: 36px;
  height: 21px;
}

@keyframes bob {
  0%,
  100% {
    translate: 0 0;
  }
  50% {
    translate: 0 5px;
  }
}
@keyframes bob-up {
  0%,
  100% {
    translate: 0 0;
  }
  50% {
    translate: 0 -5px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pointer {
    animation: none;
    transition: none;
  }
}
</style>
