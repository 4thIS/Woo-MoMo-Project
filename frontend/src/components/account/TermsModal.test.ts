import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import TermsModal from './TermsModal.vue'
import { SERVICE_TERMS } from '@/content/terms'

const src = readFileSync(join(__dirname, 'TermsModal.vue'), 'utf8')

afterEach(() => {
  document.body.innerHTML = ''
})

describe('TermsModal', () => {
  it('약관 본문을 그대로 줄 단위로 보여 준다', () => {
    // PixelModal이 body로 Teleport한다 — 래퍼가 아니라 문서에서 찾는다
    mount(TermsModal, { props: { open: true, section: SERVICE_TERMS }, attachTo: document.body })
    expect(document.querySelectorAll('.line')).toHaveLength(SERVICE_TERMS.lines.length)
  })

  it('긴 글은 읽는 글꼴과 줄간으로 — 픽셀 글꼴로 약관을 읽히지 않는다', () => {
    // 스타일이 scoped라 DOM으로는 못 본다. 소스에서 본다 (base.test.ts와 같은 방식)
    expect(src).toMatch(/font-family:\s*var\(--font-read\)/)
    expect(src).toMatch(/line-height:\s*var\(--lh-read\)/)
  })
})
