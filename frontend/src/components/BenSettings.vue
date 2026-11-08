<script setup lang="ts">
/** 벤 성향 다섯 줄 — 게임 설정 화면 어법 (2026-11-07).
 *
 * `◀ [눈금 셋] ▶  고른 값  한 줄 설명`. 값 이름을 **한 번만** 적어 좁은 폭에
 * 다섯 줄이 다 들어간다. 세 칸을 모두 적는 방식은 390px에서 넘친다.
 *
 * 속은 `<input type="range">`다 — 화살표 키와 화면 낭독기가 표준대로 따라온다.
 * 세 단계뿐이라 눈금을 **셋으로 끊어** 그려 이어진 값처럼 보이지 않게 한다.
 *
 * 회사 이야기 줄은 서버가 무시하는 면접(입학 트랙·회사 이름 없음)에서 **아예 그리지 않는다** —
 * 무시되는 칸을 고르게 두면 거짓말이다.
 */
import { computed } from 'vue'
import { BEN_AXES, type BenAxisValues, type Notch } from '@/content/benAxes'

const props = defineProps<{ modelValue: BenAxisValues; showCompany: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [BenAxisValues] }>()

const axes = computed(() => BEN_AXES.filter((a) => props.showCompany || a.key !== 'companyWeight'))

function move(key: keyof BenAxisValues, raw: string) {
  emit('update:modelValue', { ...props.modelValue, [key]: Number(raw) as Notch })
}

/** 화살표로 한 칸. 끝에서는 잠겨 있어 여기 오지 않는다 */
function step(key: keyof BenAxisValues, by: -1 | 1) {
  const next = props.modelValue[key] + by
  if (next < 0 || next > 2) return
  emit('update:modelValue', { ...props.modelValue, [key]: next as Notch })
}
</script>

<template>
  <div class="axes">
    <div v-for="a in axes" :key="a.key" class="axis" data-test="ben-axis">
      <span class="mono label">{{ a.label }}</span>
      <span class="slide">
        <!-- 보이면 눌려야 한다. 전에는 aria-hidden span이라 눌러도 아무 일이 없었다 (2026-11-08).
             Tab 차례와 낭독기는 속의 range가 맡으므로 여기서는 빠진다 -->
        <button
          type="button"
          class="mono nudge"
          tabindex="-1"
          aria-hidden="true"
          :disabled="modelValue[a.key] === 0"
          data-test="ben-prev"
          @click="step(a.key, -1)"
        >
          ◀
        </button>
        <span class="track">
          <!-- 눈금 셋. 고른 자리만 채운다 — 어디쯤인지 그림으로도 보이게 -->
          <span
            v-for="n in 3"
            :key="n"
            class="notch"
            :class="{ on: modelValue[a.key] === n - 1 }"
            data-test="ben-notch"
            aria-hidden="true"
          />
          <input
            type="range"
            min="0"
            max="2"
            step="1"
            class="range"
            :value="modelValue[a.key]"
            :aria-label="a.label"
            :aria-valuetext="a.names[modelValue[a.key]]"
            @input="move(a.key, ($event.target as HTMLInputElement).value)"
          />
        </span>
        <button
          type="button"
          class="mono nudge"
          tabindex="-1"
          aria-hidden="true"
          :disabled="modelValue[a.key] === 2"
          data-test="ben-next"
          @click="step(a.key, 1)"
        >
          ▶
        </button>
      </span>
      <span class="display value" data-test="ben-value">{{ a.names[modelValue[a.key]] }}</span>
      <span class="mono hint" data-test="ben-hint">{{ a.hints[modelValue[a.key]] }}</span>
    </div>
  </div>
</template>

<style scoped>
.axes {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}
.axis {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
}
.label {
  flex: none;
  width: 92px;
  font-size: var(--fs-label);
  color: var(--text-2);
}
.slide {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
/* 이름을 `.arrow`로 두면 base.css의 전역 `.arrow`(44x44 네모 버튼)와 섞여
   내가 안 적은 폭·배경·그림자가 따라붙는다 (2026-11-08) */
.nudge {
  font-size: var(--fs-meta);
  color: var(--text-3);
  background: none;
  border: 0;
  padding: var(--sp-1) var(--sp-2);
  cursor: pointer;
  line-height: 1;
}
.nudge:hover:not(:disabled) {
  color: var(--accent);
}
/* 끝에 닿았음을 커서와 색으로 알린다 — 눌러도 아무 일이 없는 것과는 다르다 */
.nudge:disabled {
  color: var(--raise);
  cursor: default;
}
/* 눈금은 보이는 것, 조작은 그 위에 덮인 투명한 range가 맡는다 —
   브라우저마다 다른 기본 막대를 그리지 않으면서 키보드·낭독기는 그대로 얻는다 */
.track {
  position: relative;
  display: flex;
  gap: var(--sp-1);
}
.notch {
  width: 44px;
  height: 16px;
  border: 1px solid var(--off);
}
.notch.on {
  background: var(--accent);
  border-color: var(--accent);
  box-shadow: 0 0 7px var(--accent);
}
.range {
  position: absolute;
  inset: 0;
  width: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.range:focus-visible {
  opacity: 1;
}
.value {
  flex: none;
  width: 86px;
  font-size: var(--fs-body-sm);
  color: var(--accent);
}
.hint {
  flex: 1 1 0;
  min-width: 0;
  font-size: var(--fs-meta);
  color: var(--text-3);
}
/* 좁으면 라벨과 값을 윗줄로 올리고 눈금이 가로를 다 쓴다 */
@media (max-width: 720px) {
  .axis {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--sp-1) var(--sp-3);
  }
  .label {
    width: auto;
  }
  .value {
    width: auto;
    text-align: right;
  }
  .slide {
    grid-column: 1 / -1;
  }
  .track {
    flex: 1 1 0;
  }
  .notch {
    flex: 1 1 0;
    width: auto;
  }
  .hint {
    grid-column: 1 / -1;
  }
}
</style>
