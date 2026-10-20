<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import SpriteFrame from '@/components/ui/SpriteFrame.vue'
import PixelTag from '@/components/ui/PixelTag.vue'
import { CENTER_FRAME_PX, INTERVIEWERS, type InterviewerId } from '@/interviewers'
import { useInterviewerStore } from '@/stores/interviewer'
import { useModelStore } from '@/stores/model'
import { useAccountStore } from '@/stores/account'
import { useInterviewStore } from '@/stores/interview'
import type { Track } from '@/services/account'

const TRACK_LABEL = { company: '회사', admission: '대입', both: '대입·회사' } as const

/** 카드 캐릭터 배율: 92 × 2 = 184px(정수배 — 픽셀이 고르게) */
const PICKER_SCALE = 2

/**
 * 면접관 고르기(spec 3.1): 카드 클릭·키보드 선택 = 선택 + 포커스 + 미리 듣기(항상 재생).
 * 스피커 버튼·미리 듣기 음소거는 두지 않는다. 랜딩과 준비 화면 "바꾸기"에서 같이 쓴다.
 */
const iv = useInterviewerStore()
const model = useModelStore()
const account = useAccountStore()
/** 고른 트랙은 **면접 스토어가** 가진다. 여기서 복사본을 들고 알리기만 하면
 *  받아 쓰는 화면이 하나라도 잊는 순간 트랙이 비어 시작 버튼이 안 열린다 */
const interview = useInterviewStore()
const emit = defineEmits<{ 'need-premium': [] }>()
const cards = ref<HTMLButtonElement[]>([])
onMounted(() => void iv.probeSprites())

/** 티켓이 있어야 쓸 수 있다. **등급이 아니라 티켓 수**다 — 10장을 다 쓰면 다시 사야 한다 */
const canUsePremium = computed(() => account.signedIn && account.tickets > 0)

function pick(id: InterviewerId) {
  const who = INTERVIEWERS.find((p) => p.id === id)
  // 막는 게 아니라 길을 여는 버튼이다 — 흐리게 하지 않고, 누르면 요금제로 보낸다
  if (who?.premium && !canUsePremium.value) return emit('need-premium')
  // 면접관을 바꾸면 앞서 고른 트랙은 버린다
  interview.setTrack(null)
  void model.chooseInterviewer(id)
  void iv.preview(id)
}

function pickTrack(t: Track) {
  interview.setTrack(t)
}
function onKey(e: KeyboardEvent) {
  const dir =
    e.key === 'ArrowRight' || e.key === 'ArrowDown'
      ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
        ? -1
        : 0
  if (!dir) return
  e.preventDefault()
  const n = INTERVIEWERS.length
  const i = INTERVIEWERS.findIndex((p) => p.id === iv.id)
  const j = i === -1 ? (dir > 0 ? 0 : n - 1) : (i + dir + n) % n
  pick(INTERVIEWERS[j].id)
  void nextTick(() => cards.value[j]?.focus())
}
const tabbable = (id: InterviewerId) => (iv.id === null ? id === INTERVIEWERS[0].id : iv.id === id)
/** 재생 중엔 question만 반복한다(카드에선 집어 들기·내려놓기 없이) */
const sheet = (id: InterviewerId) => {
  const s = iv.spritesFor(id)
  return iv.playingId === id ? s.question : s.idle
}
</script>

