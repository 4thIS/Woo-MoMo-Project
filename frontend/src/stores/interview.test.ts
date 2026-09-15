import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/api', () => ({ getQuestions: vi.fn(), getManifest: vi.fn() }))
import { getQuestions } from '@/services/api'
import { useModelStore } from './model'
import { useInterviewStore } from './interview'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(getQuestions).mockResolvedValue({
    field: 'it',
    questions: ['q1', 'q2', 'q3', 'q4', 'q5'],
  })
})

describe('interview store', () => {
  it('처음은 landing', () => {
    expect(useInterviewStore().phase).toBe('landing')
  })

  it('setField는 폴백 질문을 미리 받아 둔다', async () => {
    const s = useInterviewStore()
    await s.setField('it')
    expect(s.profile.field).toBe('it')
    expect(s.fallbackQuestions).toHaveLength(5)
  })

  it('폴백 질문 실패는 조용히 무시한다', async () => {
    vi.mocked(getQuestions).mockRejectedValue(new Error('down'))
    const s = useInterviewStore()
    await s.setField('finance')
    expect(s.profile.field).toBe('finance')
    expect(s.fallbackQuestions).toEqual([])
  })

  it('setResume은 절단해서 저장한다', () => {
    const s = useInterviewStore()
    s.setResume('cv.pdf', ' 가'.repeat(3000))
    expect(s.resumeName).toBe('cv.pdf')
    expect(s.resumeText).toHaveLength(2000)
    expect(s.resumeDone).toBe(true)
  })

  it('50자 미만이면 resumeDone false', () => {
    const s = useInterviewStore()
    s.setResume('scan.pdf', '짧음')
    expect(s.resumeDone).toBe(false)
  })

  it.each([
    ['ready', 'it', '백엔드', true, null],
    ['downloaded', 'it', '백엔드', false, '면접관이 자리에 앉으면 열립니다'],
    ['ready', null, '백엔드', false, '위 항목을 채우면 열립니다'],
    ['ready', 'it', '', false, '위 항목을 채우면 열립니다'],
  ] as const)(
    'canStart: model=%s field=%s job=%s → %s',
    async (status, field, job, expected, reason) => {
      const m = useModelStore()
      m.status = status
      const s = useInterviewStore()
      if (field) await s.setField(field)
      s.setJob(job)
      s.setResume('cv.pdf', '가'.repeat(60))
      expect(s.canStart).toBe(expected)
      expect(s.startBlockReason).toBe(reason)
    },
  )
})
