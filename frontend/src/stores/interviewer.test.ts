import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/preview', () => ({
  playPreview: vi.fn(async () => true),
  stopPreview: vi.fn(),
}))
vi.mock('@/services/sprites', () => ({ probeImage: vi.fn(async () => true) }))

import { playPreview, stopPreview } from '@/services/preview'
import { probeImage } from '@/services/sprites'
import { CENTER_ROLES, INTERVIEWERS, LEGACY_CENTER, interviewerById } from '@/interviewers'
import { __resetInterviewerProbe, useInterviewerStore } from './interviewer'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  __resetInterviewerProbe()
  vi.clearAllMocks()
  // 구현은 테스트 사이에 초기화되지 않는다 — 앞 테스트의 "깨진 파일" 설정이 새지 않게 매번 되돌린다
  vi.mocked(probeImage).mockImplementation(async () => true)
})

describe('stores/interviewer — 선택', () => {
  it('처음엔 선택 없음(null), select는 momo.interviewer에 기억한다', () => {
    const s = useInterviewerStore()
    expect(s.id).toBeNull()
    expect(s.current).toBeNull()
    s.select('m1')
    expect(s.current?.name).toBe('기본 면접관(남)')
    expect(localStorage.getItem('momo.interviewer')).toBe('m1')
  })
  it('저장된 선택을 복원하고, 정의에 없는 값(옛 id 포함)은 선택 안 됨으로 본다', () => {
    localStorage.setItem('momo.interviewer', 'm2')
    expect(useInterviewerStore().id).toBe('m2')
    for (const bad of ['ghost', 'standard']) {
      setActivePinia(createPinia())
      localStorage.setItem('momo.interviewer', bad)
      expect(useInterviewerStore().id, bad).toBeNull()
    }
  })
})

describe('stores/interviewer — 미리 듣기', () => {
  it('preview는 그 면접관 OGG를 재생하고 재생 중 id를 두며, 끝나면 비운다', async () => {
    let ended!: () => void
    vi.mocked(playPreview).mockImplementationOnce(async (_src, onEnded) => {
      ended = onEnded!
      return true
    })
    const s = useInterviewerStore()
    await s.preview('m1')
    expect(playPreview).toHaveBeenCalledWith('/voices/preview/m1.ogg', expect.any(Function))
    expect(s.playingId).toBe('m1')
    ended()
    expect(s.playingId).toBeNull()
  })
  it('다른 면접관으로 넘어가면 앞 면접관의 끝 알림은 재생 중 id를 지우지 않는다', async () => {
    const ends: (() => void)[] = []
    vi.mocked(playPreview).mockImplementation(async (_src, onEnded) => {
      ends.push(onEnded!)
      return true
    })
    const s = useInterviewerStore()
    await s.preview('m1')
    await s.preview('m2')
    ends[0]()
    expect(s.playingId).toBe('m2')
  })
  it('재생 실패면 previewFailed, 재생 중 id는 비운다', async () => {
    vi.mocked(playPreview).mockResolvedValueOnce(false)
    const s = useInterviewerStore()
    await s.preview('m2')
    expect(s.previewFailed).toBe(true)
    expect(s.playingId).toBeNull()
  })
  it('stopPreview는 서비스를 멈추고 재생 중 id를 비운다', async () => {
    const s = useInterviewerStore()
    await s.preview('m1')
    s.stopPreview()
    expect(stopPreview).toHaveBeenCalled()
    expect(s.playingId).toBeNull()
  })
})

describe('stores/interviewer — 스프라이트 대체', () => {
  it('probeSprites는 모든 면접관(기본 포함) 파일을 한 번 확인한다(두 번 불러도 한 번)', async () => {
    const s = useInterviewerStore()
    await Promise.all([s.probeSprites(), s.probeSprites()])
    expect(probeImage).toHaveBeenCalledTimes(INTERVIEWERS.length * CENTER_ROLES.length)
    const probed = vi.mocked(probeImage).mock.calls.map(([u]) => u)
    expect(new Set(probed)).toEqual(
      new Set(INTERVIEWERS.flatMap((iv) => CENTER_ROLES.map((r) => iv.sprites[r].file))),
    )
  })
  it('다 뜨면 자기 세트 그대로', async () => {
    const s = useInterviewerStore()
    await s.probeSprites()
    for (const iv of INTERVIEWERS) expect(s.spritesFor(iv.id), iv.id).toEqual(iv.sprites)
  })
  it('6개 중 하나만 안 떠도 그 면접관은 6개 모두 기존 가운데 스프라이트(LEGACY_CENTER) — 역할별로 섞지 않는다', async () => {
    vi.mocked(probeImage).mockImplementation(async (u) => !u.endsWith('/m1/center_nod.png'))
    const s = useInterviewerStore()
    await s.probeSprites()
    expect(s.spritesFor('m1')).toEqual(LEGACY_CENTER)
    expect(s.spritesFor('m2')).toEqual(interviewerById('m2')!.sprites) // 다른 면접관은 그대로
  })
  it('spritesFor(null)은 기본 면접관(f3) 세트, 기본 면접관이 깨지면 LEGACY_CENTER', async () => {
    const s = useInterviewerStore()
    expect(s.spritesFor(null)).toEqual(interviewerById('f3')!.sprites)
    vi.mocked(probeImage).mockImplementation(async (u) => !u.endsWith('/f3/center_idle.png'))
    await s.probeSprites()
    expect(s.spritesFor(null)).toEqual(LEGACY_CENTER)
    expect(s.spritesFor('f3')).toEqual(LEGACY_CENTER)
  })
})
