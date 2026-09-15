import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import App from './App.vue'

describe('App', () => {
  it('제목을 렌더한다', () => {
    expect(mount(App).text()).toContain('모두의 모의면접')
  })
})
