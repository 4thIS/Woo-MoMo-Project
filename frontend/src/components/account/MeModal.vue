<script setup lang="ts">
/** 내정보 (2026-11-07 개편).
 *
 * 윗덩이는 셋이다: **신원**(초상+이름 줄+이메일) · **티켓 칸** · **보관함 칸**.
 * 라벨-값 목록(`dl.kv`) 하나에 성격이 다른 셋을 담던 것을 걷었다 —
 * 두 글자짜리 나이가 이메일과 같은 폭을 받아 허전했다.
 *
 * 남는 자리는 **이미 있는 값**으로만 채운다. 가입일·누적 면접 횟수는 서버가 주지 않는다.
 */
import { computed, ref, watch } from 'vue'
import { useAccountStore } from '@/stores/account'
import { RESUME_SLOTS, type ResumeKind, type ResumeSlot } from '@/services/account'
import PixelModal from '@/components/ui/PixelModal.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import SpriteFrame from '@/components/ui/SpriteFrame.vue'
import ResumeSlotEditor from './ResumeSlotEditor.vue'
import { useModalStore } from '@/stores/modal'
import { ARCHIVE_LIMIT } from '@/utils/archive'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const account = useAccountStore()
const modal = useModalStore()

/** 지원자 초상. 시트가 44px이라 2배(88px)가 정수 배율이다 — 시안의 72px은 아니다 */
const PORTRAIT = { src: '/sprites/look_up.png', w: 44, frames: 12, scale: 2 }

const KIND_LABEL: Record<ResumeKind, string> = { admission: '자기소개서', company: '이력서' }

const kind = ref<ResumeKind>('admission')
/** 'new'면 새 칸, 슬롯이면 그 칸 고치기, null이면 편집기 닫힘 */
const editing = ref<ResumeSlot | 'new' | null>(null)

const slots = computed(() => account.slotsOf(kind.value))
/** 지울지 묻고 있는 슬롯 id. 지운 이력서는 되돌릴 수 없다 */
const asking = ref<string | null>(null)
/** 열려 있는 ··· 하나. 둘이 열리면 어느 줄을 지우는지 흐려진다 */
const moreOpen = ref<string | null>(null)
// 탭을 바꾸면 묻던 것도 열린 메뉴도 풀린다 — 보이지 않는 줄을 지우게 두지 않는다
watch(kind, () => {
  asking.value = null
  moreOpen.value = null
})

