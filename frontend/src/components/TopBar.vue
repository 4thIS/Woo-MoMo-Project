<script setup lang="ts">
/** 상단 바 (spec 6절).
 *
 * 면접 화면에서는 숨는다 — 100vh 레이아웃이라 자리가 없고, 면접 중에 보관함을 열 일도 없다.
 * 리포트 화면에서는 보인다. 면접이 끝난 직후가 가입 전환이 일어나는 자리다.
 *
 * "한 번에 하나만 연다"는 규칙을 여기서 지킨다 — 모달 상태가 이 하나뿐이다.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useAccountStore } from '@/stores/account'
import { useInterviewStore } from '@/stores/interview'
import PixelModal from '@/components/ui/PixelModal.vue'

type Which = 'login' | 'premium' | 'me' | 'archive'

const account = useAccountStore()
const interview = useInterviewStore()
const open = ref<Which | null>(null)
const shown = computed(() => interview.phase !== 'interview')

// 바가 사라지는 화면으로 넘어가면 열려 있던 모달도 거둔다
watch(shown, (on) => {
  if (!on) open.value = null
})

onMounted(() => void account.load())
</script>

<template>
  <header v-if="shown" class="topbar" data-test="topbar">
    <div class="side">
      <button
        v-if="account.signedIn"
        type="button"
        class="mono link press"
        data-test="top-premium"
        @click="open = 'premium'"
      >
        {{ account.isPremium ? '★ 모모 프리미엄' : '모모 프리미엄' }}
      </button>
    </div>
    <div class="side">
      <template v-if="account.signedIn">
        <button
          type="button"
          class="mono link press"
          data-test="top-archive"
          @click="open = 'archive'"
        >
          보관함
        </button>
        <button type="button" class="mono link press" data-test="top-me" @click="open = 'me'">
          내정보
        </button>
      </template>
      <button
        v-else
        type="button"
        class="mono link press"
        data-test="top-login"
        @click="open = 'login'"
      >
        로그인
      </button>
    </div>
  </header>

  <!-- 모달 본체는 Task 5~7에서 채운다. 지금은 껍데기만 열린다 -->
  <PixelModal :open="open !== null" :title="open ?? ''" @close="open = null" />
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
  justify-content: space-between;
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
</style>
