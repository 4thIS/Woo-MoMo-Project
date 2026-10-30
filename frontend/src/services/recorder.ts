/** 답변 녹음 (프리미엄 전용, spec 10절).
 *
 * **어떤 실패에도 던지지 않는다.** 권한을 거절하든 브라우저가 지원하지 않든 `null`을 준다 —
 * 녹음은 덤이지 조건이 아니다. 티켓은 이미 썼으니 녹음 때문에 면접을 막으면 안 된다.
 */

/** 조각 하나. MediaRecorder가 만든 webm은 앞머리에 전체 길이가 없어
 *  브라우저가 끝까지 읽기 전에는 길이를 모른다 — 녹음한 시간을 직접 재서 함께 보낸다 */
export interface Clip {
  blob: Blob
  /** 이 조각을 녹음한 시간(초) */
  durationSec: number
}

export interface Recorder {
  /** 지금까지 모은 소리를 끊어 돌려주고 **다음 조각을 바로 시작한다**. 멈춘 뒤면 null */
  cut(): Promise<Clip | null>
  /** 마이크를 놓는다. 남은 조각을 돌려준다 */
  stop(): Promise<Clip | null>
}

export async function startRecording(): Promise<Recorder | null> {
  try {
    if (typeof MediaRecorder === 'undefined') return null
    const media = navigator.mediaDevices
    if (!media?.getUserMedia) return null
    const stream = await media.getUserMedia({ audio: true })
    return makeRecorder(stream)
  } catch {
    // 거절·장치 없음·보안 컨텍스트 아님 — 사유를 가르지 않는다. 화면이 할 일은 같다
    return null
  }
}

function makeRecorder(stream: MediaStream): Recorder {
  let rec: MediaRecorder | null = null
  let live = true
  /** 지금 조각이 시작된 시각 */
  let startedAt = 0

  /** 조각 하나를 받아 둔다. 멈춤이 끝난 뒤에 resolve된다 */
  function segment(): Promise<Blob | null> {
    const r = rec
    if (!r) return Promise.resolve(null)
    rec = null
    return new Promise((resolve) => {
      const parts: Blob[] = []
      r.ondataavailable = (e) => parts.push(e.data)
      r.onstop = () => resolve(parts.length ? new Blob(parts, { type: parts[0].type }) : null)
      try {
        r.stop()
      } catch {
        resolve(null)
      }
    })
  }

  function begin() {
    startedAt = Date.now()
    try {
      const r = new MediaRecorder(stream)
      r.start()
      rec = r
    } catch {
      rec = null
    }
  }

  /** 조각과 길이를 묶는다. 소리가 없으면 길이도 뜻이 없다 */
  function pack(blob: Blob | null): Clip | null {
    return blob ? { blob, durationSec: (Date.now() - startedAt) / 1000 } : null
  }

  begin()

  return {
    async cut() {
      if (!live) return null
      const clip = pack(await segment())
      begin()
      return clip
    },
    async stop() {
      if (!live) return null
      live = false
      const clip = pack(await segment())
      try {
        for (const t of stream.getTracks()) t.stop()
      } catch {
        /* 이미 놓인 트랙 */
      }
      return clip
    },
  }
}
