import { defineStore } from 'pinia'
import { getQuestions } from '@/services/api'
import { truncateResume } from '@/utils/truncate'
import { useModelStore } from './model'

export type Phase = 'landing' | 'prepare' | 'interview' | 'report'
export type Field = 'it' | 'finance' | 'manufacturing' | 'retail' | 'general'

export const FIELD_LABELS: Record<Field, string> = {
  it: 'IT',
  finance: '금융',
  manufacturing: '제조',
  retail: '유통',
  general: '기타',
}

export const RESUME_MIN = 50

export const useInterviewStore = defineStore('interview', {
  state: () => ({
    phase: 'landing' as Phase,
    profile: { field: null as Field | null, job: '' },
    resumeText: '',
    resumeName: null as string | null,
    fallbackQuestions: [] as string[],
  }),
  getters: {
    profileDone: (s) => s.profile.field !== null && s.profile.job.trim().length > 0,
    resumeDone: (s) => s.resumeText.length >= RESUME_MIN,
    canStart(): boolean {
      return useModelStore().status === 'ready' && this.profileDone && this.resumeDone
    },
    startBlockReason(): string | null {
      if (this.canStart) return null
      if (useModelStore().status !== 'ready') return '면접관이 자리에 앉으면 열립니다'
      return '위 항목을 채우면 열립니다'
    },
  },
  actions: {
    goto(phase: Phase) {
      this.phase = phase
    },
    async setField(field: Field) {
      this.profile.field = field
      try {
        this.fallbackQuestions = (await getQuestions(field)).questions
      } catch {
        this.fallbackQuestions = [] // 폴백 질문 없이도 면접은 진행한다 (spec 5절)
      }
    },
    setJob(job: string) {
      this.profile.job = job.slice(0, 40)
    },
    setResume(name: string, rawText: string) {
      this.resumeName = name
      this.resumeText = truncateResume(rawText)
    },
  },
})
