<script setup lang="ts">
/** 로그인 / 회원가입 (spec 7.1).
 *
 * 로그인 실패 문구는 "이메일 또는 비밀번호가 올바르지 않습니다" 하나로 뭉친다 — 계정 존재 여부를
 * 흘리지 않기 위해서다. 중복 미리 검사는 **회원가입 탭에서만** 한다(같은 이유).
 */
import { computed, ref, watch } from 'vue'
import { useAccountStore } from '@/stores/account'
import PixelModal from '@/components/ui/PixelModal.vue'
import PixelButton from '@/components/ui/PixelButton.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const account = useAccountStore()

type Mode = 'signin' | 'signup'
const mode = ref<Mode>('signin')
const email = ref('')
const pw = ref('')
const pw2 = ref('')
/** 보내기 전에 걸러낸 것. 서비스 오류와 섞지 않는다 */
const localError = ref('')

const signup = computed(() => mode.value === 'signup')
const error = computed(() => localError.value || account.error?.message || '')
const busy = computed(() => account.loading)

function reset() {
  email.value = ''
  pw.value = ''
  pw2.value = ''
  localError.value = ''
  account.error = null
}

function setMode(next: Mode) {
  mode.value = next
  localError.value = ''
  account.error = null
}

watch(
  () => props.open,
  (on) => {
    if (on) {
      mode.value = 'signin'
      reset()
    }
  },
)

/** 가입 탭에서만. 로그인 탭에서 하면 남의 가입 여부를 알려 주는 꼴이 된다 */
async function onEmailBlur() {
  if (!signup.value || !email.value) return
  if (await account.emailTaken(email.value)) localError.value = '이미 가입된 이메일입니다'
}

async function submit() {
  localError.value = ''
  account.error = null
  if (!email.value || !pw.value) {
    localError.value = '이메일과 비밀번호를 입력하세요'
    return
  }
  if (signup.value && pw.value !== pw2.value) {
    localError.value = '비밀번호가 서로 다릅니다'
    return
  }
  if (signup.value) await account.signUp(email.value, pw.value)
  else await account.signIn(email.value, pw.value)
  if (account.signedIn) emit('close')
}

async function google() {
  await account.signInWithGoogle()
  if (account.signedIn) emit('close')
}
</script>

<template>
  <PixelModal :open="open" :title="signup ? '회원가입' : '로그인'" @close="emit('close')">
    <div class="tabs">
      <button
        type="button"
        class="mono tab"
        :class="{ on: !signup }"
        data-test="auth-tab-signin"
        @click="setMode('signin')"
      >
        로그인
      </button>
      <button
        type="button"
        class="mono tab"
        :class="{ on: signup }"
        data-test="auth-tab-signup"
        @click="setMode('signup')"
      >
        회원가입
      </button>
    </div>

    <form class="form" @submit.prevent="submit">
      <label class="field">
        <span class="mono lab">이메일</span>
        <input
          v-model="email"
          type="email"
          class="input mono"
          autocomplete="email"
          data-test="auth-email"
          @blur="onEmailBlur"
        />
      </label>

      <label class="field">
        <span class="mono lab">비밀번호</span>
        <input
          v-model="pw"
          type="password"
          class="input mono"
          :autocomplete="signup ? 'new-password' : 'current-password'"
          data-test="auth-password"
        />
      </label>

      <label v-if="signup" class="field">
        <span class="mono lab">비밀번호 확인</span>
        <input
          v-model="pw2"
          type="password"
          class="input mono"
          autocomplete="new-password"
          data-test="auth-password2"
        />
      </label>

      <p v-if="error" class="mono err" data-test="auth-error">{{ error }}</p>

      <p v-if="signup" class="mono consent" data-test="auth-consent">
        로그인하면 이력서·면접 대화·리포트가 서버에 저장됩니다. 로그인하지 않으면 이 브라우저를
        떠나지 않습니다.
      </p>

      <div class="acts">
        <PixelButton :disabled="busy" data-test="auth-submit" @click="submit">
          {{ signup ? '가입하고 시작' : '로그인' }}
        </PixelButton>
        <PixelButton variant="secondary" :disabled="busy" data-test="auth-google" @click="google">
          구글로 계속하기
        </PixelButton>
      </div>
    </form>
  </PixelModal>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 0;
}
.tab {
  font-size: var(--fs-label);
  color: var(--text-3);
  background: none;
  border: 2px solid var(--raise);
  border-bottom-width: 0;
  padding: var(--sp-3) var(--sp-6);
  cursor: pointer;
}
.tab.on {
  color: var(--accent);
  border-color: var(--line);
}
.form {
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
  border: 2px solid var(--line);
  padding: var(--sp-6);
  margin-top: -2px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.lab {
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.err {
  margin: 0;
  font-size: var(--fs-meta);
  color: var(--danger);
}
.consent {
  margin: 0;
  font-size: var(--fs-meta);
  color: var(--text-2);
  line-height: 1.7;
}
.acts {
  display: flex;
  gap: var(--sp-3);
  flex-wrap: wrap;
}
</style>
