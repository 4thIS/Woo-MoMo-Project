<script setup lang="ts">
/** 기업 제휴 제안 (2026-11-11).
 *
 * 회사 사람이 상단 바에서 바로 열어 읽는 **제안서**다. 발표자료 8·9쪽의 내용을
 * "우리가 기업에 드릴 수 있는 것"으로 다시 쓴 것이고, 내용의 기준도 그 두 쪽이다.
 *
 * 공적인 자료라 두 가지를 지킨다.
 * ① 운영 중인 것과 계획인 것을 섞지 않는다 — 전용 면접관은 아직 계획이라고 먼저 밝힌다.
 * ② 가격은 확정이 아니라 제안이라고 적는다.
 * 둘 다 테스트로 고정돼 있다(ContactModal.test.ts).
 */
import PixelModal from '@/components/ui/PixelModal.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

/** 서비스 주소. 연락할 곳이자 "지금 돌아가고 있다"는 증거다 */
const SITE = 'momo.ssenu.cloud'

const OFFERS = [
  {
    title: '○○ 전용 면접관 제작',
    body: '회사 소개·인재상·직무 설명·원하는 면접 방향을 받아, 면접관의 말투와 꼬리질문 깊이, 질문 성격, 난이도, 회사 이야기 비중을 맞춰 전용 면접관을 만듭니다. 시험 면접으로 검수한 뒤 등록합니다.',
    gain: '우리 회사 면접에 가까운 연습 환경',
  },
  {
    title: '면접관 목록 노출·운영',
    body: '전용 면접관을 서비스의 면접관 목록에 올립니다. 지원을 준비하는 사람이 연습을 고를 때마다 회사 이름과 인재상을 만나고, 지원 전에 회사를 한 번 더 이해하게 됩니다.',
    gain: '구직 준비 단계에서의 반복 노출',
  },
  {
    title: '채용 인사이트 리포트',
    body: '전용 면접관으로 연습한 결과를 모아 월 1회 정리해 드립니다. 연습 횟수, 지원자들이 공통으로 막힌 역량, 인재상 이해도를 담습니다. 모은 익명 통계만 드리며 개인 답변과 신원은 포함하지 않습니다.',
    gain: '채용 공고·면접 설계에 쓸 사전 데이터',
  },
  {
    title: '기업 후원 티켓',
    body: '지원자의 연습 비용을 기업이 대신 부담하는 방식입니다. 후원한 범위 안에서 지원자는 무료로 연습하고, 회사는 지원하는 사람의 준비를 돕는 회사로 남습니다.',
    gain: '채용 브랜딩 · 지원자 준비도 상승',
  },
]

const STEPS = [
  { name: '문의', note: '아래 주소로 연락 주시면 담당자가 회신합니다' },
  {
    name: '자료 받기',
    note: '회사 소개 · 인재상 · 직무 · 원하는 면접 방향',
    mark: '실제 출제 문항은 받지 않습니다',
  },
  {
    name: '전용 면접관 제작',
    note: '성향·질문 방향·회사 지식을 묶어 만들고, 시험 면접으로 함께 검수합니다',
  },
  {
    name: '등록 · 노출 · 리포트',
    note: '면접관 목록에 등록해 구직자가 연습하고, 매달 익명 통계 리포트를 보내 드립니다',
  },
]

const PRICES = [
  { item: '전용 면접관 제작', note: '자료 정리 · 설정 · 시험 면접 검수', won: '1회 30만 원' },
  { item: '노출 · 운영', note: '면접관 목록 상단 노출 + 운영비', won: '월 10만 원' },
  {
    item: '채용 인사이트 리포트',
    note: '월 1회 · 연습 횟수 · 막힌 역량 · 인재상 이해도 (익명 통계)',
    won: '월 20만 원',
  },
  {
    item: '기업 후원 티켓',
    note: '지원자 연습비를 기업이 부담 · 100명 × 10회 = 49만 원',
    won: '장당 490원',
  },
  {
    item: '대학 · 부트캠프 단체 이용권',
    note: '개인 상품을 묶어 판매 · 단체 할인',
    won: '1인 학기 4,900원',
  },
]