<template>
  <div class="picker-wrap">
    <div class="picker" role="radiogroup" aria-label="면접관 고르기" @keydown="onKey">
      <button
        v-for="p in INTERVIEWERS"
        :key="p.id"
        ref="cards"
        type="button"
        role="radio"
        class="card press"
        :class="{ selected: iv.id === p.id, dim: iv.id !== null && iv.id !== p.id }"
        :aria-checked="iv.id === p.id"
        :tabindex="tabbable(p.id) ? 0 : -1"
        :data-test="`interviewer-${p.id}`"
        @click="pick(p.id)"
      >
        <SpriteFrame
          :src="sheet(p.id).file"
          :frame-w="CENTER_FRAME_PX"
          :frame-h="CENTER_FRAME_PX"
          :frames="sheet(p.id).frames"
          :scale="PICKER_SCALE"
          :fps="8"
        />
        <span class="name">{{ p.displayName }}</span>
        <span class="tagline mono">{{ p.name }}</span>
        <span class="mono trk" :class="p.track ?? 'both'">{{
          TRACK_LABEL[p.track ?? 'both']
        }}</span>
        <span v-if="p.premium" class="mono tix" :class="{ lit: canUsePremium }">
          <i aria-hidden="true" />{{ account.signedIn ? `티켓 ${account.tickets}장` : '프리미엄' }}
        </span>
        <PixelTag v-else-if="iv.id === p.id" tone="ok">선택됨</PixelTag>
        <!-- 모서리 리본 — CSS로 그린다. 에셋을 새로 뽑지 않는다 -->
        <span v-if="p.premium" class="ribbon" aria-hidden="true"><i /><b>P</b></span>
      </button>
    </div>
    <!-- 좁은 화면에서 카드가 옆으로 흐르면 몇 명 중 몇 번째인지 보이지 않는다 — 점으로 알린다.
         넓은 화면에서는 네 장이 다 보이므로 CSS로 감춘다 -->
    <div class="dots" aria-hidden="true">
      <i
        v-for="p in INTERVIEWERS"
        :key="p.id"
        data-test="picker-dot"
        :class="{ on: iv.id === p.id }"
      />
    </div>
    <!-- 벤은 둘 다 봐서 고른 뒤에 트랙을 정한다. 정하기 전에는 선택이 끝나지 않는다 -->
    <div v-if="iv.current?.track === null" class="track" data-test="track-pick">
      <span class="mono q">어느 면접으로 볼까요?</span>
      <button
        v-for="t in ['admission', 'company'] as const"
        :key="t"
        type="button"
        class="mono tbtn"
        :class="{ on: interview.chosenTrack === t }"
        :data-test="`track-${t}`"
        @click="pickTrack(t)"
      >
        {{ TRACK_LABEL[t] }}
      </button>
    </div>
    <p v-if="iv.previewFailed" class="mono err" data-test="preview-error">
      미리 듣기를 재생할 수 없습니다
    </p>
    <p class="mono note" data-test="ai-voice-preview">
      면접관 목소리는 AI로 합성한 목소리입니다 (Supertonic 3)
    </p>
  </div>
</template>

<style scoped>
.picker-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  /* 둘 다 필요하다 — min-width만으로는 줄어들 수 있을 뿐이고, 세로 flex 안에서 내용이
     더 넓으면 그대로 삐져나간다. width가 레일을 창 폭에 묶는다 */
  min-width: 0;
  width: 100%;
}
/* 카드 4장을 한 줄로(약 940px), 그보다 좁으면 2×2, 아주 좁으면 한 줄에 하나.
   카드 폭(캐릭터 184px + 여백 ≈ 220px)이 같아 열이 고르게 선다 */
.picker {
  display: grid;
  grid-template-columns: repeat(4, auto);
  justify-content: center;
  gap: var(--sp-5);
}
@media (max-width: 1100px) {
  .picker {
    grid-template-columns: repeat(2, auto);
  }
}
/* 네 장이 다 보이는 화면에서는 점이 알려 줄 것이 없다 */
.dots {
  display: none;
  gap: var(--sp-2);
  justify-content: center;
}
.dots i {
  width: 8px;
  height: 8px;
  background: var(--raise);
  border: 2px solid var(--line);
}
.dots i.on {
  background: var(--accent);
  border-color: var(--accent);
}
/* 휴대폰: 세로로 쌓으면 네 명을 보는 데 1,300px을 내려야 한다 — 한 줄로 세워 옆으로 넘긴다.
   카드가 화면 폭보다 좁아야 '다음 장이 있다'가 보인다 (멘토링 2026-10-12) */
