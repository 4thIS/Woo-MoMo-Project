import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ResumeForm from './ResumeForm.vue'
import { RESUME_FIELDS } from '@/utils/resumeForm'

const input = (w: ReturnType<typeof mount>) => w.find('[data-test=form-input]')

describe('ResumeForm', () => {
  it('Enter로 한 항목씩 넘어가고, 필수 항목이 비면 넘어가지 않는다', async () => {
    const w = mount(ResumeForm)
    expect(w.text()).toContain('1 / 7')
    await input(w).trigger('keydown.enter')
    expect(w.text()).toContain('1 / 7')
    expect(w.text()).toContain('이름은(는) 꼭 적어 주세요')
    await input(w).setValue('홍길동')
    await input(w).trigger('keydown.enter')
    expect(w.text()).toContain('2 / 7')
    expect(w.text()).toContain('나이')
  })

  it('선택 항목은 비워도 넘어가고, 이전 화살표로 돌아가면 값이 남아 있다', async () => {
    const w = mount(ResumeForm)
    await input(w).setValue('홍길동')
    await input(w).trigger('keydown.enter')
    await input(w).setValue('27')
    await input(w).trigger('keydown.enter')
    await input(w).setValue('한국대 졸업')
    await input(w).trigger('keydown.enter')
    expect(w.text()).toContain('자격증')
    await w.find('[data-test=form-next]').trigger('click') // 비운 채 다음
    expect(w.text()).toContain('5 / 7')
    await w.find('[data-test=form-prev]').trigger('click')
    await w.find('[data-test=form-prev]').trigger('click')
    expect((input(w).element as HTMLInputElement).value).toBe('한국대 졸업')
  })

  it('마지막 항목을 완성하면 합성된 이력서 텍스트를 done으로 낸다', async () => {
    const w = mount(ResumeForm)
    const answers = ['홍길동', '27', '한국대 졸업', '', '', '동아리 회장', '성장하고 싶어서']
    for (let i = 0; i < RESUME_FIELDS.length; i++) {
      await input(w).setValue(answers[i])
      await w.find('[data-test=form-next]').trigger('click')
    }
    const text = w.emitted('done')?.[0]?.[0] as string
    expect(text).toContain('이름: 홍길동')
    expect(text).toContain('자격증: 없음')
    expect(text).toContain('지원동기: 성장하고 싶어서')
    expect(w.find('[data-test=form-next]').text()).toContain('이력서 완성')
  })
})

describe('ResumeForm — 한글 IME·포커스 (#41)', () => {
  it('조합 중(isComposing) Enter는 무시한다 — 조합 확정 Enter만 넘어간다', async () => {
    const w = mount(ResumeForm)
    await input(w).setValue('홍길동')
    await input(w).trigger('keydown.enter', { isComposing: true })
    expect(w.text()).toContain('1 / 7')
    await input(w).trigger('keydown.enter')
    expect(w.text()).toContain('2 / 7')
  })
  it('긴 항목의 Ctrl+Enter도 조합 중이면 무시한다', async () => {
    const w = mount(ResumeForm)
    const answers = ['홍길동', '27', '한국대', '', '']
    for (const a of answers) {
      await input(w).setValue(a)
      await w.find('[data-test=form-next]').trigger('click')
    }
    expect(w.text()).toContain('6 / 7')
    await input(w).setValue('동아리')
    await input(w).trigger('keydown.enter', { ctrlKey: true, isComposing: true })
    expect(w.text()).toContain('6 / 7')
    await input(w).trigger('keydown.enter', { ctrlKey: true })
    expect(w.text()).toContain('7 / 7')
  })
  it('항목이 바뀌면 <input> 요소를 새로 만든다 — 조합 중이던 글자가 다음 항목으로 새지 않게', async () => {
    const w = mount(ResumeForm)
    const first = input(w).element
    await input(w).setValue('홍길동')
    await input(w).trigger('keydown.enter')
    expect(input(w).element).not.toBe(first)
  })
  it('양식을 열면 첫 칸에 포커스가 간다', async () => {
    const w = mount(ResumeForm, { attachTo: document.body })
    await w.vm.$nextTick()
    expect(document.activeElement).toBe(input(w).element)
    w.unmount()
  })
})
