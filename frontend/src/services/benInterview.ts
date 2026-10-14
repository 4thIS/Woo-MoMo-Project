/** 벤(프리미엄) 면접 — 서버가 대화를 가진다 (`docs/API.md` 벤 면접 3단계).
 *
 * 무료 면접관은 브라우저 안 모델이 답하지만, 벤은 **서버가 Claude를 부른다.**
 * 그래서 이 서비스는 답변만 올리고 돌아오는 SSE를 흘려보낸다 — 대화 기록은 서버 몫이다.
 *
 * `EventSource`를 못 쓴다(POST라서). fetch 스트림을 직접 읽어 `SseParser`에 넣는다.
 */
import { SseParser } from '@/utils/sse'
import type { Session, Track } from './account'

const BASE = '/api/premium/interviews'

export type BenErrorCode =
  | 'no_tickets'
  | 'premium_required'
  | 'daily_limit'
  | 'ben_unavailable'
  | 'interview_over'
  | 'interview_not_started'
  | 'missing_answer'
  | 'answer_too_long'
  | 'missing_field'
  | 'invalid'
  | 'not_found'
  | 'rate_limited'
  /** 스트림 안에서 온 것 */
  | 'claude_error'
  | 'refused'
  | 'turn_conflict'
  | 'server_error'
  /** done 없이 끊김 */
  | 'stream_broken'
  | 'network'
  | 'unknown'

const MESSAGES: Record<BenErrorCode, string> = {
  no_tickets: '남은 티켓이 없습니다',
  premium_required: '모모 프리미엄 계정만 벤과 면접할 수 있습니다',
  daily_limit: '오늘은 벤 면접이 가득 찼습니다 — 내일 다시 시도해 주세요',
  ben_unavailable: '지금은 벤을 부를 수 없습니다',
  interview_over: '이 면접은 끝났습니다',
  interview_not_started: '아직 주고받은 말이 없습니다',
  missing_answer: '답변을 입력하세요',
  answer_too_long: '답변이 너무 깁니다 (2,000자까지)',
  missing_field: '빠진 칸이 있습니다',
  invalid: '입력한 값을 다시 확인해 주세요',
  not_found: '없는 면접입니다',
  rate_limited: '요청이 너무 잦습니다 — 잠시 뒤 다시 시도하세요',
  claude_error: '응답이 끊겼습니다',
  refused: '이 내용으로는 답할 수 없습니다',
  turn_conflict: '같은 면접이 두 번 겹쳐 들어왔습니다',
  server_error: '서버에서 문제가 생겼습니다',
  stream_broken: '응답이 끊겼습니다',
  network: '연결하지 못했습니다',
  unknown: '요청을 처리하지 못했습니다',
}

/** 다시 보내면 될 수 있는 것들. 거절·끝남·티켓 없음은 다시 보내도 같다 */
const RETRYABLE = new Set<BenErrorCode>([
  'claude_error',
  'turn_conflict',
  'server_error',
  'stream_broken',
  'network',
])

const KNOWN = new Set(Object.keys(MESSAGES))

export class BenError extends Error {
  readonly retryable: boolean
  constructor(readonly code: BenErrorCode) {
    super(MESSAGES[code])
    this.name = 'BenError'
    this.retryable = RETRYABLE.has(code)
  }
}

function codeOf(raw: unknown): BenErrorCode {
  return (typeof raw === 'string' && KNOWN.has(raw) ? raw : 'unknown') as BenErrorCode
}

export interface StartCompany {
  track: Extract<Track, 'company'>
  resumeText: string
  company: { field: string; job: string }
}
export interface StartAdmission {
  track: Extract<Track, 'admission'>
  resumeText: string
  admission: { name: string; age: number; university: string; department: string }
}
export type StartRequest = StartCompany | StartAdmission

export interface Started {
  interviewId: string
  /** 티켓 1장이 빠진 세션 */
  session: Session
}

async function post(path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal,
    })
  } catch {
    throw new BenError('network')
  }
}

export async function startInterview(req: StartRequest): Promise<Started> {
  const res = await post(BASE, req)
  const body = await res.json().catch(() => undefined)
  if (!res.ok) throw new BenError(codeOf((body as { error?: unknown } | undefined)?.error))
  return body as Started
}

/** SSE 본문을 끝까지 읽는다. `done`의 data를 돌려주고, error 이벤트는 던진다 */
async function readStream(
  res: Response,
  onDelta: (text: string) => void,
): Promise<Record<string, unknown>> {
  if (!res.ok) {
    const body = await res.json().catch(() => undefined)
    throw new BenError(codeOf((body as { error?: unknown } | undefined)?.error))
  }
  const reader = res.body?.getReader()
  if (!reader) throw new BenError('stream_broken')

  let done: Record<string, unknown> | null = null
  let failed: BenErrorCode | null = null
  const parser = new SseParser((e) => {
    if (e.event === 'delta') {
      const text = (JSON.parse(e.data) as { text?: unknown }).text
      if (typeof text === 'string') onDelta(text)
    } else if (e.event === 'done') {
      done = JSON.parse(e.data || '{}') as Record<string, unknown>
    } else if (e.event === 'error') {
      failed = codeOf((JSON.parse(e.data || '{}') as { code?: unknown }).code)
    }
  })

  const dec = new TextDecoder()
  try {
    for (;;) {
      const r = await reader.read()
      if (r.done) break
      parser.push(dec.decode(r.value, { stream: true }))
      // error가 오면 그 턴은 서버에 기록되지 않는다 — 더 읽을 것이 없다
      if (failed || done) break
    }
  } catch {
    throw new BenError('network')
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  if (failed) throw new BenError(failed)
  // done을 못 본 채 끊겼으면 반쪽이다. 성공으로 치면 빈 질문이 대화에 남는다
  if (!done) throw new BenError('stream_broken')
  return done
}

/** 한 턴. 첫 턴은 `answer`를 비워 보낸다 — 서버가 첫 질문을 만든다 */
export async function turnStream(
  interviewId: string,
  answer: string | undefined,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<{ ended: boolean }> {
  const res = await post(
    `${BASE}/${interviewId}/turns`,
    answer === undefined ? {} : { answer },
    signal,
  )
  const done = await readStream(res, onDelta)
  return { ended: done.ended === true }
}

/** 리포트 원문. 이미 받은 면접에 다시 부르면 서버가 보관한 원문을 그대로 돌려준다 */
export async function reportStream(
  interviewId: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await post(`${BASE}/${interviewId}/report`, {}, signal)
  await readStream(res, onDelta)
}
