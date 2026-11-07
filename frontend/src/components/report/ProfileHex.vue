<script setup lang="ts">
/** 답변 하나의 여섯 축 프로필 — 왼쪽 육각형, 오른쪽 축 목록 (이슈 134).
 *
 * 라이브러리를 쓰지 않는다. 꼭짓점 여섯 개짜리 레이더는 사인·코사인 한 줄이면 되고,
 * 차트 라이브러리를 들이면 번들만 커진다.
 *
 * `level: null`은 **0점이 아니라 모르는 것**이다. 꼭짓점을 중심에 두되 축 이름을
 * 흐리게 하고 "측정 없음"이라고 적어, 못한 것으로 읽히지 않게 한다.
 */
import { computed } from 'vue'
import type { ProfileAxis } from '@/utils/reportV2'

const props = withDefaults(defineProps<{ profile: ProfileAxis[]; size?: number }>(), {
  /** 카드 안에서는 작게(110), 혼자 띄울 때는 크게. 계산식은 건드리지 않는다 */
  size: 180,
})

/** 단계를 말로. 숫자만 두면 점수표처럼 읽힌다 */
const SAID = ['아쉬워요', '조금 부족해요', '보통이에요', '좋아요', '아주 좋아요']
const say = (level: number | null) => (level === null ? '측정 없음' : (SAID[level - 1] ?? ''))

/** 크기는 prop이 정하고, 나머지는 **비율로** 따라간다 — 180 기준으로 잡았던
 *  눈금 반지름 58과 이름표 여백 16을 그대로 쓰면 작게 줄일 때 글자가 밖으로 나간다 */
const C = () => props.size / 2
/** 바깥 눈금까지의 거리. 축 이름 자리를 남긴다 */
const R = () => (props.size * 58) / 180
const LABEL_GAP = () => (props.size * 16) / 180
const RINGS = [1, 2, 3, 4, 5]

/** i번째 축의 각도 — 맨 위에서 시작해 시계 방향 */
function angle(i: number) {
  return (Math.PI * 2 * i) / props.profile.length - Math.PI / 2
}
function point(i: number, dist: number) {
  const a = angle(i)
  return [C() + Math.cos(a) * dist, C() + Math.sin(a) * dist] as const
}
const ring = (step: number) =>
  props.profile
    .map((_, i) => point(i, (R() * step) / 5))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')

/** 값 다각형. 측정 없는 축은 중심(0)으로 */
const shape = computed(() =>
  props.profile
    .map((a, i) => point(i, (R() * (a.level ?? 0)) / 5))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' '),
)

/** 이름표 자리 — 눈금보다 조금 바깥 */
const labelAt = (i: number) => {
  const [x, y] = point(i, R() + LABEL_GAP())
  return { x, y }
}

/** 그림만으로는 읽을 수 없다 — 화면 낭독기에 같은 내용을 글로 준다 */
const described = computed(() => props.profile.map((a) => `${a.label} ${say(a.level)}`).join(', '))
</script>

<template>
  <div class="hex" data-test="profile-hex">
    <svg
      class="chart"
      :viewBox="`0 0 ${size} ${size}`"
      role="img"
      :aria-label="`답변 프로필: ${described}`"
    >
      <polygon
        v-for="step in RINGS"
        :key="step"
        class="ring"
        data-test="hex-ring"
        :points="ring(step)"
      />
      <line
        v-for="(a, i) in profile"
        :key="`spoke-${a.key}`"
        class="spoke"
        :x1="size / 2"
        :y1="size / 2"
        :x2="point(i, R())[0]"
        :y2="point(i, R())[1]"
      />
      <polygon class="shape" data-test="hex-shape" :points="shape" />
      <text
        v-for="(a, i) in profile"
        :key="`label-${a.key}`"
        class="axis"
        :class="{ none: a.level === null }"
        data-test="hex-axis-label"
        :x="labelAt(i).x"
        :y="labelAt(i).y"
        text-anchor="middle"
        dominant-baseline="middle"
      >
        {{ a.label }}
      </text>
    </svg>

    <ul class="rows">
      <li v-for="a in profile" :key="a.key" class="row" data-test="hex-row">
        <span class="mono name" :class="{ none: a.level === null }">{{ a.label }}</span>
        <span class="mono step" :class="{ none: a.level === null }">{{ say(a.level) }}</span>
        <span v-if="a.comment" class="note">{{ a.comment }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.hex {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--sp-5);
  align-items: center;
}
.chart {
  width: 180px;
  height: 180px;
  flex: none;
}
.ring {
  fill: none;
  stroke: var(--line);
  stroke-width: 1;
}
.spoke {
  stroke: var(--line);
  stroke-width: 1;
}
.shape {
  fill: var(--accent);
  fill-opacity: 0.25;
  stroke: var(--accent);
  stroke-width: 2;
}
.axis {
  font-size: 9px;
  fill: var(--text-2);
}
.axis.none {
  fill: var(--text-3);
}
.rows {
  display: grid;
  gap: var(--sp-2);
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: 0;
}
.row {
  display: grid;
  grid-template-columns: 5.5em 6em 1fr;
  gap: var(--sp-2);
  align-items: baseline;
  font-size: var(--fs-meta);
}
.name {
  color: var(--text-2);
}
.step {
  color: var(--accent);
}
.name.none,
.step.none {
  color: var(--text-3);
}
.note {
  color: var(--text-2);
  line-height: 1.5;
  word-break: keep-all;
}

/* 좁은 화면에서는 그래프 위, 목록 아래 */
@media (max-width: 560px) {
  .hex {
    grid-template-columns: 1fr;
    justify-items: center;
  }
  .row {
    grid-template-columns: 5.5em 6em;
  }
  .note {
    grid-column: 1 / -1;
  }
}

/* 종이에서는 선만 남긴다 — 회색으로 떨어진 칠이 축 이름을 삼킨다.
   단계 말은 옆의 표에 글로 남아 읽힌다 */
@media print {
  .shape {
    fill: none;
  }
}
</style>