@media (max-width: 640px) {
  .picker {
    grid-auto-flow: column;
    grid-template-columns: none;
    /* 창 폭 기준 — 한 장이 거의 꽉 차되 다음 장 모서리가 보여 '더 있다'를 알린다 */
    grid-auto-columns: 84%;
    justify-content: start;
    gap: var(--sp-3);
    overflow-x: auto;
    /* 레일은 창 폭 안에서만 흐른다 — 안 묶으면 그리드가 그대로 넓어져 스크롤이 생기지 않는다 */
    min-width: 0;
    max-width: 100%;
    scroll-snap-type: x mandatory;
    /* 첫 장과 끝 장도 가운데에 설 수 있게 양끝 여백 */
    padding: var(--sp-2) 8%;
    width: 100%;
    scrollbar-width: none;
  }
  .picker::-webkit-scrollbar {
    display: none;
  }
  .card {
    scroll-snap-align: center;
  }
  /* 옆으로 흐를 때는 고르지 않은 카드를 흐리게 하지 않는다 — 넘겨 보는 중이지 버린 게 아니다 */
  .card.dim {
    opacity: 1;
  }
  .dots {
    display: flex;
  }
}

/* 모서리 리본 — 카드 안쪽에 머물러 여백을 먹지 않는다 */
.ribbon {
  position: absolute;
  top: 0;
  right: 0;
  width: 46px;
  height: 46px;
  overflow: hidden;
  pointer-events: none;
}
.ribbon i {
  position: absolute;
  top: 0;
  right: 0;
  width: 0;
  height: 0;
  border-top: 46px solid var(--accent);
  border-left: 46px solid transparent;
}
.ribbon b {
  position: absolute;
  top: 5px;
  right: 6px;
  font-family: var(--font-display);
  font-size: var(--fs-meta);
  color: var(--bg);
  line-height: 1;
}
.trk {
  font-size: var(--fs-meta);
  border: 2px solid var(--raise);
  padding: 2px var(--sp-2);
  color: var(--text-3);
}
.trk.company {
  border-color: var(--line);
  color: var(--text-2);
}
.trk.admission {
  border-color: var(--accent-2);
  color: var(--accent-2);
}
.trk.both {
  border-color: var(--accent);
  color: var(--accent);
}
/* 티켓 램프 — 요금 카드와 같은 어법 */
.tix {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-meta);
  border: 2px solid var(--off);
  color: var(--text-3);
  padding: 2px var(--sp-2);
}
.tix i {
  width: 8px;
  height: 8px;
  border: 2px solid currentcolor;
  display: block;
}
.tix.lit {
  border-color: var(--accent);
  color: var(--accent);
}
.tix.lit i {
  background: var(--accent);
  box-shadow: 0 0 5px var(--accent);
}
.track {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-3);
  flex-wrap: wrap;
  border: 2px solid var(--accent);
  padding: var(--sp-3) var(--sp-4);
}
.track .q {
  font-size: var(--fs-meta);
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
.tbtn.on {
  border-color: var(--accent-2);
  color: var(--accent-2);
}
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-4);
  background: var(--raise);
  color: var(--text);
  border: 2px solid var(--line);
  --press-shadow: var(--raise);
  box-shadow: 4px 4px 0 var(--press-shadow);
  cursor: pointer;
  transition:
    transform var(--dur-1) var(--ease),
    opacity var(--dur-1) var(--ease);
}
.card.selected {
  border-color: var(--accent);
  transform: scale(1.08);
}
.card.dim {
  opacity: 0.55;
}
.name {
  font-size: var(--fs-label);
}
.tagline {
  font-size: var(--fs-meta);
  color: var(--text-2);
}
.err {
  margin: 0;
  color: var(--danger);
  font-size: var(--fs-meta);
}
.note {
  margin: 0;
  color: var(--text-3);
  font-size: var(--fs-meta);
}
</style>
