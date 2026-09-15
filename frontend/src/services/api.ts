import type { Manifest, QuestionSet } from '@/types/api'

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path} ${res.status}`)
  return res.json() as Promise<T>
}

export const getManifest = () => getJson<Manifest>('/api/manifest')
export const getQuestions = (field: string) =>
  getJson<QuestionSet>(`/api/questions/${field.toLowerCase()}`)
