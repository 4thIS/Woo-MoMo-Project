import { defineStore } from 'pinia'
import {
  CENTER_ROLES,
  DEFAULT_INTERVIEWER,
  INTERVIEWERS,
  interviewerById,
  type CenterSprites,
  type Interviewer,
  type InterviewerId,
} from '@/interviewers'
import { playPreview, stopPreview } from '@/services/preview'
import { probeImage } from '@/services/sprites'

/** 고른 면접관(spec 4.2). 기존 momo.voice·momo.muted와 같은 방식으로 기억한다 */
const KEY = 'momo.interviewer'
function loadId(): InterviewerId | null {
  try {
    return interviewerById(localStorage.getItem(KEY))?.id ?? null
  } catch {
    return null
  }
}
let probing: Promise<void> | null = null
/** 테스트용: 스프라이트 확인을 다시 하게 한다 */
export function __resetInterviewerProbe(): void {
  probing = null
}

export const useInterviewerStore = defineStore('interviewer', {
  state: () => ({
    id: loadId(),
    /** 미리 듣기 재생 중인 면접관 — Picker가 이 캐릭터를 question 제스처로 바꾼다 */
    playingId: null as InterviewerId | null,
    previewFailed: false,
    /** 안 뜨는 스프라이트 파일(새 면접관 에셋이 아직 없을 때) */
    brokenFiles: [] as string[],
  }),
  getters: {
    current: (s): Interviewer | null => interviewerById(s.id),
    /** 역할별 시트. 새 면접관 파일이 안 뜨면 그 역할만 기본 면접관 시트로(spec 7절) */
    spritesFor:
      (s) =>
      (id: InterviewerId | null): CenterSprites => {
        const base = interviewerById(DEFAULT_INTERVIEWER)!.sprites
        const iv = interviewerById(id) ?? interviewerById(DEFAULT_INTERVIEWER)!
        return Object.fromEntries(
          CENTER_ROLES.map((r) => [
            r,
            s.brokenFiles.includes(iv.sprites[r].file) ? base[r] : iv.sprites[r],
          ]),
        ) as CenterSprites
      },
  },
  actions: {
    select(id: InterviewerId) {
      this.id = id
      try {
        localStorage.setItem(KEY, id)
      } catch {
        /* 사생활 모드 등 — 이번 세션만 유지 */
      }
    },
    /** 미리 듣기: 음소거와 무관하게 항상 재생한다(spec 3.1) */
    async preview(id: InterviewerId) {
      const iv = interviewerById(id)
      if (!iv) return
      this.previewFailed = false
      this.playingId = id
      const ok = await playPreview(iv.preview.src, () => {
        if (this.playingId === id) this.playingId = null
      })
      if (!ok) {
        if (this.playingId === id) this.playingId = null
        this.previewFailed = true
      }
    },
    stopPreview() {
      stopPreview()
      this.playingId = null
    },
    /** 새 면접관 스프라이트가 뜨는지 한 번만 확인한다(기본 면접관 파일은 이미 쓰고 있으니 제외) */
    probeSprites(): Promise<void> {
      probing ??= (async () => {
        const files = INTERVIEWERS.filter((iv) => iv.id !== DEFAULT_INTERVIEWER).flatMap((iv) =>
          CENTER_ROLES.map((r) => iv.sprites[r].file),
        )
        const results = await Promise.all(files.map(async (f) => [f, await probeImage(f)] as const))
        this.brokenFiles = results.filter(([, ok]) => !ok).map(([f]) => f)
      })()
      return probing
    },
  },
})
