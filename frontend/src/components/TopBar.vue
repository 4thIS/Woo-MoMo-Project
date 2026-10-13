<script setup lang="ts">
/** 상단 바 (spec 6절).
 *
 * 면접 화면에서는 숨는다 — 100vh 레이아웃이라 자리가 없고, 면접 중에 보관함을 열 일도 없다.
 * 리포트 화면에서는 보인다. 면접이 끝난 직후가 가입 전환이 일어나는 자리다.
 *
 * "한 번에 하나만 연다"는 규칙을 여기서 지킨다 — 모달 상태가 이 하나뿐이다.
 */
import { computed, onMounted, watch } from 'vue'
import { useAccountStore } from '@/stores/account'
import { useInterviewStore } from '@/stores/interview'
import { useModalStore } from '@/stores/modal'
import AuthModal from '@/components/account/AuthModal.vue'
import MeModal from '@/components/account/MeModal.vue'
import PremiumModal from '@/components/account/PremiumModal.vue'
import PixelModal from '@/components/ui/PixelModal.vue'

const account = useAccountStore()
const interview = useInterviewStore()
const modal = useModalStore()
const shown = computed(() => interview.phase !== 'interview')

// 바가 사라지는 화면으로 넘어가면 열려 있던 모달도 거둔다
watch(shown, (on) => {
  if (!on) modal.close()
})

onMounted(() => void account.load())
</script>

<template>
  <header v-if="shown" class="topbar" data-test="topbar">
    <div class="side">
      <template v-if="account.signedIn">
        <!-- 램프가 지금 프리미엄인지 한눈에 알려 준다. 요금 카드의 램프와 같은 어법 -->
        <button
          type="button"
          class="mono link press premium"
          :class="{ lit: account.isPremium }"
          data-test="top-premium"
          @click="modal.show('premium')"
        >
          <span class="led" aria-hidden="true" />
          모모 프리미엄
        </button>
        <button
          type="button"
          class="mono link press"
          data-test="top-archive"
          @click="modal.show('archive')"
        >
          보관함
        </button>
        <button type="button" class="mono link press" data-test="top-me" @click="modal.show('me')">
          내정보
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
  <!-- 보관함은 2/2 계획에서 채운다 -->
  <PixelModal :open="modal.open === 'archive'" title="보관함" @close="modal.close()" />
</template>

<style scoped>
.topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--sp-4);
  padding: var(--sp-3) var(--sp-6);
  pointer-events: none; /* 빈 자리가 아래 화면의 클릭을 막지 않게 */
}
.side {
  display: flex;
  align-items: center;
  gap: var(--sp-5);
  pointer-events: auto;
}
.link {
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