async function removeSlot(id: string) {
  asking.value = null
  moreOpen.value = null
  await account.deleteResume(id)
}
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
    <!-- 윗덩이 셋: 신원 · 티켓 · 보관함 -->
    <div class="top" data-test="me-account">
      <div class="who">
        <SpriteFrame
          class="portrait"
          data-test="me-portrait"
          :src="PORTRAIT.src"
          :frame-w="PORTRAIT.w"
          :frame-h="PORTRAIT.w"
          :frames="PORTRAIT.frames"
          :scale="PORTRAIT.scale"
        />
        <div class="lines">
          <p class="identity" data-test="me-identity">
            <template v-if="!editingProfile">
              <template v-if="account.profile.name || account.profile.age !== null">
                <span class="nm">{{ account.profile.name ?? '이름 없음' }}</span>
                <span v-if="account.profile.age !== null" class="mono">
                  {{ account.profile.age }}세
                </span>
              </template>
              <!-- 가입 직후에는 `— · —`만 떠 허전해지는 자리다 -->
              <span v-else class="mono dim">면접 중에 쓸 이름과 나이를 적어 두세요</span>
              <span class="mono tag" :class="{ p: account.isPremium }">{{ tierLabel }}</span>
              <button
                type="button"
                class="mono link"
                data-test="me-profile-edit"
                @click="startProfile"
              >
                고치기
              </button>
            </template>
            <template v-else>
              <input
                v-model="name"
                type="text"
                class="input mono sm nm-in"
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
              <button
                type="button"
                class="mono link"
                data-test="me-profile-save"
                @click="saveProfile"
              >
                저장
              </button>
            </template>
          </p>
          <p class="mono mail">{{ account.session?.email }}</p>
        </div>
      </div>

      <!-- 상자 하나를 숫자 하나가 채운다 -->
      <div class="stat" data-test="me-tickets">
        <span class="mono lbl">남은 티켓</span>
        <span class="mono big">{{ account.tickets }}</span>
        <PixelButton variant="secondary" data-test="me-buy" @click="modal.show('premium')">
          티켓 더 사기
        </PixelButton>
      </div>
      <div class="stat" data-test="me-archive-count">
        <span class="mono lbl">보관함</span>
        <span class="mono big">{{ account.archive.length }}</span>
        <span class="mono note">무료는 {{ ARCHIVE_LIMIT }}개까지</span>
      </div>
    </div>

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
        <div class="slots">
          <div v-for="s in slots" :key="s.id" class="card" data-test="slot-card">
            <span class="nm">{{ s.title }}</span>
            <!-- 제목만으로는 어느 것이 긴지 모른다 -->
            <span class="mono meta">{{ s.text.length.toLocaleString() }}자</span>
            <div class="acts">
              <PixelButton variant="secondary" data-test="slot-open" @click="editing = s">
                열기
              </PixelButton>
              <!-- 지우기는 이 안에 넣는다 — 되돌릴 수 없는 일이 열기와 같은 무게로 보이면 안 된다 -->
              <button
                type="button"
                class="mono more"
                data-test="slot-more"
                aria-label="더 보기"
                :aria-expanded="moreOpen === s.id"
                @click="moreOpen = moreOpen === s.id ? null : s.id"
              >
                ···
              </button>
            </div>
            <div v-if="moreOpen === s.id" class="menu">
              <template v-if="asking === s.id">
                <span class="mono ask" data-test="slot-delete-ask">
                  지울까요? 되돌릴 수 없습니다
                </span>
                <!-- 강조는 안전한 쪽에 준다 -->
                <PixelButton data-test="slot-delete-cancel" @click="asking = null">
                  그대로 두기
                </PixelButton>
                <PixelButton
                  variant="secondary"
                  data-test="slot-delete-confirm"
                  @click="removeSlot(s.id)"
                >
                  삭제
                </PixelButton>
              </template>
              <button
                v-else
                type="button"
                class="mono del"
                data-test="slot-delete"
                @click="asking = s.id"
              >
                지우기
              </button>
            </div>
          </div>

          <!-- 빈 칸은 점선 **하나**. 여럿 늘어놓으면 "다 비었다"처럼 읽힌다.
               꽉 찼으면 칸 자체가 없다 — 눌렀다 거절당하지 않게 -->
          <button
            v-if="!full && !editing"
            type="button"
            class="card empty"
            data-test="slot-empty"
            @click="editing = 'new'"
          >
            <span class="plus">＋</span>
            <span class="mono">새 {{ KIND_LABEL[kind] }}</span>
            <span class="mono meta">{{ RESUME_SLOTS - slots.length }}칸 남음</span>
          </button>
        </div>

        <ResumeSlotEditor
          v-if="editing"
          :key="editing === 'new' ? 'new' : editing.id"
          :current="editing === 'new' ? null : editing"
          :label="KIND_LABEL[kind]"
          @save="onSave"
          @cancel="editing = null"
        />

        <p v-if="full && !editing" class="mono note" data-test="slot-full-note">
          {{ RESUME_SLOTS }}개를 모두 썼습니다 — 하나를 지워야 새로 만들 수 있습니다
        </p>
      </div>
    </div>

    <template #foot>
      <!-- 계정 삭제는 이번 범위가 아니다 — 안내 문장만 둔다 -->
      <span class="mono leave">계정을 지우려면 메일로 알려 주세요</span>
      <!-- 상단바에서 옮겨 왔다 — 쓰는 사람이 둘뿐이라 평소에 보일 이유가 없다 (2026-11-07) -->
      <a v-if="account.session?.isAdmin" href="/admin" class="mono link press" data-test="me-admin"
        >관리자 화면</a
      >
      <PixelButton variant="secondary" class="signout" data-test="me-signout" @click="signOut"
        >로그아웃</PixelButton
      >
    </template>
  </PixelModal>
