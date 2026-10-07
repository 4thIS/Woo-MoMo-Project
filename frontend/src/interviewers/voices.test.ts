import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import voices from './voices.json'
import { SILENCE_SEC, SPEED, TOTAL_STEP } from '@/workers/ttsProtocol'

const PREVIEW = join(__dirname, '../../public/voices/preview')
const SCRIPT = join(__dirname, '../../scripts/voice-previews/generate.py')
const VOICE_IDS = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5']
const STANDARD_TEXT = '안녕하세요, 오늘 면접을 진행하겠습니다. 준비되시면 시작하겠습니다.'
const SHARP_TEXT = '시작하겠습니다. 답변은 근거와 수치로 구체적으로 말씀해 주세요.'

describe('voices.json', () => {
  it('면접관 4명(m1·f3·m2·f2) — 목소리 M4·F3·M5·F4', () => {
    expect(Object.keys(voices)).toEqual(['m1', 'f3', 'm2', 'f2'])
    expect(Object.values(voices).map((v) => v.voice)).toEqual(['M4', 'F3', 'M5', 'F4'])
  })
  it('미리 듣기 문장: 기본 둘은 standard 문장, 압박 둘은 sharp 문장', () => {
    expect(voices.m1.text).toBe(STANDARD_TEXT)
    expect(voices.f3.text).toBe(STANDARD_TEXT)
    expect(voices.m2.text).toBe(SHARP_TEXT)
    expect(voices.f2.text).toBe(SHARP_TEXT)
  })
  it('목소리는 Supertonic 3 프리셋 10개 중 하나이고 네 면접관이 서로 다르며, 문장은 비어 있지 않다', () => {
    for (const v of Object.values(voices)) {
      expect(VOICE_IDS).toContain(v.voice)
      expect(v.text.trim().length).toBeGreaterThan(0)
    }
    expect(new Set(Object.values(voices).map((v) => v.voice)).size).toBe(4)
  })
  it('면접관마다 미리 듣기 OGG가 있고 100KB 이하다', () => {
    for (const id of Object.keys(voices)) {
      const f = join(PREVIEW, `${id}.ogg`)
      expect(existsSync(f), f).toBe(true)
      expect(statSync(f).size).toBeLessThanOrEqual(100 * 1024)
    }
  })
  it('미리 듣기 폴더에는 면접관 id의 OGG만 있다(옛 파일이 남지 않는다)', () => {
    const files = readdirSync(PREVIEW).filter((f) => f.endsWith('.ogg'))
    expect(files.sort()).toEqual(
      Object.keys(voices)
        .map((id) => `${id}.ogg`)
        .sort(),
    )
  })
  it('생성 스크립트의 합성 설정이 앱(ttsProtocol)과 같다 — 미리 듣기와 실제 목소리가 같아야 한다', () => {
    const py = readFileSync(SCRIPT, 'utf8')
    expect(py).toContain(`TOTAL_STEP = ${TOTAL_STEP}`)
    expect(py).toContain(`SPEED = ${SPEED}`)
    expect(py).toContain(`SILENCE_SEC = ${SILENCE_SEC}`)
  })
})
