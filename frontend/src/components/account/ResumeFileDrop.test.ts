import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/pdf', () => ({ extractPdfText: vi.fn() }))
import { extractPdfText } from '@/services/pdf'
import ResumeFileDrop from './ResumeFileDrop.vue'

const pdf = (name = '이력서.pdf') => new File(['%PDF-1.4'], name, { type: 'application/pdf' })
const drop = () => mount(ResumeFileDrop)
/** 파일을 넣는 길은 셋(고르기·끌어다 놓기·그 밖)이지만 모두 이 한 곳으로 모인다 */
const read = (w: ReturnType<typeof drop>, f: File) =>
  (w.vm as unknown as { readFile: (f: File) => Promise<void> }).readFile(f)

beforeEach(() => vi.clearAllMocks())

describe('ResumeFileDrop', () => {
  it('PDF에서 뽑은 글을 올린다', async () => {
    vi.mocked(extractPdfText).mockResolvedValue('x'.repeat(200))
    const w = drop()
    await read(w, pdf())
    expect(w.emitted('read')![0][0]).toEqual({ name: '이력서.pdf', text: 'x'.repeat(200) })
  })

  it('글자를 못 뽑으면 올리지 않고 그 자리에서 말한다 — 빈 이력서가 조용히 저장되면 안 된다', async () => {
    vi.mocked(extractPdfText).mockResolvedValue('   ')
    const w = drop()
    await read(w, pdf())
    expect(w.emitted('read')).toBeFalsy()
    expect(w.get('[data-test=drop-error]').text()).toContain('글자')
  })

  it('읽다 실패해도 던지지 않는다 — 망가진 PDF가 있다', async () => {
    vi.mocked(extractPdfText).mockRejectedValue(new Error('broken'))
    const w = drop()
    await read(w, pdf())
    expect(w.emitted('read')).toBeFalsy()
    expect(w.find('[data-test=drop-error]').exists()).toBe(true)
  })

  it('PDF가 아니면 읽지 않는다', async () => {
    const w = drop()
    await read(w, new File(['x'], 'a.txt', { type: 'text/plain' }))
    expect(extractPdfText).not.toHaveBeenCalled()
    expect(w.get('[data-test=drop-error]').text()).toContain('PDF')
  })

  it('다시 넣으면 앞선 오류는 지운다 — 고쳤는데 빨간 줄이 남아 있으면 안 된다', async () => {
    const w = drop()
    await read(w, new File(['x'], 'a.txt', { type: 'text/plain' }))
    expect(w.find('[data-test=drop-error]').exists()).toBe(true)
    vi.mocked(extractPdfText).mockResolvedValue('제대로 된 글')
    await read(w, pdf())
    expect(w.find('[data-test=drop-error]').exists()).toBe(false)
  })
})
