<script setup lang="ts">
/** 내정보 — 시안 A (위아래) (spec 7.3).
 *
 * 계정은 읽기만 하는 정보라 위에 띠로 깔고, 손대는 이력서에 자리를 몰아준다.
 */
import { computed, ref, watch } from 'vue'
import { useAccountStore } from '@/stores/account'
import { RESUME_SLOTS, type ResumeKind, type ResumeSlot } from '@/services/account'
import PixelModal from '@/components/ui/PixelModal.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import ResumeSlotEditor from './ResumeSlotEditor.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const account = useAccountStore()

const KIND_LABEL: Record<ResumeKind, string> = { admission: '자기소개서', company: '이력서' }

const kind = ref<ResumeKind>('admission')
/** 'new'면 새 칸, 슬롯이면 그 칸 고치기, null이면 편집기 닫힘 */
const editing = ref<ResumeSlot | 'new' | null>(null)

const slots = computed(() => account.slotsOf(kind.value))
const full = computed(() => slots.value.length >= RESUME_SLOTS)
const tierLabel = computed(() => (account.isPremium ? '★ 모모 프리미엄' : '로그인'))

/* 이름·나이 고치기 */
const editingProfile = ref(false)
const name = ref('')
const age = ref<string | number>('')

function startProfile() {
  name.value = account.profile.name ?? ''
  age.value = account.profile.age === null ? '' : String(account.profile.age)
  editingProfile.value = true
}
async function saveProfile() {
  // v-model이 type=number에서 숫자로 바꿔 주므로 문자열로 단정하지 않는다
  const raw = String(age.value).trim()
  const n = Number(raw)
  await account.saveProfile({
    name: name.value.trim() || null,
    age: raw && Number.isFinite(n) ? n : null,
  })
  editingProfile.value = false
}

function pick(next: ResumeKind) {
  kind.value = next
  // 종류가 섞이지 않게 쓰던 편집기는 닫는다
  editing.value = null
}

async function onSave(draft: { title: string; text: string }) {
  const slot = editing.value
  await account.saveResume({
    id: slot && slot !== 'new' ? slot.id : undefined,
    kind: kind.value,
    title: draft.title,
    text: draft.text,
  })
  if (!account.error) editing.value = null
}

async function signOut() {
  await account.signOut()
  emit('close')
}

watch(
  () => props.open,
  (on) => {
    if (!on) return
    kind.value = 'admission'
    editing.value = null
    editingProfile.value = false
    void account.refreshResumes()
  },
)
</script>

<template>
  <PixelModal :open="open" title="내정보" @close="emit('close')">
    <!-- 계정 띠 -->
    <dl class="kv" data-test="me-account">
      <dt class="mono">이메일</dt>
      <dd>{{ account.session?.email }}</dd>

      <dt class="mono">이름 · 나이</dt>
      <dd v-if="!editingProfile">
        {{ account.profile.name ?? '—' }} ·
        {{ account.profile.age === null ? '—' : `${account.profile.age}세` }}
        <button type="button" class="mono link" data-test="me-profile-edit" @click="startProfile">
          고치기
        </button>
      </dd>
      <dd v-else class="prof">
        <input
          v-model="name"
          type="text"
          class="input mono sm"
          placeholder="이름"
          data-test="me-name"
        />
        <input
          v-model="age"
          type="number"
          class="input mono sm age"
          placeholder="나이"
          data-test="me-age"
        />
        <button type="button" class="mono link" data-test="me-profile-save" @click="saveProfile">
          저장
        </button>
      </dd>

      <dt class="mono">등급</dt>
      <dd>
        <span class="mono tag" :class="{ p: account.isPremium }">{{ tierLabel }}</span>
        <span v-if="account.isPremium" class="mono meta">티켓 {{ account.tickets }}장 남음</span>
      </dd>
    </dl>

    <hr class="rule" />

    <!-- 이력서 슬롯 -->
    <div>
      <div class="tabs">
        <button
          type="button"
          class="mono tab"
          :class="{ on: kind === 'admission' }"
          data-test="me-tab-admission"
          @click="pick('admission')"
        >
          대입 · 자기소개서 {{ account.slotsOf('admission').length }}/{{ RESUME_SLOTS }}
        </button>
        <button
          type="button"
          class="mono tab"
          :class="{ on: kind === 'company' }"
          data-test="me-tab-company"
          @click="pick('company')"
        >
          회사 · 이력서 {{ account.slotsOf('company').length }}/{{ RESUME_SLOTS }}
        </button>
      </div>

      <div class="pane">
        <div v-for="s in slots" :key="s.id" class="slot" data-test="slot-row">
          <span class="nm">{{ s.title }}</span>
          <span class="right">
            <span class="mono meta">{{ s.updatedAt.slice(0, 10) }}</span>
            <PixelButton variant="secondary" data-test="slot-open" @click="editing = s">
              열기
            </PixelButton>
            <PixelButton
              variant="secondary"
              data-test="slot-delete"
              @click="account.deleteResume(s.id)"
            >
              삭제
            </PixelButton>
          </span>
        </div>

        <ResumeSlotEditor
          v-if="editing"
          :key="editing === 'new' ? 'new' : editing.id"
          :current="editing === 'new' ? null : editing"
          :label="KIND_LABEL[kind]"
          @save="onSave"
          @cancel="editing = null"
        />

        <template v-else>
          <PixelButton
            variant="secondary"
            :disabled="full"
            data-test="slot-new"
            @click="editing = 'new'"
          >
            ＋ 새 {{ KIND_LABEL[kind] }}
          </PixelButton>
          <p v-if="full" class="mono note" data-test="slot-full-note">
            {{ RESUME_SLOTS }}개를 모두 썼습니다 — 하나를 지워야 새로 만들 수 있습니다
          </p>
        </template>
      </div>
    </div>

    <template #foot>
      <PixelButton variant="secondary" data-test="me-signout" @click="signOut"
        >로그아웃</PixelButton
      >
    </template>
  </PixelModal>
</template>

<style scoped>
.kv {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--sp-3) var(--sp-6);
  margin: 0;
  font-size: var(--fs-body-sm);
}
.kv dt {
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.kv dd {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex-wrap: wrap;
}
.prof .sm {
  max-width: 180px;
}
.prof .age {
  max-width: 100px;
}
.tag {
  font-size: var(--fs-meta);
  border: 2px solid var(--raise);
  padding: 2px var(--sp-2);
  color: var(--text-2);
}
.tag.p {
  border-color: var(--accent);
  color: var(--accent);
}
.meta {
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.link {
  font-size: var(--fs-meta);
  color: var(--accent);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.rule {
  border: 0;
  border-top: 2px solid var(--raise);
  margin: 0;
}
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
  padding: var(--sp-3) var(--sp-5);
  cursor: pointer;
}
.tab.on {
  color: var(--accent);
  border-color: var(--line);
}
.pane {
  border: 2px solid var(--line);
  padding: var(--sp-5);
  margin-top: -2px;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  align-items: stretch;
}
.slot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  border: 2px solid var(--raise);
  padding: var(--sp-3) var(--sp-4);
}
.nm {
  font-size: var(--fs-body-sm);
}
.right {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.note {
  margin: 0;
  font-size: var(--fs-meta);
  color: var(--text-3);
}
</style>
