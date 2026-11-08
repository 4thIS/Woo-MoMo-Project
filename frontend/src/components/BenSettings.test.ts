import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BenSettings from './BenSettings.vue'
import { BEN_AXES, DEFAULT_BEN } from '@/content/benAxes'

const at = (w: ReturnType<typeof mount>, i: number) => w.findAll('[data-test=ben-axis]')[i]
const open = (showCompany = true) =>
  mount(BenSettings, { props: { modelValue: DEFAULT_BEN, showCompany } })

describe('BenSettings', () => {
  it('회사 트랙이면 다섯 줄, 아니면 넷 — 서버가 무시하는 칸을 고르게 두지 않는다', () => {
    expect(open(true).findAll('[data-test=ben-axis]')).toHaveLength(5)
    const off = open(false)
    expect(off.findAll('[data-test=ben-axis]')).toHaveLength(4)
    expect(off.text()).not.toContain('회사 이야기')
  })

  it('고른 값의 이름과 한 줄 설명을 늘 띄운다 — 눈금만으로는 뭘 골랐는지 모른다', () => {
    const w = open()
    expect(at(w, 0).find('[data-test=ben-value]').text()).toBe('날카롭게')
    expect(at(w, 0).find('[data-test=ben-hint]').text()).toContain('칭찬')
  })

  it('눈금을 옮기면 그 축만 바뀐 값을 올려 보낸다', async () => {
    const w = open()
    await at(w, 0).get('input[type=range]').setValue('2')
    expect(w.emitted('update:modelValue')![0][0]).toEqual({ ...DEFAULT_BEN, warmth: 2 })
  })

  it('화면 낭독기가 축 이름과 지금 값을 읽는다', () => {
    const r = at(open(), 1).get('input[type=range]')
    expect(r.attributes('aria-label')).toBe('꼬리질문')
    expect(r.attributes('aria-valuetext')).toBe('보통')
  })

  it('눈금은 셋으로 끊어 그린다 — 세 단계뿐인데 이어진 것처럼 보이면 안 된다', () => {
    const r = at(open(), 0).get('input[type=range]')
    expect(r.attributes('min')).toBe('0')
    expect(r.attributes('max')).toBe('2')
    expect(r.attributes('step')).toBe('1')
    expect(at(open(), 0).findAll('[data-test=ben-notch]')).toHaveLength(3)
  })
})

describe('BEN_AXES', () => {
  const api = readFileSync(join(__dirname, '../../../docs/API.md'), 'utf8')

  it('기본값이 docs/API.md와 같다 — 다르면 "손대지 않으면 지금 벤" 약속이 깨진다', () => {
    // API 문서는 기본값을 `| \`warmth\` | **\`low\`** / ... |` 꼴로 적는다
    for (const a of BEN_AXES) {
      const row = api.split('\n').find((l) => l.includes(`\`${a.key}\``) && l.includes('**'))
      expect(row, `${a.key} 줄을 docs/API.md에서 못 찾았다`).toBeTruthy()
      expect(row).toContain(`**\`${a.api[a.base]}\`**`)
    }
  })

  it('DEFAULT_BEN이 표의 base와 같다 — 둘이 어긋나면 기본값이 둘이 된다', () => {
    for (const a of BEN_AXES) expect(DEFAULT_BEN[a.key]).toBe(a.base)
  })

  it('다섯 축을 모두 들고 있다', () => {
    expect(BEN_AXES.map((a) => a.key)).toEqual([
      'warmth',
      'followUp',
      'questionMix',
      'difficulty',
      'companyWeight',
    ])
  })
})

describe('BenSettings — 화살표는 눌리는 것이다 (2026-11-08)', () => {
  /* ◀ ▶를 장식(aria-hidden span)으로 두면 눌러도 아무 일이 없다.
     보이면 눌려야 한다 — range는 키보드·낭독기 몫으로 그대로 둔다 */
  const mid = { ...DEFAULT_BEN, warmth: 1 as const }
  const atMid = () => mount(BenSettings, { props: { modelValue: mid, showCompany: true } })

  it('▶를 누르면 한 칸 오른쪽으로', async () => {
    const w = atMid()
    await at(w, 0).get('[data-test=ben-next]').trigger('click')
    expect(w.emitted('update:modelValue')![0][0]).toEqual({ ...mid, warmth: 2 })
  })

  it('◀를 누르면 한 칸 왼쪽으로', async () => {
    const w = atMid()
    await at(w, 0).get('[data-test=ben-prev]').trigger('click')
    expect(w.emitted('update:modelValue')![0][0]).toEqual({ ...mid, warmth: 0 })
  })

  it('끝에서는 잠긴다 — 눌러도 아무 일이 없는 것과 눌릴 수 없는 것은 다르다', () => {
    const w = mount(BenSettings, {
      props: { modelValue: { ...DEFAULT_BEN, warmth: 0 }, showCompany: true },
    })
    const prev = at(w, 0).get('[data-test=ben-prev]').element as HTMLButtonElement
    expect(prev.disabled).toBe(true)
    expect((at(w, 0).get('[data-test=ben-next]').element as HTMLButtonElement).disabled).toBe(false)
  })

  it('잠긴 끝을 눌러도 값을 올려 보내지 않는다', async () => {
    const w = mount(BenSettings, {
      props: { modelValue: { ...DEFAULT_BEN, warmth: 2 }, showCompany: true },
    })
    await at(w, 0).get('[data-test=ben-next]').trigger('click')
    expect(w.emitted('update:modelValue')).toBeFalsy()
  })

  it('Tab 차례에는 끼지 않는다 — 같은 조작이 range로 이미 있다', () => {
    const w = atMid()
    expect(at(w, 0).get('[data-test=ben-next]').attributes('tabindex')).toBe('-1')
  })
})

describe('BenSettings — 전역 .arrow와 섞이지 않는다', () => {
  const src = readFileSync(join(__dirname, 'BenSettings.vue'), 'utf8')

  it('화살표에 .arrow를 쓰지 않는다 — base.css의 44x44 네모 버튼과 이름이 겹친다', () => {
    expect(src).not.toMatch(/class="[^"]*\barrow\b/)
  })
})
