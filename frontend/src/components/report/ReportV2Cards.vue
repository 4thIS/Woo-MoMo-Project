<script setup lang="ts">
/** 벤 리포트 버전 2 본문. 리포트 화면과 보관함 상세가 **같은 것**을 보여 준다.
 *
 * 서버가 준 글은 전부 텍스트 바인딩으로만 그린다(`docs/API.md`: 보관함은 받은 그대로 돌려주므로
 * 클라이언트가 이스케이프한다). 강조는 `splitEmphasis`가 조각으로 갈라 준 것만 굵게 한다.
 */
import { scrollToId } from '@/utils/anchorScroll'
import { computed } from 'vue'
import ProfileHex from './ProfileHex.vue'
import { splitEmphasis } from '@/utils/reportParser'
import {
  itemsInOrder,
  type Measurements,
  type ReportV2,
  type Voice,
  type VoiceFlag,
  type VoiceLevel,
} from '@/utils/reportV2'
import PixelWindow from '@/components/ui/PixelWindow.vue'

const props = defineProps<{ report: ReportV2 }>()

const items = computed(() => itemsInOrder(props.report.items))
const sm = computed(() => props.report.summary)
/** 쓸 말이 하나도 없으면 빈 칸을 띄우지 않는다 */
const hasSummary = computed(
  () =>
    sm.value.strengths.length > 0 ||
    sm.value.improvements.length > 0 ||
    !!sm.value.delivery ||
    !!sm.value.postingFit,
)

/** 숫자 옆 판정을 괄호로. 한쪽이 없으면 있는 쪽만 */
function withGrade(value: string | number | null, grade: string | null): string {
  if (value === null || value === '') return grade ?? '—'
  return grade ? `${value} (${grade})` : String(value)
}
function fillerText(m: Measurements): string {
  const f = m.filler
  if (!f) return '—'
  // 브라우저 판정만 있으면 센 적이 없다. 0회라고 적으면 거짓말이 된다
  const parts = [f.level]
  if (f.count !== null) parts.push(`${f.count}회`)
  if (f.examples.length) parts.push(f.examples.join(', '))
  return parts.join(' · ')
}
const sec = (v: number | null) => (v === null ? '—' : `${v}초`)

/** 정상 범위로 읽히는 말. 이 밖은 "눈에 띄는 것"으로 본다 */
const PLAIN_LEVELS = new Set(['보통', '좋음', '적음', '없음', '차분'])
const VOICE_LABEL = {
  confidence: '자신감',
  tone: '어조',
  tremor: '떨림',
  trailingOff: '끝 흐려짐',
  clarity: '발음',
} as const

/** 고칠 거리가 되는 축인가. 접기의 유일한 기준이다 (2026-11-07) */
function said(v: VoiceLevel | VoiceFlag): string {
  return 'present' in v ? (v.present ? '있음' : '없음') : v.level
}
function isFlag(v: VoiceLevel | VoiceFlag): boolean {
  return 'present' in v ? v.present : !PLAIN_LEVELS.has(v.level)
}
const axes = (voice: Voice) =>
  (Object.keys(VOICE_LABEL) as (keyof typeof VOICE_LABEL)[]).map((k) => ({
    label: VOICE_LABEL[k],
    said: said(voice[k]),
    reason: voice[k].reason,
    flag: isFlag(voice[k]),
  }))
/** 근거까지 펼칠 축 */
const flags = (voice: Voice) => axes(voice).filter((a) => a.flag)
/** 이름만 한 줄로 모을 축 */
const plain = (voice: Voice) =>
  axes(voice)
    .filter((a) => !a.flag)
    .map((a) => `${a.label} ${a.said}`)

