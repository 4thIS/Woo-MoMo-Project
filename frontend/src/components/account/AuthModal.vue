<script setup lang="ts">
/** 로그인 / 회원가입 (spec 7.1).
 *
 * 로그인 실패 문구는 "이메일 또는 비밀번호가 올바르지 않습니다" 하나로 뭉친다 — 계정 존재 여부를
 * 흘리지 않기 위해서다. 중복 미리 검사는 **회원가입 탭에서만** 한다(같은 이유).
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useAccountStore } from '@/stores/account'
import type { AccountError } from '@/services/account'
import PixelModal from '@/components/ui/PixelModal.vue'
import PixelButton from '@/components/ui/PixelButton.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const account = useAccountStore()

type Mode = 'signin' | 'signup'
const mode = ref<Mode>('signin')
const name = ref('')
const email = ref('')
const pw = ref('')
const pw2 = ref('')
/** 보내기 전에 걸러낸 것. 서비스 오류와 섞지 않는다 */
const localError = ref('')

/* ── 가입 이메일 인증(2026-10-27, 서버가 켠 경우만) ──────────────────── */
const code = ref('')
/** 인증번호를 한 번이라도 받았는가 — 받기 전에는 입력 칸을 띄우지 않는다 */
const codeSent = ref(false)
/** PIN이 살아 있는 남은 초 */
const expiresIn = ref(0)
/** 다시 받기까지 남은 초. 0이어야 버튼이 열린다 */
const resendIn = ref(0)
let ticker: ReturnType<typeof setInterval> | null = null

const verifying = computed(() => signup.value && account.emailVerify)
/** "10:00" — 남은 시간을 분:초로 */
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

function stopTicker() {
  if (ticker) clearInterval(ticker)
  ticker = null
}
function startTicker() {
  stopTicker()
  ticker = setInterval(() => {
    if (expiresIn.value > 0) expiresIn.value--
    if (resendIn.value > 0) resendIn.value--
    if (expiresIn.value === 0 && resendIn.value === 0) stopTicker()
  }, 1000)
}
/** 받아 둔 PIN을 버린다. 이메일이 바뀌면 그 PIN은 더 이상 맞지 않는다 */
function clearCode() {
  code.value = ''
  codeSent.value = false
  expiresIn.value = 0
  resendIn.value = 0
  stopTicker()
}
onBeforeUnmount(stopTicker)

const signup = computed(() => mode.value === 'signup')
/** 스토어의 error를 읽는다. 바로 앞에서 `account.error = null`을 한 자리에서는
 *  직접 참조하면 타입이 null로 좁혀져 버리므로, 한 겹 감싸 끊는다 */
const lastError = (): AccountError | null => account.error
const error = computed(() => {
  if (localError.value) return localError.value
  const e = account.error
  if (!e) return ''
  // 남은 시도 수는 서버만 안다 — 문구에 붙여 "몇 번 더" 를 알려 준다
  if (e.code === 'code_invalid' && typeof e.attemptsLeft === 'number')
    return `${e.message} (${e.attemptsLeft}번 더 시도할 수 있어요)`
  return e.message
})
const busy = computed(() => account.loading)

function reset() {
  name.value = ''
  email.value = ''
  pw.value = ''
  pw2.value = ''
  localError.value = ''
  account.error = null
  clearCode()
}

function setMode(next: Mode) {
  mode.value = next
  // 탭을 오가며 남은 이름이 다음 가입에 따라붙지 않게 비운다
  name.value = ''
  localError.value = ''
  account.error = null
  clearCode()
}

watch(
  () => props.open,
  (on) => {
    if (on) {
      mode.value = 'signin'
      reset()
      // 인증을 쓰는 서버인지 한 번만 묻는다. 실패하면 꺼진 것으로 본다
      void account.loadSignupConfig()
    } else {
      stopTicker()
    }
  },
  { immediate: true },
)

// 이메일이 바뀌면 앞서 받은 PIN은 쓸 수 없다
watch(email, clearCode)

async function sendCode() {
  localError.value = ''
  account.error = null
  if (!email.value.trim()) {
    localError.value = '이메일을 먼저 입력하세요'
    return
  }
  const sent = await account.sendSignupCode(email.value.trim())
  if (!sent) {
    // 너무 자주 눌렀으면 서버가 알려 준 만큼 버튼을 잠근다
    const wait = lastError()?.retryAfterSec
    if (typeof wait === 'number') {
      resendIn.value = wait
      startTicker()
    }
    return
  }
  codeSent.value = true
  code.value = ''
  expiresIn.value = sent.expiresInSec
  resendIn.value = sent.resendInSec
  startTicker()
}

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
  if (signup.value && !name.value.trim()) {
    localError.value = '이름을 입력하세요'
    return
  }
  if (signup.value && pw.value !== pw2.value) {
    localError.value = '비밀번호가 서로 다릅니다'
    return
  }
  if (verifying.value && !code.value.trim()) {
    localError.value = '인증번호를 입력하세요'
    return
  }
  if (signup.value) await account.signUp(email.value, pw.value, name.value, code.value.trim())
  else await account.signIn(email.value, pw.value)
  // 인증번호가 만료·폐기됐으면 다시 받아야 한다 — 남은 숫자를 지워 헷갈리지 않게
  if (lastError()?.code === 'code_expired') clearCode()
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
      <!-- 가입에서만. 대입 면접의 이름 칸을 이 값으로 미리 채운다 -->
      <label v-if="signup" class="field">
        <span class="mono lab">이름</span>
        <input
          v-model="name"
          type="text"
          class="input mono"
          autocomplete="name"
          data-test="auth-name"
        />
      </label>

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

      <!-- 인증을 켠 서버에서만. 메일로 온 6자리를 넣어야 계정이 만들어진다 -->
      <template v-if="verifying">
        <div class="field">
          <span class="mono lab">이메일 인증</span>
          <PixelButton
            variant="secondary"
            :disabled="busy || resendIn > 0"
            data-test="auth-send-code"
            @click="sendCode"
          >
            {{
              resendIn > 0 ? `다시 받기 (${resendIn}초)` : codeSent ? '다시 받기' : '인증번호 받기'
            }}
          </PixelButton>
        </div>

        <label v-if="codeSent" class="field">
          <span class="mono lab">인증번호 6자리</span>
          <input
            v-model="code"
            type="text"
            inputmode="numeric"
            maxlength="6"
            class="input mono"
            autocomplete="one-time-code"
            data-test="auth-code"
          />
          <span class="mono hint" data-test="auth-code-hint">
            {{
              expiresIn > 0
                ? `메일로 보냈습니다 — ${mmss(expiresIn)} 안에 입력하세요`
                : '시간이 지났습니다 — 다시 받아 주세요'
            }}
          </span>
        </label>
      </template>

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
        떠나지 않습니다 (음성 인식 제외).
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
.hint {
  font-size: var(--fs-meta);
  color: var(--text-3);
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