/** 이미 돌아가는 부품 → 제휴에서 쓰이는 곳. "새로 만들 것"이 아님을 보이는 자리다 */
const READY = [
  {
    have: '면접관 성향 5축 조절',
    haveNote: '말투 · 꼬리질문 깊이 · 질문 성격 · 난이도 · 회사 이야기 비중',
    use: '회사 면접 문화',
    useNote: '압박형인지, 인성 중심인지, 기술 심화인지',
  },
  {
    have: '회사 브리핑 · 모집공고 읽기',
    haveNote: '뉴스 · 웹문서 · 공고를 모아 요약해 질문에 반영',
    use: '회사 지식',
    useNote: '사업 · 인재상 · 직무 요구사항을 질문에 반영',
  },
  {
    have: '문항별 리포트 · 개인정보 가림',
    haveNote: '답변마다 역량 수준과 근거 · 이름·연락처는 가려서 외부 AI로',
    use: '채용 인사이트 리포트',
    useNote: '모은 익명 통계만 회사에 · 개인 답변·신원은 넘기지 않음',
  },
]

const VOWS = [
  {
    title: '실제 출제 문항은 받지 않습니다',
    body: '회사 소개 · 인재상 · 직무 · 원하는 면접 방향만 받습니다. 채용 과정의 기밀을 서비스로 가져오지 않습니다.',
  },
  {
    title: '리포트는 익명 통계만 드립니다',
    body: '개인의 답변 내용과 신원은 어떤 형태로도 회사에 넘기지 않습니다.',
  },
  {
    title: '개인정보는 가린 뒤 처리합니다',
    body: '이름·연락처·주소 등은 외부 AI로 나가기 전에 가리고, 사용자 화면에서만 원래 값으로 되돌립니다.',
  },
  {
    title: '비로그인 사용자의 기록은 기기를 떠나지 않습니다',
    body: '이력서·대화·리포트가 서버로 가지 않습니다. 로그인 사용자는 동의한 범위 안에서만 저장합니다.',
  },
]
</script>

