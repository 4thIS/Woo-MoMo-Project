<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAdminStore } from '@/stores/admin'
import PixelButton from '@/components/ui/PixelButton.vue'
import { fmtDate, fmtDateTime, fmtDelta, fmtText } from './format'

const admin = useAdminStore()
const d = computed(() => admin.detail)

// type=number는 v-model이 숫자를 돌려준다(비었을 땐 '') — 문자열로 통일해 본다
const delta = ref<string | number>('')
const reason = ref('')
const confirming = ref(false)

const n = computed(() => Number(delta.value))
const deltaOk = computed(
  () =>
    String(delta.value).trim() !== '' &&
    Number.isInteger(n.value) &&
    n.value !== 0 &&
    Math.abs(n.value) <= 100,
)
const reasonOk = computed(() => {
  const len = reason.value.trim().length
  return len >= 1 && len <= 200
})
const valid = computed(() => deltaOk.value && reasonOk.value)
const signed = computed(() => (n.value > 0 ? `+${n.value}` : String(n.value)))

const ask = () => {
  if (valid.value) confirming.value = true
}
async function go() {
  const ok = await admin.adjustTickets(n.value, reason.value.trim())
  confirming.value = false
  if (ok) {
    delta.value = ''
    reason.value = ''
  }
}
</script>

<template>
  <div v-if="d" class="stack" data-test="admin-detail">
    <PixelButton variant="secondary" data-test="admin-back" @click="admin.closeUser()"
      >목록으로</PixelButton
    >
    <p v-if="admin.error" class="err" role="alert" data-test="admin-error">{{ admin.error }}</p>

    <dl class="kv">
      <dt>이메일</dt>
      <dd>{{ d.user.email }}</dd>
      <dt>이름</dt>
      <dd>{{ d.user.name ?? '—' }}</dd>
      <dt>가입일</dt>
      <dd>{{ fmtDate(d.user.createdAt) }}</dd>
      <dt>티켓</dt>
      <dd data-test="admin-tickets">{{ d.user.tickets }}</dd>
      <dt>마지막 활동</dt>
      <dd>{{ fmtDateTime(d.user.lastActiveAt) }}</dd>
    </dl>

    <section>
      <h3 class="display h3">티켓 조정</h3>
      <form class="adjust" @submit.prevent="ask">
        <label class="field">
          <span class="mono">수량 (−100 ~ 100, 0 제외)</span>
          <input
            v-model="delta"
            type="number"
            step="1"
            min="-100"
            max="100"
            data-test="admin-delta"
            @input="confirming = false"
          />
        </label>
        <label class="field grow">
          <span class="mono">사유 (1~200자)</span>
          <input
            v-model="reason"
            type="text"
            maxlength="200"
            data-test="admin-reason"
            @input="confirming = false"
          />
        </label>
        <PixelButton variant="secondary" :disabled="!valid" data-test="admin-adjust" @click="ask"
          >조정</PixelButton
        >
      </form>
      <div v-if="confirming" class="confirm" role="alertdialog" aria-label="티켓 조정 확인">
        <p data-test="admin-confirm-text">{{ d.user.email }} 계정에 {{ signed }}장 — 진행할까요?</p>
        <PixelButton data-test="admin-confirm" :disabled="admin.loading" @click="go()"
          >진행</PixelButton
        >
        <PixelButton variant="secondary" data-test="admin-cancel" @click="confirming = false"
          >취소</PixelButton
        >
      </div>
    </section>

    <section>
      <h3 class="display h3">벤 면접</h3>
      <div class="scroll">
        <table class="atable">
          <thead>
            <tr>
              <th scope="col">시작</th>
              <th scope="col">트랙</th>
              <th scope="col">상태</th>
              <th scope="col">턴</th>
              <th scope="col">브리핑</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in d.ben" :key="b.id">
              <td>{{ fmtDateTime(b.createdAt) }}</td>
              <td>{{ b.track }}</td>
              <td>{{ b.status }}</td>
              <td>{{ b.modelTurns }}</td>
              <td>{{ b.briefingStatus }}</td>
            </tr>
            <tr v-if="d.ben.length === 0">
              <td colspan="5" class="muted">기록 없음</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <h3 class="display h3">보관 기록</h3>
      <div class="scroll">
        <table class="atable">
          <thead>
            <tr>
              <th scope="col">시작</th>
              <th scope="col">면접관</th>
              <th scope="col">프리미엄</th>
              <th scope="col">트랙</th>
              <th scope="col">질문</th>
              <th scope="col">녹음</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in d.archive" :key="a.id">
              <td>{{ fmtDateTime(a.startedAt) }}</td>
              <td>{{ a.interviewerId }}</td>
              <td>{{ a.premium ? '예' : '아니오' }}</td>
              <td>{{ a.track }}</td>
              <td>{{ a.questionCount }}</td>
              <td>{{ a.hasRecording ? '있음' : '없음' }}</td>
            </tr>
            <tr v-if="d.archive.length === 0">
              <td colspan="6" class="muted">기록 없음</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <h3 class="display h3">조정 이력</h3>
      <div class="scroll">
        <table class="atable">
          <thead>
            <tr>
              <th scope="col">시각</th>
              <th scope="col">관리자</th>
              <th scope="col">수량</th>
              <th scope="col">사유</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(t, i) in d.ticketLog" :key="i" data-test="admin-ticketlog-row">
              <td>{{ fmtDateTime(t.at) }}</td>
              <td>{{ fmtText(t.adminEmail) }}</td>
              <td>{{ fmtDelta(t.delta) }}</td>
              <td>{{ t.reason }}</td>
            </tr>
            <tr v-if="d.ticketLog.length === 0">
              <td colspan="4" class="muted">이력 없음</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
}
.h3 {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-body);
}
.kv {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sp-2) var(--sp-5);
  margin: 0;
}
.kv dt {
  color: var(--text-3);
}
.kv dd {
  margin: 0;
}
.adjust {
  display: flex;
  gap: var(--sp-4);
  align-items: flex-end;
  flex-wrap: wrap;
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  font-size: var(--fs-label);
  color: var(--text-2);
}
.field.grow {
  flex: 1;
  min-width: 200px;
}
.field input {
  padding: var(--sp-3);
  background: var(--bg);
  color: var(--text);
  border: 2px solid var(--line);
  font: inherit;
}
.confirm {
  margin-top: var(--sp-4);
  padding: var(--sp-4);
  border: 2px solid var(--accent);
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  flex-wrap: wrap;
}
.confirm p {
  margin: 0;
  flex: 1;
}
.scroll {
  overflow-x: auto;
}
.err {
  margin: 0;
  color: var(--danger);
}
.muted {
  color: var(--text-3);
}
</style>
