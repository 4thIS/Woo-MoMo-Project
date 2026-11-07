/** 지금 보고 있는 보관함 상세 하나.
 *
 * 상세는 모달이 아니라 **화면**이다 (2026-11-07 개편) — 같은 내용을 두 레이아웃으로
 * 그리던 일을 끝낸다. 가독성이 나빴던 진짜 원인은 2열이 아니라 그것이었다.
 *
 * 화면이므로 뒤로 가기로 목록에 돌아와야 한다. URL은 **건드리지 않고** 히스토리 항목만 민다:
 * 리포트 목차가 해시 앵커(`#q4`)를 쓰므로 여기서 또 쓰면 서로 덮어쓴다.
 * `popstate`를 듣는 곳은 `App.vue` 하나다 — 스토어가 전역 리스너를 달면 테스트마다 쌓인다.
 */
import { defineStore } from 'pinia'
import type { ArchiveDetail } from '@/services/account'
import { useAccountStore } from './account'
import { useInterviewStore } from './interview'
import { useModalStore } from './modal'

export const useArchiveViewStore = defineStore('archiveView', {
  state: () => ({ detail: null as ArchiveDetail | null }),
  actions: {
    async open(id: string) {
      // 면접 도중에 열면 보던 면접이 날아간다
      if (useInterviewStore().phase === 'interview') return
      const d = await useAccountStore().getArchive(id)
      // 못 받아 왔으면 열지 않는다 — 빈 화면은 고장처럼 보인다
      if (!d) return
      this.detail = d
      useModalStore().close()
      history.pushState({ momoArchive: id }, '')
    },
    close() {
      this.detail = null
    },
  },
})