<template>
  <PixelModal :open="open" title="기업 제휴 제안" width="wide" @close="emit('close')">
    <div class="doc" data-test="contact-doc">
      <!-- 머리말. 무엇을 주는 회사인지와 **지금 어디까지 와 있는지**를 나란히 둔다 -->
      <section class="lead">
        <div>
          <p class="mono eyebrow">모두의 모의면접 · 기업 파트너십</p>
          <h3 class="display ttl">
            그 회사만의 <b>전용 면접관</b>을 만들어, 지원자가 지원 전에 회사를 연습하게 합니다
          </h3>
          <p class="read">
            모두의 모의면접은 브라우저 안에서 AI 면접관과 반복 연습하는 모의면접 서비스입니다.
            기업에는 회사의 면접 문화·인재상·직무를 반영한 전용 면접관을 만들어 드리고, 그
            면접관으로 연습한 결과를 익명 통계로 정리해 매달 보내 드립니다.
          </p>
        </div>
        <aside class="stage" data-test="contact-stage">
          <p class="mono cap">지금 단계</p>
          <p class="read">
            서비스는 <b>{{ SITE }}</b
            >에서 운영 중입니다. 기업 전용 면접관은 다음 단계 <b>계획</b>으로, 함께 만들어 갈 첫
            파트너를 찾고 있습니다.
          </p>
        </aside>
      </section>

      <section class="sec">
        <h4 class="display h">제공하는 것</h4>
        <div class="offers">
          <article v-for="(o, i) in OFFERS" :key="o.title" class="offer" data-test="contact-offer">
            <span class="mono no">{{ String(i + 1).padStart(2, '0') }}</span>
            <h5 class="display nm">{{ o.title }}</h5>
            <p class="read">{{ o.body }}</p>
            <p class="gain" data-test="contact-gain">
              <span class="mono cap">회사가 얻는 것</span>
              <span>{{ o.gain }}</span>
            </p>
          </article>
        </div>
      </section>

      <section class="sec">
        <h4 class="display h">진행 방식과 비용</h4>
        <div class="two">
          <ol class="steps">
            <li v-for="(s, i) in STEPS" :key="s.name" data-test="contact-step">
              <span class="mono no">{{ String(i + 1).padStart(2, '0') }}</span>
              <span class="txt">
                <b>{{ s.name }}</b>
                <span class="read">
                  {{ s.note }}<b v-if="s.mark"> · {{ s.mark }}</b>
                </span>
              </span>
            </li>
          </ol>
          <div>
            <table class="price">
              <thead>
                <tr>
                  <th class="mono" scope="col">상품</th>
                  <th class="mono" scope="col">가격(제안)</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in PRICES" :key="p.item" data-test="contact-price-row">
                  <td>
                    {{ p.item }}
                    <small class="read">{{ p.note }}</small>
                  </td>
                  <td class="mono won">{{ p.won }}</td>
                </tr>
              </tbody>
            </table>
            <p class="read note" data-test="contact-price-note">
              모두 제안 가격입니다. 범위·기간·규모에 따라 조정하며, 첫 파트너와는 제작비 없이 함께
              만들어 보는 방식도 논의할 수 있습니다.
            </p>
          </div>
        </div>
      </section>

      <section class="sec">
        <header class="shead">
          <h4 class="display h">왜 지금 가능한가</h4>
          <p class="read">
            전용 면접관은 새 개발이 아니라 설정을 묶는 일입니다. 필요한 부품은 프리미엄 면접관에
            이미 들어가 돌아가고 있습니다.
          </p>
        </header>
        <ul class="ready">
          <li v-for="r in READY" :key="r.have">
            <div class="have">
              <b>{{ r.have }}</b>
              <small class="read">{{ r.haveNote }}</small>
            </div>
            <span class="arrow mono" aria-hidden="true">&gt;</span>
            <div class="use">
              <b>{{ r.use }}</b>
              <small class="read">{{ r.useNote }}</small>
            </div>
          </li>
        </ul>
      </section>

      <section class="sec">
        <header class="shead">
          <h4 class="display h">데이터 원칙</h4>
          <p class="read">회사가 가장 먼저 묻는 것이라, 묻기 전에 먼저 밝힙니다.</p>
        </header>
        <div class="vows">
          <div v-for="v in VOWS" :key="v.title" class="vow" data-test="contact-vow">
            <b>{{ v.title }}</b>
            <span class="read">{{ v.body }}</span>
          </div>
        </div>
      </section>

      <footer class="foot" data-test="contact-foot">
        <div>
          <h4 class="display h">이야기 나눠 보시겠어요?</h4>
          <p class="read">
            회사의 채용 상황을 들려주시면, 전용 면접관을 어떤 성향으로 만들지와 어떤 지표를 리포트에
            담을지부터 같이 정하겠습니다. 시험 면접까지는 비용 없이 보여 드립니다.
          </p>
        </div>
        <dl class="card">
          <dt class="mono">서비스</dt>
          <dd>{{ SITE }}</dd>
          <dt class="mono">팀</dt>
          <dd>팀 우(Woo) · 이우진 · 박찬우</dd>
        </dl>
      </footer>
    </div>
  </PixelModal>
</template>

<style scoped>
/* 브라우저가 제목·문단에 붙이는 기본 여백을 먼저 턴다 — 간격은 gap으로만 준다.
   (h4의 기본 margin-bottom 26.6px가 gap 위에 더해져 설명이 떠 보였다)
   :where로 가중치를 0으로 둬서 아래 규칙들이 그대로 이긴다 */
.doc :where(h3, h4, h5, p, ul, ol, dl, dd) {
  margin: 0;
}
/* 읽는 자료다 — 화면 글꼴 대신 읽기용 글꼴과 넓은 줄간격을 쓴다 */
.doc {
  display: flex;
  flex-direction: column;
  gap: var(--sp-8);
}
.read {
  font-family: var(--font-read);
  line-height: var(--lh-read);
  color: var(--text-2);
  font-size: var(--fs-label);
}
.eyebrow {
  color: var(--accent);
  font-size: var(--fs-meta);
}
.cap {
  color: var(--accent);
  font-size: var(--fs-meta);
}
.ttl {
  margin: var(--sp-3) 0 var(--sp-4);
  font-size: var(--fs-h2);
  line-height: 1.5;
  color: var(--text);
}
.ttl b {
  color: var(--accent);
}
.h {
  font-size: var(--fs-body-md);
  color: var(--text);
}
/* 제목과 한 줄 설명은 한 쌍이다 — 섹션 간격이 둘 사이에 들어가면 설명이 떠 보인다 */
.shead {
  display: grid;
  gap: var(--sp-2);
}

