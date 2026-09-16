import { Engine, loadLiteRtLm, type Conversation, type Message } from '@litert-lm/core'

export const WASM_PATH = '/litert-wasm/'

export interface LlmSession {
  send(text: string, onToken: (delta: string) => void, signal?: AbortSignal): Promise<string>
  tokenCount(): Promise<number>
  dispose(): Promise<void>
}

const SESSION_CONFIG = {
  samplerParams: { temperature: 0.7, k: 40 },
  maxOutputTokens: 1024,
} as const

let wasmLoaded = false
let engine: Engine | null = null
let current: Conversation | null = null

async function ensureWasm() {
  if (wasmLoaded) return
  await loadLiteRtLm(WASM_PATH)
  wasmLoaded = true
}

export async function initEngine(model: Blob, opts: { maxNumTokens: number }): Promise<void> {
  await ensureWasm()
  await disposeEngine()
  engine = await Engine.create({ model, mainExecutorSettings: { maxNumTokens: opts.maxNumTokens } })
}

function textOf(m: Message): string {
  if (typeof m.content === 'string') return m.content
  if (!m.content) return ''
  return m.content.map((p) => (p.type === 'text' ? p.text : '')).join('')
}

async function createConversation(messages: Message[]): Promise<Conversation> {
  if (!engine) throw new Error('engine not initialized')
  return engine.createConversation({ preface: { messages }, sessionConfig: SESSION_CONFIG })
}

export async function startSession(systemPrompt: string): Promise<LlmSession> {
  if (!engine) throw new Error('engine not initialized')
  if (current) {
    await current.delete().catch(() => undefined)
    current = null
  }
  // 런타임 이력에 넣지 않는 우리 쪽 사본. 중단 후 대화를 다시 만들 때 preface로 되살린다.
  const history: Message[] = [{ role: 'system', content: systemPrompt }]
  let conv = await createConversation(history)
  current = conv

  /**
   * 중단(cancelProcess) 뒤에는 같은 Conversation의 다음 send가 'Task cancelled'로 즉시 실패한다
   * (스파이크에서 확인). 그래서 중단하면 지금까지 받은 텍스트를 model 턴으로 확정한 이력으로
   * 새 Conversation을 만들어 교체한다.
   */
  async function recreate() {
    const old = conv
    conv = await createConversation(history)
    if (current === old) current = conv
    await old.delete().catch(() => undefined)
  }

  return {
    async send(text, onToken, signal) {
      let full = ''
      const stream = conv.sendMessageStreaming(text)
      const reader = stream.getReader()
      // 스트림 자체를 cancel해야 런타임이 isCancelled/isBusy를 정리한다.
      const onAbort = () => void reader.cancel().catch(() => undefined)
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const delta = textOf(value)
          if (delta) {
            full += delta
            onToken(delta)
          }
        }
      } catch (e) {
        if (!signal?.aborted) throw e
      } finally {
        signal?.removeEventListener('abort', onAbort)
        reader.releaseLock()
      }
      history.push({ role: 'user', content: text })
      if (full) history.push({ role: 'model', content: full })
      if (signal?.aborted) await recreate()
      return full
    },
    async tokenCount() {
      try {
        const n = await conv.getTokenCount()
        // 중단 직후 재생성된 대화는 prefill 전이라 0을 돌려준다 → 스토어가 근사치를 쓰도록 -1
        return n === 0 && history.length > 1 ? -1 : n
      } catch {
        return -1
      }
    },
    async dispose() {
      if (current === conv) current = null
      await conv.delete().catch(() => undefined)
    },
  }
}

export async function disposeEngine(): Promise<void> {
  if (current) {
    await current.delete().catch(() => undefined)
    current = null
  }
  if (engine) {
    await engine.delete().catch(() => undefined)
    engine = null
  }
}