/** 숫자는 바닥 한 줄로 편다 — 표 다섯 줄이 카드마다 반복되면 피드백보다 길어진다 */
function numbersLine(m: Measurements): string {
  return [
    withGrade(m.syllablesPerMin, m.speed),
    m.pause ? `쉼 ${m.pause}` : null,
    m.firstWordSec === null ? null : `첫마디 ${sec(m.firstWordSec)}`,
    fillerText(m),
  ]
    .filter(Boolean)
    .join(' · ')
}
</script>

<template>
  <PixelWindow v-if="hasSummary" title="총평" data-test="summary">
    <dl class="kv">
      <template v-if="sm.strengths.length">
        <dt class="mono">강점</dt>
        <dd>
          <ul class="points">
            <li v-for="(p, i) in sm.strengths" :key="i">
              {{ p.point }}
              <span v-if="p.refs.length" class="refs mono">
                <a
                  v-for="r in p.refs"
                  :key="r"
                  :href="`#item-${r}`"
                  @click.prevent="scrollToId(`item-${r}`)"
                  >{{ r }}</a
                >
              </span>
            </li>
          </ul>
        </dd>
      </template>
      <template v-if="sm.improvements.length">
        <dt class="mono">개선점</dt>
        <dd>
          <ul class="points">
            <li v-for="(p, i) in sm.improvements" :key="i">
              {{ p.point }}
              <span v-if="p.refs.length" class="refs mono">
                <a
                  v-for="r in p.refs"
                  :key="r"
                  :href="`#item-${r}`"
                  @click.prevent="scrollToId(`item-${r}`)"
                  >{{ r }}</a
                >
              </span>
            </li>
          </ul>
        </dd>
      </template>
      <template v-if="sm.delivery">
        <dt class="mono">전달력</dt>
        <dd data-test="summary-delivery">{{ sm.delivery }}</dd>
      </template>
      <template v-if="sm.postingFit">
        <dt class="mono">공고 적합도</dt>
        <dd data-test="posting-fit">
          <p v-if="sm.postingFit.met.length" class="fit">
            <span class="mono tag met">갖춤</span>
            {{ sm.postingFit.met.join(' · ') }}
          </p>
          <p v-if="sm.postingFit.gaps.length" class="fit">
            <span class="mono tag gap">모자람</span>
            {{ sm.postingFit.gaps.join(' · ') }}
          </p>
        </dd>
      </template>
    </dl>
  </PixelWindow>

  <PixelWindow
    v-for="(it, i) in items"
    :id="`item-${it.id}`"
    :key="it.id"
    :title="`${it.id}. ${it.question}`"
    :class="{ follow: it.kind === 'follow' }"
    data-test="v2-card"
  >
    <dl class="kv">
      <dt class="mono">내 답변</dt>
      <dd>{{ it.answerSummary }}</dd>
      <dt class="mono">피드백</dt>
      <dd>
        <template v-for="(p, j) in splitEmphasis(it.feedback)" :key="j">
          <span :class="{ strong: p.strong }">{{ p.text }}</span>
        </template>
      </dd>
      <template v-if="it.profile">
        <dt class="mono">프로필</dt>
        <dd data-test="v2-profile"><ProfileHex :profile="it.profile" :size="110" /></dd>
      </template>
      <template v-if="it.delivery">
        <dt class="mono">전달력</dt>
        <dd data-test="v2-delivery">{{ it.delivery }}</dd>
      </template>
      <template v-if="it.measurements">
        <dt class="mono">측정값</dt>
        <dd data-test="measure">
          <p v-if="it.measurements.insufficient" class="mono none">
            측정 부족 — 말한 시간이 너무 짧습니다
          </p>
          <template v-else>
            <!-- 프로필 육각형이 있으면 숫자는 한 줄로 편다. 예전에 저장된 리포트에는
                 프로필이 없어 지금처럼 표를 그린다(`docs/API.md` 396행) -->
            <p v-if="it.profile" class="mono line" data-test="measure-line">
              {{ numbersLine(it.measurements) }}
            </p>
            <ul v-else class="mono rows" data-test="measure-rows">
              <li>
                <span class="k">분당 음절</span>
                <span>{{ withGrade(it.measurements.syllablesPerMin, it.measurements.speed) }}</span>
              </li>
              <li>
                <span class="k">2초 이상 쉼</span>
                <span>{{
                  withGrade(
                    it.measurements.longPauses === null
                      ? null
                      : `${it.measurements.longPauses}회 · 분당 ${it.measurements.pausesPerMin ?? '—'}`,
                    it.measurements.pause,
                  )
                }}</span>
              </li>
              <li>
                <span class="k">가장 긴 쉼</span>
                <span>{{ sec(it.measurements.longestPauseSec) }}</span>
              </li>
              <li>
                <span class="k">첫마디까지</span>
                <span>{{
                  withGrade(
                    it.measurements.firstWordSec === null
                      ? null
                      : sec(it.measurements.firstWordSec),
                    it.measurements.firstWord,
                  )
                }}</span>
              </li>
              <li>
                <span class="k">군말</span>
                <span>{{ fillerText(it.measurements) }}</span>
              </li>
            </ul>
            <!-- 눈에 띄는 축은 근거까지, 보통인 축은 이름만 한 줄로 (2026-11-07).
                 "자신감 낮음"만 보이고 근거가 접히면 고칠 수가 없어, 접는 것은 보통인 축뿐이다 -->
            <template v-if="it.measurements.voice">
              <p
                v-for="v in flags(it.measurements.voice)"
                :key="v.label"
                class="mono flag"
                data-test="voice-flag"
              >
                <span class="tag">{{ v.label }} {{ v.said }}</span>
                {{ v.reason }}
              </p>
              <p
                v-if="plain(it.measurements.voice).length"
                class="mono plain"
                data-test="voice-plain"
              >
                {{ plain(it.measurements.voice).join(' · ') }}
              </p>
            </template>
          </template>
        </dd>
      </template>
    </dl>

    <!-- 카드 바닥. 보관함이 그 문항의 녹음 재생바를 여기 붙인다 — 벤 기록이 녹음을 갖는 쪽이다 -->
    <slot name="foot" :i="i" />
  </PixelWindow>
