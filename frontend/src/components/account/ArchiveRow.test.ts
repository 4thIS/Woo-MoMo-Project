import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ArchiveRow from './ArchiveRow.vue'
import type { ArchiveEntry } from '@/services/account'

const entry = {
  id: 'a1',
  interviewerId: 'm2',
  track: 'company',
  field: 'it',
  job: '백엔드 개발자',
  university: null,
  department: null,
  startedAt: '2026-11-01T10:00:00Z',
  endedAt: '2026-11-01T10:12:34Z',
  questionCount: 8,
  premium: true,
  hasRecording: true,
} as unknown as ArchiveEntry

const row = (over: Partial<ArchiveEntry> = {}) =>
  mount(ArchiveRow, { props: { entry: { ...entry, ...over } } })

describe('ArchiveRow — 열로 세운다 (2026-11-07)', () => {
  it('지원 직무가 제목 자리다 — 같은 면접관으로 셋을 봐도 구분된다', () => {
    expect(row().get('[data-test=row-subject]').text()).toContain('백엔드 개발자')
  })

  it('대입이면 제목 자리에 학과가 온다', () => {
    const w = row({ track: 'admission', university: '명지전문대', department: '컴퓨터공학과' })
    expect(w.get('[data-test=row-subject]').text()).toContain('컴퓨터공학과')
  })

  it('숫자는 제 열에 선다 — 자릿수가 줄 맞아야 세로로 비교된다', () => {
    const w = row()
    expect(w.get('[data-test=row-count]').text()).toBe('8문항')
    expect(w.get('[data-test=row-took]').text()).toBe('12분 34초')
  })

  it('녹음·프리미엄은 표식이다 — 문장에 끼워 넣지 않는다', () => {
    const w = row()
    expect(w.find('[data-test=row-premium]').exists()).toBe(true)
    expect(w.find('[data-test=row-rec]').exists()).toBe(true)
    expect(w.text()).not.toContain('· 녹음')
  })

  it('표식이 없는 기록에는 표식 자리를 그리지 않는다', () => {
    const w = row({ premium: false, hasRecording: false })
    expect(w.find('[data-test=row-premium]').exists()).toBe(false)
    expect(w.find('[data-test=row-rec]').exists()).toBe(false)
  })

  it('면접관 얼굴은 1/2배로 줄인다 — 92px 시트라 0.6배는 픽셀이 뭉개진다', () => {
    expect(row().findComponent({ name: 'SpriteFrame' }).props('scale')).toBe(0.5)
  })

  it('좁은 화면용 줄에 면접관 이름을 함께 적는다 — 그 폭에서는 이름 열이 사라진다', () => {
    expect(row().get('.sub.narrow').text()).toContain('벤')
  })
})
