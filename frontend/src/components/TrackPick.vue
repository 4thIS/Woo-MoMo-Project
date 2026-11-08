<script setup lang="ts">
/** 어느 면접으로 볼까요 — 둘 다 보는 면접관(벤)에서만 쓴다 (2026-11-08에 떼어 냄).
 *
 * 전에는 면접관 고르기 패널 **안에만** 있었다. 그래서 벤을 고르고 패널을 닫으면
 * 트랙을 정할 길이 사라지고, 트랙이 비면 회사 정보 칸도 안 나오고 시작도 막혔다.
 * 되돌릴 길이 "바꾸기를 다시 열기"뿐이라 화면 어디에도 단서가 없었다.
 *
 * 이제 고르기 패널과 준비 화면의 벤 상자가 **같은 것**을 쓴다.
 */
import { useInterviewStore } from '@/stores/interview'
import type { Track } from '@/services/account'

const TRACK_LABEL = { company: '회사', admission: '대입' } as const

const interview = useInterviewStore()
</script>

<template>
  <div class="track" data-test="track-pick">
    <span class="mono q">어느 면접으로 볼까요?</span>
    <button
      v-for="t in ['admission', 'company'] as Track[]"
      :key="t"
      type="button"
      class="mono tbtn"
      :class="{ on: interview.chosenTrack === t }"
      :data-test="`track-${t}`"
      @click="interview.setTrack(t)"
    >
      {{ TRACK_LABEL[t] }}
    </button>
  </div>
</template>

<style scoped>
.track {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-3);
  flex-wrap: wrap;
  border: 2px solid var(--accent);
  padding: var(--sp-3) var(--sp-4);
}
.q {
  font-size: var(--fs-label);
  color: var(--text-2);
}
.tbtn {
  font-size: var(--fs-label);
  background: none;
  color: var(--text-2);
  border: 2px solid var(--line);
  padding: var(--sp-2) var(--sp-4);
  cursor: pointer;
}
.tbtn:hover:not(.on) {
  border-color: var(--accent);
  color: var(--text);
}
.tbtn.on {
  border-color: var(--accent-2);
  color: var(--accent-2);
}
</style>
