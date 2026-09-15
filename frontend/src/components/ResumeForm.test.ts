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
