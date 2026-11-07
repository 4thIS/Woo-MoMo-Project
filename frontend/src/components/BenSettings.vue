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
</script>

<template>
  <div class="axes">
    <div v-for="a in axes" :key="a.key" class="axis" data-test="ben-axis">
      <span class="mono label">{{ a.label }}</span>
      <span class="slide">
        <span class="mono arrow" aria-hidden="true">◀</span>
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
        <span class="mono arrow" aria-hidden="true">▶</span>
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
.arrow {
  font-size: var(--fs-meta);
  color: var(--text-3);
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
