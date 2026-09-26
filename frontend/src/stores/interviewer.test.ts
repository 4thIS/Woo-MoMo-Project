import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/preview', () => ({
  playPreview: vi.fn(async () => true),
  stopPreview: vi.fn(),
}))
vi.mock('@/services/sprites', () => ({ probeImage: vi.fn(async () => true) }))

import { playPreview, stopPreview } from '@/services/preview'
import { probeImage } from '@/services/sprites'
import { CENTER_ROLES, interviewerById } from '@/interviewers'
import { __resetInterviewerProbe, useInterviewerStore } from './interviewer'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  __resetInterviewerProbe()
  vi.clearAllMocks()
})

describe('stores/interviewer — 선택', () => {
  it('처음엔 선택 없음(null), select는 momo.interviewer에 기억한다', () => {
    const s = useInterviewerStore()
    expect(s.id).toBeNull()
    expect(s.current).toBeNull()
    s.select('gentle')
    expect(s.current?.name).toBe('온화한 선배')
    expect(localStorage.getItem('momo.interviewer')).toBe('gentle')
  })
  it('저장된 선택을 복원하고, 정의에 없는 값은 선택 안 됨으로 본다', () => {
    localStorage.setItem('momo.interviewer', 'sharp')
    expect(useInterviewerStore().id).toBe('sharp')
    setActivePinia(createPinia())
    localStorage.setItem('momo.interviewer', 'ghost')
    expect(useInterviewerStore().id).toBeNull()
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
    await s.preview('gentle')
    expect(playPreview).toHaveBeenCalledWith('/voices/preview/gentle.ogg', expect.any(Function))
    expect(s.playingId).toBe('gentle')
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
    await s.preview('gentle')
    await s.preview('sharp')
    ends[0]()
    expect(s.playingId).toBe('sharp')
  })
  it('재생 실패면 previewFailed, 재생 중 id는 비운다', async () => {
    vi.mocked(playPreview).mockResolvedValueOnce(false)
    const s = useInterviewerStore()
    await s.preview('sharp')
    expect(s.previewFailed).toBe(true)
    expect(s.playingId).toBeNull()
  })
  it('stopPreview는 서비스를 멈추고 재생 중 id를 비운다', async () => {
    const s = useInterviewerStore()
    await s.preview('gentle')
    s.stopPreview()
    expect(stopPreview).toHaveBeenCalled()
    expect(s.playingId).toBeNull()
  })
})

describe('stores/interviewer — 스프라이트 대체', () => {
  it('probeSprites는 새 면접관 파일만 한 번 확인한다(기본 면접관 제외, 두 번 불러도 한 번)', async () => {
    const s = useInterviewerStore()
    await Promise.all([s.probeSprites(), s.probeSprites()])
    expect(probeImage).toHaveBeenCalledTimes(2 * CENTER_ROLES.length)
    expect(
      vi
        .mocked(probeImage)
        .mock.calls.every(([u]) => !u.startsWith('/sprites/interviewers/center_')),
    ).toBe(true)
  })
  it('안 뜨는 파일의 역할만 기본 면접관 시트로 바꾼다', async () => {
    vi.mocked(probeImage).mockImplementation(async (u) => !u.endsWith('gentle/center_nod.png'))
    const s = useInterviewerStore()
    await s.probeSprites()
    const sp = s.spritesFor('gentle')
    expect(sp.nod).toEqual(interviewerById('standard')!.sprites.nod)
    expect(sp.idle.file).toBe('/sprites/interviewers/gentle/center_idle.png')
  })
  it('spritesFor(null)은 기본 면접관 시트', () => {
    expect(useInterviewerStore().spritesFor(null)).toEqual(interviewerById('standard')!.sprites)
  })
})
