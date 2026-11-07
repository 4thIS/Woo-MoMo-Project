<script setup lang="ts">
/** 상단 바 (spec 6절).
 *
 * 면접 화면에서는 숨는다 — 100vh 레이아웃이라 자리가 없고, 면접 중에 보관함을 열 일도 없다.
 * 리포트 화면에서는 보인다. 면접이 끝난 직후가 가입 전환이 일어나는 자리다.
 *
 * "한 번에 하나만 연다"는 규칙을 여기서 지킨다 — 모달 상태가 이 하나뿐이다.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAccountStore } from '@/stores/account'
import { useInterviewStore } from '@/stores/interview'
import { useModalStore } from '@/stores/modal'
import { isAdminPath } from '@/services/route'
import AuthModal from '@/components/account/AuthModal.vue'
import MeModal from '@/components/account/MeModal.vue'
import PremiumModal from '@/components/account/PremiumModal.vue'
import ArchiveModal from '@/components/account/ArchiveModal.vue'
import TicketIcon from '@/components/ui/icons/TicketIcon.vue'
import ArchiveIcon from '@/components/ui/icons/ArchiveIcon.vue'
import MeIcon from '@/components/ui/icons/MeIcon.vue'

const account = useAccountStore()
const interview = useInterviewStore()
const modal = useModalStore()
const onAdmin = isAdminPath()
const shown = computed(() => interview.phase !== 'interview')

/** 판이 깔렸는가. 문서 맨 위에 둔 자리지기가 화면을 벗어나면 참이 된다 —
 *  그 지점이 바가 내용을 덮기 시작하는 곳이다. **scrollTop을 읽지 않는다**
 *  (2026-11-07 철거에서 못 박은 원칙) */
const docked = ref(false)
const sentinel = ref<HTMLElement | null>(null)
let io: IntersectionObserver | null = null
/** 판이 깔렸을 때 왼쪽에 적는 지금 단계 */
const STEP: Record<string, string> = {
  landing: '고르기',
  prepare: '준비',
  interview: '면접',
  report: '리포트',
}

// 바가 사라지는 화면으로 넘어가면 열려 있던 모달도 거둔다
watch(shown, (on) => {
  if (!on) modal.close()
})

onMounted(() => {
  void account.load()
  if (!sentinel.value || typeof IntersectionObserver === 'undefined') return
  io = new IntersectionObserver(([e]) => (docked.value = !e.isIntersecting))
  io.observe(sentinel.value)
})
onBeforeUnmount(() => io?.disconnect())
</script>

<template>
  <!-- 문서 맨 위의 자리지기. 이만큼 내려가면 바가 내용을 덮기 시작하므로 판을 깐다.
       고정이 아닌 보통 흐름에 있어야 해서 바 바깥에 둔다 (2026-11-07) -->
  <div ref="sentinel" class="sentinel" aria-hidden="true" />

  <header v-if="shown" class="topbar" :class="{ docked }" data-test="topbar">
    <!-- 맨 위에서는 비워 둔다 — 히어로 가운데에 이미 큰 이름이 있다. 판이 깔린 뒤에만
         작은 이름과 지금 단계가 들어온다 (2026-11-07) -->
    <div v-if="docked" class="brand" data-test="top-brand">
      <span class="mark" aria-hidden="true" />
      <span class="display name">모두의 모의면접</span>
      <span class="mono step">{{ STEP[interview.phase] }}</span>
    </div>
    <div v-else class="brand" aria-hidden="true" />
    <div class="side">
      <a v-if="onAdmin" href="/" class="mono link press" data-test="top-home">모모로</a>
      <template v-if="account.signedIn">
        <!-- 램프가 지금 프리미엄인지 한눈에 알려 준다. 요금 카드의 램프와 같은 어법 -->
        <button
          type="button"
          class="mono link press premium"
          :class="{ lit: account.isPremium }"
          aria-label="모모 프리미엄"
          data-test="top-premium"
          @click="modal.show('premium')"
        >
          <span class="led" aria-hidden="true" />
          <span class="text">모모 프리미엄</span>
        </button>
        <!-- 남은 티켓은 벤 면접을 시작할 수 있는지 그대로 말해 준다. 0장이면 흐리게 두되 숨기지 않는다.
             누르는 곳이 아니다 — 옆의 "모모 프리미엄"과 버튼 둘로 보여 텍스트로 둔다(이슈 137) -->
        <span
          class="mono tickets"
          :class="{ empty: account.tickets === 0 }"
          :aria-label="`보유 티켓 ${account.tickets}장`"
          data-test="top-tickets"
        >
          <TicketIcon /> {{ account.tickets }}
        </span>
        <!-- 상태(위)와 이동(아래)을 세로줄로 가른다. 프리미엄·티켓은 "지금 내 상태"고
             보관함·내정보는 "가는 곳"이다 (2026-11-07) -->
        <span class="divider" data-test="top-divider" aria-hidden="true" />
        <button
          type="button"
          class="mono link press"
          aria-label="보관함"
          data-test="top-archive"
          @click="modal.show('archive')"
        >
          <ArchiveIcon />
          <span class="label">보관함</span>
        </button>
        <button
          type="button"
          class="mono link press"
          aria-label="내정보"
          data-test="top-me"
          @click="modal.show('me')"
        >
          <MeIcon />
          <span class="label">내정보</span>
        </button>
      </template>
      <button
        v-else
        type="button"
        class="display cta press"
        data-test="top-login"
        @click="modal.show('login')"
      >
        로그인
      </button>
    </div>
  </header>

  <AuthModal :open="modal.open === 'login'" @close="modal.close()" />
  <PremiumModal
    :open="modal.open === 'premium'"
    @close="modal.close()"
    @need-login="modal.show('login')"
  />
  <MeModal :open="modal.open === 'me'" @close="modal.close()" />
  <ArchiveModal
    :open="modal.open === 'archive'"
    @close="modal.close()"
    @need-premium="modal.show('premium')"
  />
