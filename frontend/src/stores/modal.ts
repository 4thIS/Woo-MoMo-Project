/** 지금 열려 있는 모달 하나.
 *
 * 상단 바가 들고 있었는데, 면접관 고르기처럼 **바 바깥에서도 모달을 열어야** 하는 곳이 생겼다
 * (벤을 눌렀는데 티켓이 없으면 요금제). 상태를 올려 누구나 같은 하나를 연다 —
 * 두 군데에서 각자 열면 모달이 겹친다.
 */
import { defineStore } from 'pinia'

export type ModalName = 'login' | 'premium' | 'me' | 'archive'

export const useModalStore = defineStore('modal', {
  state: () => ({ open: null as ModalName | null }),
  actions: {
    show(name: ModalName) {
      this.open = name
    },
    close() {
      this.open = null
    },
  },
})
