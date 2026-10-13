<script setup lang="ts">
/** 모모 프리미엄 — 등급 비교표 + 토스 결제 목업 (spec 7.2).
 *
 * 결제는 가짜지만 **결과는 진짜**다 — 끝나면 프리미엄이 켜지고 티켓 10장이 들어온다.
 * 흉내는 내되 속이지 않는다: 성공 화면에 "실제 결제가 아닙니다"를 적는다.
 */
import { computed, ref, watch } from 'vue'
import { useAccountStore } from '@/stores/account'
import { PLAN_FEATURES, PLAN_TIERS, litCount, planKeyOf } from '@/utils/plans'
import { PREMIUM_TICKETS } from '@/services/account'
import PixelModal from '@/components/ui/PixelModal.vue'
import PixelButton from '@/components/ui/PixelButton.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; 'need-login': [] }>()

const account = useAccountStore()

type Step = 'compare' | 'pay' | 'paying' | 'done'
const step = ref<Step>('compare')
/** 처리 중 가드 — 결제 버튼 연타로 티켓이 20장이 되지 않게 */
let paying = false

/** 토스 결제창을 흉내 내는 대기 */
const PAY_MS = 2000

const now = computed(() => planKeyOf(account.tier))
const startLabel = computed(() => (account.isPremium ? '티켓 더 받기' : '프리미엄 시작하기'))

watch(
  () => props.open,
  (on) => {
    if (on) {
      step.value = 'compare'
      paying = false
    }
  },
)

function start() {
  if (!account.signedIn) return emit('need-login')
  step.value = 'pay'
}

async function pay() {
  if (paying) return
  paying = true
  step.value = 'paying'
  await new Promise((r) => setTimeout(r, PAY_MS))
  await account.purchasePremium()
  paying = false
  step.value = 'done'
}
</script>

<template>
  <PixelModal
    :open="open"
    :title="step === 'compare' ? undefined : '모모 프리미엄 요금제'"
    :chrome="step !== 'compare'"
    width="wide"
    @close="emit('close')"
  >
    <!-- 판을 뺀 비교 단계는 제목 줄을 직접 둔다 -->
    <template v-if="step === 'compare'" #head>
      <header class="bare-head">
        <h2 class="display btitle">모모 프리미엄 요금제</h2>
        <button type="button" class="mono x" data-test="modal-close" @click="emit('close')">
          닫기 ✕
        </button>
      </header>
    </template>
    <!-- 1) 요금 카드 — 세 칸이 같은 목록을 같은 순서로 보여 주고 되는 것만 불이 들어온다 -->
    <template v-if="step === 'compare'">
      <div class="cards">
        <section
          v-for="(t, i) in PLAN_TIERS"
          :key="t.key"
          class="card"
          :class="{ here: t.key === now, best: t.key === 'premium' }"
          :style="{ '--i': i }"
          data-test="plan-card"
        >
          <span v-if="t.key === now" class="mono badge">지금 여기</span>
          <span v-else-if="t.key === 'premium'" class="mono badge">★ 전부 켜짐</span>

          <header class="chead">
            <h3 class="display nm">{{ t.label }}</h3>
            <p class="mono pr">{{ t.price }}</p>
          </header>

          <p class="mono count" data-test="plan-count">
            <span class="meter" aria-hidden="true">
              <i v-for="(f, n) in PLAN_FEATURES" :key="n" :class="{ f: f.on[t.key] }" />
            </span>
            <b>{{ litCount(t.key) }}</b> / {{ PLAN_FEATURES.length }}
          </p>

          <ul class="feats">
            <li
              v-for="f in PLAN_FEATURES"
              :key="f.label"
              :class="f.on[t.key] ? 'on' : 'off'"
              data-test="plan-feat"
            >
              <span class="led" aria-hidden="true" />
              <span class="txt">
                <span class="nm">{{ f.label }}</span>
                <span class="mono val">{{ f.note[t.key] ?? '' }}</span>
              </span>
            </li>
          </ul>

          <PixelButton v-if="t.key === 'premium'" data-test="premium-start" @click="start">
            {{ startLabel }}
          </PixelButton>
        </section>
      </div>
    </template>

    <!-- 2) 결제 목업 -->
    <div v-else-if="step === 'pay' || step === 'paying'" class="pay">
      <p class="display amount">모모 프리미엄 · 티켓 {{ PREMIUM_TICKETS }}회</p>
      <dl class="kv mono">
        <dt>결제 수단</dt>
        <dd>토스페이</dd>
        <dt>결제 금액</dt>
        <dd>4,900원</dd>
      </dl>
      <p class="mono note">※ 데모입니다. 실제로 결제되지 않습니다.</p>
      <div class="acts">
        <PixelButton :disabled="step === 'paying'" data-test="pay-confirm" @click="pay">
          {{ step === 'paying' ? '처리 중…' : '결제하기' }}
        </PixelButton>
      </div>
    </div>

    <!-- 3) 완료 -->
    <div v-else class="pay" data-test="pay-done">
      <p class="display amount">결제가 끝났습니다</p>
      <p class="mono">
        티켓 {{ PREMIUM_TICKETS }}장이 들어왔습니다 — 이제 벤과 면접할 수 있습니다.
      </p>
      <p class="mono note">※ 실제 결제가 아닙니다 (데모)</p>
      <div class="acts">
        <PixelButton data-test="pay-close" @click="emit('close')">닫기</PixelButton>
      </div>
    </div>
  </PixelModal>