</template>

<style scoped>
.kv {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sp-3) var(--sp-5);
  margin: 0;
}
.kv dt {
  color: var(--text-3);
  font-size: var(--fs-label);
}
.kv dd {
  margin: 0;
  line-height: 1.8;
}
/* 꼬리질문은 부모에 딸린 것이다. 들여쓰면 **그 카드만 좁아져** 줄이 들쭉날쭉해지므로
   폭은 그대로 두고 왼쪽 띠로 묶음을 보인다 (2026-11-08) */
.follow {
  border-left: 4px solid var(--accent-2);
}
.points {
  margin: 0;
  padding-left: var(--sp-5);
}
.points li + li {
  margin-top: var(--sp-2);
}
.refs {
  font-size: var(--fs-meta);
}
.refs a {
  color: var(--accent-2);
  margin-left: var(--sp-2);
}
.fit {
  margin: 0;
}
.fit + .fit {
  margin-top: var(--sp-2);
}
.tag {
  font-size: var(--fs-meta);
  border: 2px solid var(--line);
  padding: 0 var(--sp-2);
  margin-right: var(--sp-2);
}
.tag.met {
  color: var(--ok);
}
.tag.gap {
  color: var(--accent);
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: var(--fs-body-sm);
}
.rows li {
  display: grid;
  grid-template-columns: 7em 1fr;
  gap: var(--sp-3);
}
.rows li + li {
  margin-top: var(--sp-1);
}
.rows .k {
  color: var(--text-3);
}
.voice {
  margin-top: var(--sp-3);
  padding-top: var(--sp-3);
  border-top: var(--rule);
}
.none {
  color: var(--text-3);
}
.strong {
  font-weight: 700;
  color: var(--accent);
}
</style>
