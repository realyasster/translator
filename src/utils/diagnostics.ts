export type DiagnosticStatus =
  | 'connected'
  | 'cors_blocked'
  | 'unreachable'
  | 'auth_error'
  | 'not_found'
  | 'timeout'
  | 'unknown'

export interface DiagnosticResult {
  status: DiagnosticStatus
  latencyMs: number | null
  message: string
  detail?: string
  provider: string
  url: string
  checkedAt: number
}

interface ModelConfig {
  baseURL: string
  apiKey: string
  modelName: string
}

interface ProviderInfo {
  name: string
  baseURL: string
  apiKey: string
  modelName: string
}

function timeoutFetch(url: string, options: RequestInit = {}, ms = 5000): Promise<Response> {
  const ctrl = new AbortController()
  const tid = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() =>
    clearTimeout(tid),
  )
}

function classifyError(err: any): { status: DiagnosticStatus; message: string; detail?: string } {
  const msg = (err?.message || String(err) || '').toLowerCase()
  if (err?.name === 'AbortError' || msg.includes('aborted')) {
    return { status: 'timeout', message: 'Request timed out (5s)', detail: err.message }
  }
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network request failed')) {
    return { status: 'unreachable', message: 'Connection refused or network error', detail: err.message }
  }
  if (msg.includes('cors') || msg.includes('cross-origin')) {
    return { status: 'cors_blocked', message: 'CORS blocked by server', detail: err.message }
  }
  return { status: 'unknown', message: err.message || 'Unknown error' }
}

export async function runOllamaDiagnostic(config: ProviderInfo): Promise<DiagnosticResult> {
  const start = performance.now()
  const baseURL = (config.baseURL || '').trim().replace(/\/+$/, '').replace(/\/v1$/, '')
  const url = `${baseURL}/api/version`
  try {
    const res = await timeoutFetch(url, { method: 'GET' })
    const latency = Math.round(performance.now() - start)
    if (res.ok) {
      return {
        status: 'connected',
        latencyMs: latency,
        message: 'Connected',
        provider: 'ollama',
        url: config.baseURL,
        checkedAt: Date.now(),
      }
    }
    if (res.status === 403 || res.status === 401) {
      return {
        status: 'auth_error',
        latencyMs: latency,
        message: `HTTP ${res.status}: Ollama rejected request (likely CORS)`,
        provider: 'ollama',
        url: config.baseURL,
        checkedAt: Date.now(),
      }
    }
    return {
      status: 'unknown',
      latencyMs: latency,
      message: `HTTP ${res.status}: ${res.statusText}`,
      provider: 'ollama',
      url: config.baseURL,
      checkedAt: Date.now(),
    }
  } catch (err: any) {
    const cls = classifyError(err)
    return {
      ...cls,
      latencyMs: null,
      provider: 'ollama',
      url: config.baseURL,
      checkedAt: Date.now(),
    }
  }
}

export async function runOpenAIDiagnostic(config: ProviderInfo): Promise<DiagnosticResult> {
  const start = performance.now()
  const url = (config.baseURL || '').trim().replace(/\/+$/, '') + '/models'
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`
  try {
    const res = await timeoutFetch(url, { method: 'GET', headers })
    const latency = Math.round(performance.now() - start)
    if (res.ok) {
      return {
        status: 'connected',
        latencyMs: latency,
        message: 'Connected',
        provider: 'openai-compatible',
        url: config.baseURL,
        checkedAt: Date.now(),
      }
    }
    if (res.status === 401 || res.status === 403) {
      return {
        status: 'auth_error',
        latencyMs: latency,
        message: `HTTP ${res.status}: Invalid API Key`,
        provider: 'openai-compatible',
        url: config.baseURL,
        checkedAt: Date.now(),
      }
    }
    if (res.status === 404) {
      return {
        status: 'not_found',
        latencyMs: latency,
        message: `HTTP 404: Endpoint not found. Check Base URL.`,
        provider: 'openai-compatible',
        url: config.baseURL,
        checkedAt: Date.now(),
      }
    }
    return {
      status: 'unknown',
      latencyMs: latency,
      message: `HTTP ${res.status}: ${res.statusText}`,
      provider: 'openai-compatible',
      url: config.baseURL,
      checkedAt: Date.now(),
    }
  } catch (err: any) {
    const cls = classifyError(err)
    return {
      ...cls,
      latencyMs: null,
      provider: 'openai-compatible',
      url: config.baseURL,
      checkedAt: Date.now(),
    }
  }
}

export async function runGoogleTranslateDiagnostic(): Promise<DiagnosticResult> {
  const start = performance.now()
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=test'
  try {
    const res = await timeoutFetch(url, { method: 'GET' })
    const latency = Math.round(performance.now() - start)
    if (res.ok) {
      return {
        status: 'connected',
        latencyMs: latency,
        message: 'Connected',
        provider: 'google-translate',
        url: 'https://translate.googleapis.com',
        checkedAt: Date.now(),
      }
    }
    return {
      status: 'unknown',
      latencyMs: latency,
      message: `HTTP ${res.status}: ${res.statusText}`,
      provider: 'google-translate',
      url: 'https://translate.googleapis.com',
      checkedAt: Date.now(),
    }
  } catch (err: any) {
    const cls = classifyError(err)
    return {
      ...cls,
      latencyMs: null,
      provider: 'google-translate',
      url: 'https://translate.googleapis.com',
      checkedAt: Date.now(),
    }
  }
}

export async function runDiagnostic(
  provider: string,
  config: ModelConfig,
): Promise<DiagnosticResult> {
  const info: ProviderInfo = {
    name: provider,
    baseURL: config.baseURL || '',
    apiKey: config.apiKey || '',
    modelName: config.modelName || '',
  }
  if (provider === 'ollama') return runOllamaDiagnostic(info)
  if (provider === 'google-translate') return runGoogleTranslateDiagnostic()
  return runOpenAIDiagnostic(info)
}

export const DIAGNOSTIC_HINTS: Record<DiagnosticStatus, string> = {
  connected: 'All good. Translation requests will succeed.',
  cors_blocked:
    'Ollama rejects browser extension requests. Restart it with OLLAMA_ORIGINS env var.',
  unreachable:
    'Cannot reach the server. Make sure it is running and the URL is correct.',
  auth_error:
    'Authentication failed. Check your API key or CORS configuration.',
  not_found:
    'Endpoint not found. Verify Base URL ends with /v1 (for OpenAI-compatible APIs).',
  timeout:
    'Request took too long (>5s). The server may be slow or unreachable.',
  unknown: 'Unexpected error. See the detail field for more info.',
}