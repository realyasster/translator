export interface ModelConfig {
  baseURL: string
  apiKey: string
  modelName: string
  targetLanguage?: string
}

export interface StreamCallbacks {
  onChunk: (text: string) => void
  onDone: (fullText: string) => void
  onError: (err: Error) => void
}

export type ProviderType = 'openai-compatible' | 'ollama' | 'google-translate'

interface OllamaTagsResponse {
  models: { name: string }[]
}

function resolveTargetLanguage(input?: string): string {
  const v = (input || 'english').trim().toLowerCase()
  const map: Record<string, string> = {
    english: 'en', turkish: 'tr', chinese: 'zh-CN', spanish: 'es',
    french: 'fr', german: 'de', portuguese: 'pt', italian: 'it',
    russian: 'ru', japanese: 'ja', korean: 'ko', arabic: 'ar',
    dutch: 'nl', polish: 'pl',
  }
  if (map[v]) return map[v]
  if (v.length <= 5 && /^[a-z-]+$/.test(v)) return v
  return 'en'
}

function stripBaseForNative(baseURL: string): string {
  let base = (baseURL || '').trim().replace(/\/+$/, '')
  base = base.replace(/\/v1$/, '')
  return base
}

async function streamOpenAICompatible(
  config: ModelConfig,
  text: string,
  prompt: string,
  cb: StreamCallbacks,
  signal: AbortSignal,
): Promise<void> {
  const base = config.baseURL.replace(/\/+$/, '')
  const url = `${base}/chat/completions`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`

  const body = {
    model: config.modelName,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: text },
    ],
    temperature: 0.3,
    max_tokens: 1000,
    stream: true,
  }

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let accumulated = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (signal.aborted) {
      reader.cancel()
      break
    }
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') {
        cb.onDone(accumulated)
        return
      }
      try {
        const json = JSON.parse(payload)
        const delta = json?.choices?.[0]?.delta?.content
        if (delta) {
          accumulated += delta
          cb.onChunk(accumulated)
        }
      } catch {
        // ignore parse errors mid-stream
      }
    }
  }
  cb.onDone(accumulated)
}

async function streamOllama(
  config: ModelConfig,
  text: string,
  prompt: string,
  cb: StreamCallbacks,
  signal: AbortSignal,
): Promise<void> {
  const base = stripBaseForNative(config.baseURL)
  const url = `${base}/api/chat`
  const body = {
    model: config.modelName,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: text },
    ],
    stream: true,
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let accumulated = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (signal.aborted) {
      reader.cancel()
      break
    }
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const json = JSON.parse(trimmed)
        if (json.error) {
          throw new Error(typeof json.error === 'string' ? json.error : JSON.stringify(json.error))
        }
        const delta = json?.message?.content
        if (delta) {
          accumulated += delta
          cb.onChunk(accumulated)
        }
        if (json.done) {
          cb.onDone(accumulated)
          return
        }
      } catch (e: any) {
        if (e?.message && !e.message.includes('JSON')) throw e
      }
    }
  }
  cb.onDone(accumulated)
}

async function streamGoogleTranslate(
  config: ModelConfig,
  text: string,
  cb: StreamCallbacks,
  signal: AbortSignal,
): Promise<void> {
  const tl = resolveTargetLanguage(config.targetLanguage)
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`
  const res = await fetch(url, { method: 'GET', signal })
  if (!res.ok) {
    throw new Error(`Google Translate HTTP ${res.status}: ${res.statusText}`)
  }
  const data = (await res.json()) as any
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error('Google Translate returned unexpected format')
  }
  const full = (data[0] as any[])
    .map((seg) => (Array.isArray(seg) && seg[0] ? String(seg[0]) : ''))
    .join('')
    .trim()
  if (!full) throw new Error('Google Translate returned empty result')

  // Simulate streaming: reveal words progressively
  const words = full.split(/(\s+)/)
  let acc = ''
  for (let i = 0; i < words.length; i++) {
    if (signal.aborted) break
    acc += words[i]
    cb.onChunk(acc)
    await new Promise((r) => setTimeout(r, 25))
  }
  cb.onDone(acc)
}

export async function streamTranslate(
  provider: ProviderType,
  config: ModelConfig,
  text: string,
  prompt: string,
  cb: StreamCallbacks,
  signal: AbortSignal = new AbortController().signal,
): Promise<void> {
  try {
    if (provider === 'google-translate') {
      await streamGoogleTranslate(config, text, cb, signal)
    } else if (provider === 'ollama') {
      // Use native /api/chat with NDJSON
      await streamOllama(config, text, prompt, cb, signal)
    } else {
      // OpenAI-compatible
      await streamOpenAICompatible(config, text, prompt, cb, signal)
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      cb.onError(new Error('Translation aborted'))
      return
    }
    cb.onError(err instanceof Error ? err : new Error(String(err)))
  }
}