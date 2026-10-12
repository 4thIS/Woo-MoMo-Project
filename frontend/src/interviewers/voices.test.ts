import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import voices from './voices.json'
import { SILENCE_SEC, SPEED, TOTAL_STEP } from '@/workers/ttsProtocol'

const PREVIEW = join(__dirname, '../../public/voices/preview')
const SCRIPT = join(__dirname, '../../scripts/voice-previews/generate.py')
const VOICE_IDS = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5']

describe('voices.json', () => {
  it('면접관 3명(온화·기본·압박) — 기본 면접관은 지금 목소리 M2', () => {
    expect(Object.keys(voices)).toEqual(['gentle', 'standard', 'sharp'])
    expect(voices.standard.voice).toBe('M2')
  })
  it('목소리는 Supertonic 3 프리셋 10개 중 하나이고 세 면접관이 서로 다르며, 문장은 비어 있지 않다', () => {
    for (const v of Object.values(voices)) {
      expect(VOICE_IDS).toContain(v.voice)
      expect(v.text.trim().length).toBeGreaterThan(0)
    }
    expect(new Set(Object.values(voices).map((v) => v.voice)).size).toBe(3)
  })
  it('면접관마다 미리 듣기 OGG가 있고 100KB 이하다', () => {
    for (const id of Object.keys(voices)) {
      const f = join(PREVIEW, `${id}.ogg`)
      expect(existsSync(f), f).toBe(true)
      expect(statSync(f).size).toBeLessThanOrEqual(100 * 1024)
    }
  })
  it('생성 스크립트의 합성 설정이 앱(ttsProtocol)과 같다 — 미리 듣기와 실제 목소리가 같아야 한다', () => {
    const py = readFileSync(SCRIPT, 'utf8')
    expect(py).toContain(`TOTAL_STEP = ${TOTAL_STEP}`)
    expect(py).toContain(`SPEED = ${SPEED}`)
    expect(py).toContain(`SILENCE_SEC = ${SILENCE_SEC}`)
  })
})
