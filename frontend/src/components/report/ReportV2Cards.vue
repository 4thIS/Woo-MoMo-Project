<script setup lang="ts">
/** 벤 리포트 버전 2 본문. 리포트 화면과 보관함 상세가 **같은 것**을 보여 준다.
 *
 * 서버가 준 글은 전부 텍스트 바인딩으로만 그린다(`docs/API.md`: 보관함은 받은 그대로 돌려주므로
 * 클라이언트가 이스케이프한다). 강조는 `splitEmphasis`가 조각으로 갈라 준 것만 굵게 한다.
 */
import { computed } from 'vue'
import ProfileHex from './ProfileHex.vue'
import { splitEmphasis } from '@/utils/reportParser'
import { itemsInOrder, type Measurements, type ReportV2 } from '@/utils/reportV2'
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
                <a v-for="r in p.refs" :key="r" :href="`#item-${r}`">{{ r }}</a>
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
                <a v-for="r in p.refs" :key="r" :href="`#item-${r}`">{{ r }}</a>
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
    v-for="it in items"
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
        <dd data-test="v2-profile"><ProfileHex :profile="it.profile" /></dd>
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
            <ul class="mono rows" data-test="measure-rows">
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
            <ul v-if="it.measurements.voice" class="mono rows voice" data-test="voice">
              <li>
                <span class="k">자신감</span>
                <span
                  >{{ it.measurements.voice.confidence.level }} —
                  {{ it.measurements.voice.confidence.reason }}</span
                >
              </li>
              <li>
                <span class="k">어조</span>
                <span
                  >{{ it.measurements.voice.tone.level }} —
                  {{ it.measurements.voice.tone.reason }}</span
                >
              </li>
              <li>
                <span class="k">떨림</span>
                <span
                  >{{ it.measurements.voice.tremor.present ? '있음' : '없음' }} —
                  {{ it.measurements.voice.tremor.reason }}</span
                >
              </li>
              <li>
                <span class="k">끝 흐려짐</span>
                <span
                  >{{ it.measurements.voice.trailingOff.present ? '있음' : '없음' }} —
                  {{ it.measurements.voice.trailingOff.reason }}</span
                >
              </li>
              <li>
                <span class="k">발음</span>
                <span
                  >{{ it.measurements.voice.clarity.level }} —
                  {{ it.measurements.voice.clarity.reason }}</span
                >
              </li>
            </ul>
          </template>
        </dd>
      </template>
    </dl>
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
/* 꼬리질문은 부모 아래 한 칸 들어간다 — 번호만으로는 묶음이 보이지 않는다 */
.follow {
  margin-left: var(--sp-6);
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