</template>

<style scoped>
/* 자리지기. 높이만큼 문서 맨 위를 차지해, 화면들이 따로 --topbar-h만큼 비킬 필요가 없다 */
.sentinel {
  height: var(--topbar-h);
  pointer-events: none;
}
.topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 40;
  /* 아래 화면이 "이만큼은 비켜 간다"고 믿는 높이다 — 토큰과 실제를 어긋나게 두지 않는다.
     **두 상태(떠 있음·판 깔림) 모두 같은 높이다** — 바뀔 때 아래가 밀리면 안 된다 */
  min-height: var(--topbar-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  /* 안쪽을 조금 더 벌린다. 같은 요소인데 답답함이 사라진다 (2026-11-07) */
  padding: var(--sp-3) calc(var(--sp-6) + var(--sp-1));
  pointer-events: none; /* 빈 자리가 아래 화면의 클릭을 막지 않게 */
  /* 기본은 **떠 있다** — 판도 선도 없다. 글자는 제 하드 그림자로 별 위에서 읽힌다 */
  background: none;
}
.topbar .link,
.topbar .tickets,
.topbar .brand .name,
.topbar .brand .step {
  text-shadow: 1px 1px 0 var(--ink);
}
/* 히어로를 지나면 판이 깔린다. 뒤가 비치는 --dock이라 덮은 게 아니라 떠 있는 것으로 읽힌다 */
.topbar.docked {
  background: var(--dock);
  /* 아래 선을 테두리가 아니라 그림자로 긋는다 — 테두리는 높이를 1px 더해
     두 상태의 키가 달라진다 (2026-11-07) */
  box-shadow:
    0 1px 0 var(--raise),
    inset 0 -1px 0 var(--edge-hi);
}
.topbar.docked .link,
.topbar.docked .tickets,
.topbar.docked .brand .name,
.topbar.docked .brand .step {
  text-shadow: none;
}
/* 왼쪽 묶음 — 판이 깔렸을 때만 내용이 찬다. 비어 있어도 자리를 잡아 오른쪽이 끝에 붙는다 */
.brand {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-width: 0;
  pointer-events: auto;
}
.brand .mark {
  width: 20px;
  height: 20px;
  flex: none;
  background: var(--accent);
  box-shadow: 2px 2px 0 var(--ink);
}
.brand .name {
  font-size: var(--fs-body-sm);
  color: var(--text);
  white-space: nowrap;
}
.brand .step {
  font-size: var(--fs-meta);
  color: var(--text-2);
  border: 1px solid var(--off);
  padding: var(--sp-1) var(--sp-2);
  white-space: nowrap;
}
.side {
  display: flex;
  align-items: center;
  gap: var(--sp-5);
  pointer-events: auto;
}
/* 상태 묶음과 이동 묶음을 가르는 한 줄 */
.divider {
  width: 1px;
  height: 20px;
  flex: none;
  background: var(--off);
}
.link .label {
  margin-left: var(--sp-2);
}
/* 좁아지면 접는 대신 **글자를 뗀다** — 한 줄을 지켜야 --topbar-h가 한 값으로 남는다.
   이름은 aria-label로 남아 화면 낭독기가 읽는다 (2026-11-07) */
.topbar,
.side,
.brand {
  flex-wrap: nowrap;
}
@media (max-width: 720px) {
  .link .label,
  .brand .step,
  .premium .text {
    display: none;
  }
  .side {
    gap: var(--sp-4);
  }
}
/* 더 좁으면 이름도 뗀다 — 노란 네모만으로도 어디인지 안다 */
@media (max-width: 480px) {
  .brand .name {
    display: none;
  }
}
.link {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  font-size: var(--fs-label);
  color: var(--text-2);
  background: none;
  border: none;
  cursor: pointer;
  padding: var(--sp-2);
}
.link:hover,
.link:focus-visible {
  color: var(--accent);
}
.tickets {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  /* 버튼이 아니다 — link·press를 떼면서 글자 모양만 맞춘다 */
  font-size: var(--fs-label);
  color: var(--text-2);
  cursor: default;
}
.tickets.empty {
  opacity: 0.5;
}
.premium {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
}
/* 꺼진 램프는 빈 테두리만. 켜지면 채워지고 빛난다 — 요금 카드와 같은 규칙 */
.premium .led {
  width: 10px;
  height: 10px;
  border: 2px solid var(--off);
  background: none;
}
.premium.lit {
  color: var(--accent);
}
.premium.lit .led {
  border-color: var(--accent);
  background: var(--accent);
  box-shadow: 0 0 6px var(--accent);
}
/* 로그인은 비로그인에게 가장 중요한 한 곳인데 글자만 있으면 안내 문구처럼 보인다.
   채우되 **노랑은 쓰지 않는다** — 노랑은 '면접 시작'·'결제하기' 같은 진행용이고,
   한 화면에 노란 버튼이 둘이면 어디를 눌러야 할지 흐려진다. 계정은 민트가 맡는다 */
.cta {
  font-size: var(--fs-body-sm);
  line-height: 1;
  padding: var(--sp-3) var(--sp-5);
  background: var(--accent-2);
  color: var(--bg);
  border: 2px solid var(--accent-2);
  --press-shadow: var(--ink);
  box-shadow: 3px 3px 0 var(--ink);
  cursor: pointer;
}
</style>
