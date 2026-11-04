export interface OllamaModel {
  name: string
  size?: number
  modified_at?: string
  digest?: string
  details?: {
    format?: string
    family?: string
    parameter_size?: string
    quantization_level?: string
  }
}

export interface OllamaTagsResponse {
  models: OllamaModel[]
}

export interface OllamaVersionResponse {
  version: string
}

export type OllamaPullEvent =
  | { status: string; digest?: string; total?: number; completed?: number }
  | { error: string }

export interface OllamaDetectResult {
  ok: boolean
  version?: string
  models: OllamaModel[]
  error?: string
  cors?: boolean
}

function normalizeBase(baseURL: string): { apiURL: string; tagsURL: string } {
  let base = (baseURL || '').trim().replace(/\/+$/, '')
  base = base.replace(/\/v1$/, '')
  return {
    apiURL: base,
    tagsURL: `${base}/api/tags`,
  }
}

export interface ProbeResult {
  reachable: boolean
  corsBlocked: boolean
  rawError?: string
}

async function probeOllamaRaw(apiURL: string): Promise<ProbeResult> {
  const url = `${apiURL}/api/tags`
  try {
    const res = await fetch(url, { method: 'GET' })
    if (res.ok || res.status === 401 || res.status === 403) {
      return { reachable: true, corsBlocked: false }
    }
    return { reachable: true, corsBlocked: false }
  } catch (err: any) {
    const msg = (err?.message || String(err)).toLowerCase()
    if (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('cors') ||
      msg.includes('cross-origin')
    ) {
      try {
        await fetch(url, { method: 'GET', mode: 'no-cors' })
        return { reachable: true, corsBlocked: true, rawError: err?.message }
      } catch {
        return { reachable: false, corsBlocked: false, rawError: err?.message }
      }
    }
    return { reachable: false, corsBlocked: false, rawError: err?.message }
  }
}

export async function detectOllama(baseURL: string): Promise<OllamaDetectResult> {
  const { apiURL, tagsURL } = normalizeBase(baseURL)
  try {
    const [versionRes, tagsRes] = await Promise.all([
      fetch(`${apiURL}/api/version`, { method: 'GET' }).catch(() => null),
      fetch(tagsURL, { method: 'GET' }),
    ])

    if (!tagsRes) {
      const probe = await probeOllamaRaw(apiURL)
      return {
        ok: false,
        models: [],
        error: probe.corsBlocked
          ? 'CORS blocked'
          : probe.reachable
          ? 'Request failed'
          : 'Ollama not reachable',
        cors: probe.corsBlocked,
      }
    }

    if (!tagsRes.ok) {
      return {
        ok: false,
        models: [],
        error: `HTTP ${tagsRes.status}: ${tagsRes.statusText}`,
        cors: false,
      }
    }

    let version: string | undefined
    if (versionRes && versionRes.ok) {
      try {
        const v: OllamaVersionResponse = await versionRes.json()
        version = v.version
      } catch {
        // ignore
      }
    }

    const data: OllamaTagsResponse = await tagsRes.json()
    return {
      ok: true,
      version,
      models: data.models || [],
    }
  } catch (err: any) {
    const msg = err?.message || String(err)
    const cors = msg.toLowerCase().includes('cors')
    return {
      ok: false,
      models: [],
      error: msg,
      cors,
    }
  }
}

export async function pullOllamaModel(
  baseURL: string,
  modelName: string,
  onProgress?: (event: OllamaPullEvent) => void,
): Promise<void> {
  const { apiURL } = normalizeBase(baseURL)
  const res = await fetch(`${apiURL}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName, stream: true }),
  })

  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${txt || res.statusText}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const event = JSON.parse(trimmed) as OllamaPullEvent
        if ('error' in event) {
          throw new Error(event.error)
        }
        onProgress?.(event)
      } catch (parseErr: any) {
        if (parseErr instanceof Error && parseErr.message !== 'Unexpected end of JSON input') {
          throw parseErr
        }
      }
    }
  }
}