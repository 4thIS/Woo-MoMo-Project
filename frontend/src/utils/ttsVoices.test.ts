import { describe, expect, it } from 'vitest'
import type { TtsManifest } from '@/types/api'
import { engineFiles, pickVoice, resolveTts, voiceFiles } from './ttsVoices'

const base: TtsManifest = {
  id: 'supertonic-3',
  baseUrl: 'https://huggingface.co/x/resolve/abc/',
  files: [
    { path: 'onnx/a.onnx', size: 60 },
    { path: 'onnx/tts.json', size: 30 },
    { path: 'voice_styles/M2.json', size: 10 },
  ],
  voice: 'M2',
  lang: 'ko',
}
const withVoices: TtsManifest = {
  ...base,
  voices: [
    { id: 'F1', path: 'voice_styles/F1.json', size: 11 },
    { id: 'M2', path: 'voice_styles/M2.json', size: 10 },
    { id: 'M4', path: 'voice_styles/M4.json', size: 12 },
  ],
}

describe('ttsVoices', () => {
  it('voices가 없으면(옛 매니페스트) 엔진 = files 전체, 목소리 선택 없음, 원본 그대로', () => {
    expect(engineFiles(base)).toEqual(base.files)
    expect(pickVoice(base, 'F1')).toBeNull()
    expect(resolveTts(base, 'F1')).toBe(base)
    expect(voiceFiles(base)).toEqual([])
  })
  it('엔진 = files 중 voices 경로가 아닌 것', () => {
    expect(engineFiles(withVoices).map((f) => f.path)).toEqual(['onnx/a.onnx', 'onnx/tts.json'])
  })
  it('고른 목소리가 목록에 있으면 그것, 없거나 null이면 기본 voice', () => {
    expect(pickVoice(withVoices, 'M4')?.id).toBe('M4')
    expect(pickVoice(withVoices, 'Z9')?.id).toBe('M2')
    expect(pickVoice(withVoices, null)?.id).toBe('M2')
  })
  it('resolveTts: 엔진 + 고른 목소리 파일(맨 뒤), voice는 고른 id', () => {
    const r = resolveTts(withVoices, 'F1')
    expect(r.voice).toBe('F1')
    expect(r.files).toEqual([
      { path: 'onnx/a.onnx', size: 60 },
      { path: 'onnx/tts.json', size: 30 },
      { path: 'voice_styles/F1.json', size: 11 },
    ])
    expect(r.baseUrl).toBe(withVoices.baseUrl)
    expect(r.id).toBe('supertonic-3')
  })
  it('voiceFiles는 목소리 전부(캐시 정리에서 남길 대상)', () => {
    expect(voiceFiles(withVoices).map((f) => f.path)).toEqual([
      'voice_styles/F1.json',
      'voice_styles/M2.json',
      'voice_styles/M4.json',
    ])
  })
})