.lead {
  display: grid;
  grid-template-columns: 1.45fr 0.55fr;
  gap: var(--sp-8);
  align-items: start;
  padding-bottom: var(--sp-6);
  border-bottom: var(--rule);
}
/* 계획인 것을 운영 중인 것처럼 읽히지 않게 따로 세운다 */
.stage {
  padding: var(--sp-4);
  border: 2px dashed var(--accent);
  background: var(--bg);
  display: grid;
  gap: var(--sp-2);
}
.stage b {
  color: var(--text);
}

.sec {
  display: grid;
  gap: var(--sp-4);
}
.offers {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-4);
}
.offer {
  display: flex;
  flex-direction: column;
  padding: var(--sp-5);
  background: var(--raise);
  border: 1px solid var(--off);
}
.no {
  color: var(--accent);
  font-size: var(--fs-meta);
}
.nm {
  margin: var(--sp-2) 0 var(--sp-3);
  font-size: var(--fs-body-sm);
  color: var(--text);
}
/* 본문 길이가 달라도 '회사가 얻는 것'은 카드끼리 같은 높이에 온다 — 눈이 한 줄로 훑게 */
.gain {
  margin-top: auto;
  padding-top: var(--sp-3);
  border-top: 1px solid var(--off);
  display: grid;
  gap: var(--sp-1);
  font-size: var(--fs-label);
  color: var(--text);
}
.offer .read {
  margin-bottom: var(--sp-4);
}

.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-8);
  align-items: start;
}
.steps {
  display: grid;
  gap: var(--sp-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.steps li {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  background: var(--raise);
}
.steps .txt {
  display: grid;
  gap: var(--sp-1);
}
.steps b {
  color: var(--text);
  font-size: var(--fs-label);
}
.steps .read b {
  color: var(--accent);
}

.price {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-label);
}
.price th,
.price td {
  padding: var(--sp-3) var(--sp-2);
  border-bottom: 1px solid var(--off);
  text-align: left;
  vertical-align: top;
  color: var(--text);
}
.price thead th {
  color: var(--text-3);
  font-size: var(--fs-meta);
  font-weight: 400;
  border-bottom: var(--rule);
}
.price small {
  display: block;
  margin-top: var(--sp-1);
  color: var(--text-3);
  font-size: var(--fs-meta);
}
.price .won {
  color: var(--accent);
  white-space: nowrap;
  text-align: right;
}
.note {
  margin-top: var(--sp-3);
  color: var(--text-3);
  font-size: var(--fs-meta);
}

.ready {
  display: grid;
  gap: var(--sp-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.ready li {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: var(--sp-3);
}
.ready .have,
.ready .use {
  display: grid;
  gap: var(--sp-1);
  padding: var(--sp-3) var(--sp-4);
  font-size: var(--fs-label);
  color: var(--text);
}
/* 이미 있는 것은 초록(기기 안에서 돌아가는 것들과 같은 어법), 앞으로 쓰일 곳은 점선 노랑 */
.ready .have {
  background: var(--raise);
  border-left: 3px solid var(--ok);
}
.ready .use {
  background: var(--bg);
  border: 1px dashed var(--accent);
}
.ready .use b {
  color: var(--accent);
}
.ready .arrow {
  color: var(--text-3);
}

.vows {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-3);
}
.vow {
  display: grid;
  gap: var(--sp-2);
  padding: var(--sp-4);
  background: var(--raise);
  border-left: 3px solid var(--ok);
  font-size: var(--fs-label);
  color: var(--text);
}

.foot {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--sp-8);
  align-items: center;
  padding: var(--sp-5);
  background: var(--raise);
  border: 1px solid var(--off);
}
.foot .h {
  margin-bottom: var(--sp-2);
}
.card {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--sp-2) var(--sp-4);
  margin: 0;
  font-size: var(--fs-label);
  color: var(--text);
}
.card dt {
  color: var(--text-3);
  font-size: var(--fs-meta);
  align-self: center;
}
.card dd {
  margin: 0;
}

@media (max-width: 860px) {
  .lead,
  .offers,
  .two,
  .vows,
  .foot {
    grid-template-columns: 1fr;
  }
  .ready li {
    grid-template-columns: 1fr;
  }
  .ready .arrow {
    justify-self: center;
    transform: rotate(90deg);
  }
}
</style>
