/** 상황별 힌트의 기억 — 본 키와 켬/끔. 이 브라우저에만 남고 서버로 가지 않는다.
 *
 * localStorage는 사생활 보호 모드·차단 설정에서 던질 수 있다. 읽기는 기본값으로, 쓰기는 무시로 넘긴다
 * (interview 스토어의 muted와 같은 방식). 기억이 없어도 힌트는 동작해야 한다.
 */
import { defineStore } from 'pinia'

export const SEEN_KEY = 'momo.hints.seen'
export const OFF_KEY = 'momo.hints.off'

function loadSeen(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    const v: unknown = raw ? JSON.parse(raw) : null
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) !== '1'
  } catch {
    return true
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 저장 못 해도 이번 방문 동안은 동작한다 */
  }
}

export const useHintsStore = defineStore('hints', {
  state: () => ({
    seen: loadSeen() as string[],
    enabled: loadEnabled(),
  }),
  actions: {
    markSeen(key: string) {
      if (this.seen.includes(key)) return
      this.seen.push(key)
      save(SEEN_KEY, JSON.stringify(this.seen))
    },
    disable() {
      this.enabled = false
      save(OFF_KEY, '1')
    },
    /** 다시 켤 때는 본 기록도 비운다 — 처음부터 따라가려고 켜는 것이다 */
    enable() {
      this.enabled = true
      this.seen = []
      save(OFF_KEY, '0')
      save(SEEN_KEY, '[]')
    },
  },
})
