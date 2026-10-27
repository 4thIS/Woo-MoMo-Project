import type { TtsFile, TtsManifest, TtsVoice } from '@/types/api'

/** 엔진 파일 = files 중 경로가 voices에 없는 것. voices가 없으면 files 전체(옛 매니페스트) */
export function engineFiles(tts: TtsManifest): TtsFile[] {
  if (!tts.voices?.length) return tts.files
  const voicePaths = new Set(tts.voices.map((v) => v.path))
  return tts.files.filter((f) => !voicePaths.has(f.path))
}

/** 고른 목소리. 목록에 없거나 null이면 기본 voice. voices가 없으면 null(목소리 파일은 files 안에 있다) */
export function pickVoice(tts: TtsManifest, voiceId: string | null): TtsVoice | null {
  if (!tts.voices?.length) return null
  return (
    tts.voices.find((v) => v.id === voiceId) ?? tts.voices.find((v) => v.id === tts.voice) ?? null
  )
}

/** 워커에 넘길 TTS 설정: 엔진 + 고른 목소리 하나(맨 뒤), voice = 고른 id. voices가 없으면 원본 그대로 */
export function resolveTts(tts: TtsManifest, voiceId: string | null): TtsManifest {
  const v = pickVoice(tts, voiceId)
  if (!v) return tts
  return { ...tts, voice: v.id, files: [...engineFiles(tts), { path: v.path, size: v.size }] }
}

/** 캐시 정리에서 남길 목소리 파일 전부 — 한 번 받은 목소리는 지우지 않는다 */
export function voiceFiles(tts: TtsManifest): TtsFile[] {
  return (tts.voices ?? []).map((v) => ({ path: v.path, size: v.size }))
}