</template>

<style scoped>
.top {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: var(--sp-4);
  align-items: stretch;
}
/* 신원도 숫자 칸과 같은 꼴로 둔다 — 상자 없이 두면 남는 자리가 "빈 화면"으로 읽힌다 */
.who {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  min-width: 0;
  padding: var(--sp-3) var(--sp-4);
  border: var(--win-border);
  background: var(--win);
}
.lines {
  min-width: 0;
}
.identity {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-3);
  margin: 0;
  font-size: var(--fs-body-sm);
  /* 보기와 고치기의 줄 높이를 묶는다 — 칸이 생길 때 초상이 따라 움직이면 안 된다.
     52px은 .input.sm의 실제 높이다 */
  min-height: 52px;
}
/* 칸은 내용 길이만큼. 두 글자 나이가 이메일과 같은 폭을 받으면 허전해 보인다 */
.nm-in {
  width: 92px;
}
/* 스피너를 끄지 않으면 좁은 칸에서 그것이 숫자를 밀어낸다 — 두 글자가 안 보였다 */
.age {
  width: 56px;
  appearance: textfield;
  -moz-appearance: textfield;
}
.age::-webkit-outer-spin-button,
.age::-webkit-inner-spin-button {
  appearance: none;
  margin: 0;
}
.dim {
  color: var(--text-3);
}
.mail {
  margin: var(--sp-1) 0 0;
  font-size: var(--fs-meta);
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-width: 132px;
  padding: var(--sp-3) var(--sp-4);
  border: var(--win-border);
  background: var(--win);
}
.stat .lbl,
.stat .note {
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.big {
  font-size: 34px;
  line-height: 1;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
@media (max-width: 640px) {
  .top {
    grid-template-columns: 1fr;
  }
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
/* 칸을 모양으로 보여 준다 — 목록 행이면 몇 칸이 남았는지 숫자로만 알 수 있었다 */
.slots {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-3);
}
.card {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-3);
  border: var(--win-border);
  background: var(--win);
  min-width: 0;
  text-align: left;
}
.card .nm {
  font-size: var(--fs-body-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card .meta {
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.acts {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: auto;
}
.more {
  margin-left: auto;
  background: none;
  border: 2px solid var(--raise);
  color: var(--text-3);
  cursor: pointer;
  padding: 0 var(--sp-2);
  line-height: 1.6;
}
.more:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.menu {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding-top: var(--sp-2);
  border-top: 2px solid var(--raise);
}
.del {
  background: none;
  border: 2px solid var(--danger);
  color: var(--danger);
  cursor: pointer;
  padding: var(--sp-1) var(--sp-2);
}
/* 빈 칸은 점선 하나 */
.card.empty {
  border-style: dashed;
  background: none;
  align-items: flex-start;
  color: var(--text-3);
  cursor: pointer;
}
.card.empty:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.card.empty .plus {
  font-size: var(--fs-h3);
}
/* 묻는 동안만 나오는 한 줄 */
.ask {
  font-size: var(--fs-meta);
  color: var(--danger);
}
/* 좁으면 1열. 이때도 빈 칸은 하나다 */
@media (max-width: 640px) {
  .slots {
    grid-template-columns: 1fr;
  }
}
.note {
  margin: 0;
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.leave {
  margin-right: auto;
  font-size: var(--fs-meta);
  color: var(--text-3);
}
/* 나가는 길은 평범한 버튼 모양으로 두지 않는다 */
.signout {
  border-color: var(--danger);
  color: var(--danger);
}
</style>
