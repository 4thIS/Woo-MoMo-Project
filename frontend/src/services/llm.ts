import { Engine, loadLiteRtLm, type Conversation, type Message } from '@litert-lm/core'

export const WASM_PATH = '/litert-wasm/'

export interface LlmSession {
  send(text: string, onToken: (delta: string) => void, signal?: AbortSignal): Promise<string>
  tokenCount(): Promise<number>
  dispose(): Promise<void>
}

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

export async function startSession(systemPrompt: string): Promise<LlmSession> {
  if (!engine) throw new Error('engine not initialized')
  if (current) {
    await current.delete().catch(() => undefined)
    current = null
  }
  const conv = await engine.createConversation({
    preface: { messages: [{ role: 'system', content: systemPrompt }] },
    sessionConfig: { samplerParams: { temperature: 0.7, k: 40 }, maxOutputTokens: 1024 },
  })
  current = conv
  return {
    async send(text, onToken, signal) {
      let full = ''
      const stream = conv.sendMessageStreaming(text)
      const reader = stream.getReader()
      const onAbort = () => conv.cancel()
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
      return full
    },
    async tokenCount() {
      try {
        return await conv.getTokenCount()
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