</template>

<style scoped>
.bare-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-5);
}
.btitle {
  margin: 0;
  font-size: var(--fs-h2);
}
.x {
  font-size: var(--fs-label);
  color: var(--text-3);
  background: none;
  border: none;
  cursor: pointer;
}
.x:hover,
.x:focus-visible {
  color: var(--text);
}

.cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-4);
}
/* 세로로 쌓으면 길이가 세 배가 된다. 휴대폰 폭이 될 때까지 3단을 버틴다 */
@media (max-width: 620px) {
  .cards {
    grid-template-columns: 1fr;
  }
}
/* 판을 뺀 만큼 카드가 바탕색을 직접 깐다. 치수는 8줄이 스크롤 없이 들어가게 줄였다 */
.card {
  background-color: var(--win);
  background-image: repeating-linear-gradient(transparent 0 2px, var(--scan) 2px 4px);
  border: 2px solid var(--raise);
  padding: clamp(10px, 1.7vh, 16px) clamp(12px, 1.4vw, 20px);
  display: flex;
  flex-direction: column;
  gap: clamp(6px, 1.1vh, 12px);
}
/* 왼쪽부터 차례로 들어온다 */
@media (prefers-reduced-motion: no-preference) {
  .card {
    animation: deal var(--dur-3) var(--ease) backwards;
    animation-delay: calc(var(--i) * 80ms);
  }
}
@keyframes deal {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
}
.card.here {
  border-color: var(--line);
  background: var(--raise);
}
.card.best {
  border-color: var(--accent);
  box-shadow: 4px 4px 0 var(--ink);
}
.badge {
  font-size: var(--fs-meta);
  border: 2px solid var(--line);
  padding: 2px var(--sp-2);
  color: var(--text-2);
  align-self: flex-start;
}
.card.best .badge {
  border-color: var(--accent);
  color: var(--accent);
}
.chead {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.chead .nm {
  margin: 0;
  font-size: clamp(15px, 2.2vh, 20px);
}
.chead .pr {
  margin: 0;
  font-size: var(--fs-meta);
  color: var(--text-3);
}
/* 눈금 — 목록을 읽기 전에 차이가 숫자로 먼저 보인다 */
.count {
  margin: 0;
  font-size: var(--fs-meta);
  color: var(--text-3);
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.count b {
  font-weight: 400;
  color: var(--accent-2);
}
.card.best .count b {
  color: var(--accent);
}
.meter {
  display: flex;
  gap: 3px;
}
.meter i {
  width: clamp(6px, 1vh, 9px);
  height: clamp(6px, 1vh, 9px);
  display: block;
  background: var(--off);
}
.meter i.f {
  background: var(--accent-2);
}
.card.best .meter i.f {
  background: var(--accent);
}

.feats {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  flex: 1;
}
.feats li {
  display: grid;
  grid-template-columns: 16px 1fr;
  gap: var(--sp-3);
  align-items: start;
  padding: clamp(3px, 0.95vh, 8px) 0;
  border-top: 2px solid var(--raise);
}
.feats li:first-child {
  border-top: 0;
}
.txt {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.txt .nm {
  font-size: clamp(12px, 1.7vh, 14px);
  line-height: 1.35;
}
.txt .val {
  font-size: clamp(10px, 1.4vh, 13px);
  line-height: 1.35;
  /* 꺼진 줄은 내용이 없어도 자리를 지킨다 — 세 카드의 줄이 어긋나면 비교가 안 된다 */
  min-height: 1.35em;
}
/* 화면이 낮으면 보조 설명을 접는다. 글자를 더 줄이는 것보다 낫다 —
   목록과 램프는 그대로라 비교는 계속 된다 */
@media (max-height: 680px), (max-width: 860px) {
  .txt .val {
    display: none;
  }
}
/* 램프. 색을 color로 두고 테두리·채움·빛을 currentColor로 받아 한 곳만 바꾸면 된다 */
.led {
  width: clamp(9px, 1.4vh, 12px);
  height: clamp(9px, 1.4vh, 12px);
  margin-top: 3px;
  border: 2px solid currentcolor;
  color: var(--off);
}
.on .led {
  color: var(--accent-2);
  background: currentcolor;
  box-shadow: 0 0 6px currentcolor;
}
.card.best .on .led {
  color: var(--accent);
}
.on .nm {
  color: var(--text);
}
.on .val {
  color: var(--accent-2);
}
.card.best .on .val {
  color: var(--accent);
}
.off .nm {
  color: var(--off-text);
}
.off .val {
  color: var(--off);
}
@media (prefers-reduced-motion: no-preference) {
  .led {
    transition: all var(--dur-2) var(--ease);
  }
}

.card :deep(.btn) {
  height: clamp(40px, 6vh, 52px);
  width: 100%;
  justify-content: center;
  font-size: clamp(14px, 2vh, 18px);
}

.pay {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  border: 2px solid var(--line);
  padding: var(--sp-8);
  align-items: flex-start;
}
.amount {
  margin: 0;
  font-size: var(--fs-h2);
}
.kv {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--sp-2) var(--sp-6);
  margin: 0;
  font-size: var(--fs-label);
}
.kv dt {
  color: var(--text-3);
}
.kv dd {
  margin: 0;
}
.note {
  margin: 0;
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.acts {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-3);
  width: 100%;
}
</style>
