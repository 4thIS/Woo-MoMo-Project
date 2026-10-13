<script setup lang="ts">
/** 모모 프리미엄 — 등급 비교표 + 토스 결제 목업 (spec 7.2).
 *
 * 결제는 가짜지만 **결과는 진짜**다 — 끝나면 프리미엄이 켜지고 티켓 10장이 들어온다.
 * 흉내는 내되 속이지 않는다: 성공 화면에 "실제 결제가 아닙니다"를 적는다.
 */
import { computed, ref, watch } from 'vue'
import { useAccountStore } from '@/stores/account'
import { PLAN_COLUMNS, PLAN_ROWS, planKeyOf } from '@/utils/plans'
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
  <PixelModal :open="open" title="모모 프리미엄" width="wide" @close="emit('close')">
    <!-- 1) 비교표 -->
    <template v-if="step === 'compare'">
      <table class="plans">
        <thead>
          <tr>
            <th class="lab"></th>
            <th
              v-for="c in PLAN_COLUMNS"
              :key="c.key"
              class="mono col"
              :class="{ now: c.key === now }"
              data-test="plan-col"
            >
              {{ c.label }}
              <span v-if="c.key === now" class="mono tag">지금</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in PLAN_ROWS" :key="r.label" data-test="plan-row">
            <th class="lab">{{ r.label }}</th>
            <td
              v-for="c in PLAN_COLUMNS"
              :key="c.key"
              class="mono cell"
              :class="{ now: c.key === now }"
            >
              {{ r.cells[c.key] }}
            </td>
          </tr>
        </tbody>
      </table>
      <div class="acts">
        <PixelButton data-test="premium-start" @click="start">{{ startLabel }}</PixelButton>
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
.plans {
  border-collapse: collapse;
  width: 100%;
}
.plans th,
.plans td {
  border-bottom: 2px solid var(--raise);
  padding: var(--sp-3) var(--sp-4);
  text-align: center;
  vertical-align: middle;
}
.lab {
  text-align: left;
  font-weight: 400;
  font-size: var(--fs-body-sm);
  color: var(--text-2);
}
.col {
  font-size: var(--fs-label);
  color: var(--text-3);
  white-space: nowrap;
}
.col.now,
.cell.now {
  color: var(--accent);
  background: var(--raise);
}
.cell {
  font-size: var(--fs-meta);
  color: var(--text-2);
}
.tag {
  display: block;
  font-size: var(--fs-meta);
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
