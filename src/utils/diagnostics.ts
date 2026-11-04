import type { ModelConfig } from './settings-utils'
import {
  CTranslate2Health,
  CTranslate2RequestError,
  CTranslate2TimeoutError,
  fetchCTranslate2Health,
  matchesCTranslate2Model,
} from './ctranslate2'
import {
  DeepLRequestError,
  deeplEndpoint,
  deepLPlanWarning,
  fetchDeepLUsage,
  getDeepLApiKey,
  resolveDeepLPlan,
  type DeepLPlan,
} from './deepl'

export type DiagnosticStatus =
  | 'connected'
  | 'loading'
  | 'cors_blocked'
  | 'unreachable'
  | 'auth_error'
  | 'not_found'
  | 'model_mismatch'
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
  health?: CTranslate2Health
}

interface ProviderInfo {
  name: string
  baseURL: string
  apiKey: string
  modelName: string
  deeplPlan?: DeepLPlan
  deeplFreeKey?: string
  deeplProKey?: string
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

export async function runDeepLDiagnostic(
  config: ProviderInfo,
): Promise<DiagnosticResult> {
  const start = performance.now()
  const deeplConfig = {
    apiKey: config.apiKey,
    deeplPlan: config.deeplPlan,
    deeplFreeKey: config.deeplFreeKey,
    deeplProKey: config.deeplProKey,
  }
  const url = deeplEndpoint(deeplConfig)
  const plan = resolveDeepLPlan(deeplConfig)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const usage = await fetchDeepLUsage(deeplConfig, {
      signal: controller.signal,
    })
    const latency = Math.round(performance.now() - start)
    const detail =
      typeof usage.character_count === 'number' &&
      typeof usage.character_limit === 'number'
        ? `${usage.character_count}/${usage.character_limit} characters used`
        : undefined
    return {
      status: 'connected',
      latencyMs: latency,
      message: 'Connected',
      detail,
      provider: 'deepl',
      url,
      checkedAt: Date.now(),
    }
  } catch (err) {
    const latency = Math.round(performance.now() - start)
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        status: 'timeout',
        latencyMs: latency,
        message: 'DeepL usage check timed out (5s)',
        provider: 'deepl',
        url,
        checkedAt: Date.now(),
      }
    }
    if (err instanceof DeepLRequestError) {
      if (err.code === 'auth') {
        const warning = deepLPlanWarning(deeplConfig)
        const missingKey = getDeepLApiKey(deeplConfig) === ''
        let message = err.message
        if (warning === 'free-key-looks-pro') {
          message =
            'This key does not look like a DeepL Free key (no ":fx" ' +
            'suffix). Switch the plan to Pro or enter a Free key.'
        } else if (warning === 'pro-key-looks-free') {
          message =
            'This key looks like a DeepL Free key. Switch the plan to Free.'
        } else if (!missingKey) {
          message = `DeepL rejected the ${plan} API key (HTTP 403). Check the plan and key in Settings.`
        }
        return {
          status: 'auth_error',
          latencyMs: latency,
          message,
          detail: `plan=${plan}`,
          provider: 'deepl',
          url,
          checkedAt: Date.now(),
        }
      }
      if (err.code === 'quota') {
        return {
          status: 'unknown',
          latencyMs: latency,
          message: 'DeepL quota exhausted (HTTP 456).',
          detail: err.message,
          provider: 'deepl',
          url,
          checkedAt: Date.now(),
        }
      }
      if (err.code === 'rate_limit') {
        return {
          status: 'unknown',
          latencyMs: latency,
          message: err.message,
          provider: 'deepl',
          url,
          checkedAt: Date.now(),
        }
      }
      if (err.code === 'network') {
        return {
          status: 'unreachable',
          latencyMs: null,
          message: err.message,
          provider: 'deepl',
          url,
          checkedAt: Date.now(),
        }
      }
      return {
        status: 'unknown',
        latencyMs: latency,
        message: err.message,
        provider: 'deepl',
        url,
        checkedAt: Date.now(),
      }
    }
    const cls = classifyError(err)
    return {
      ...cls,
      latencyMs: null,
      provider: 'deepl',
      url,
      checkedAt: Date.now(),
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function runCTranslate2Diagnostic(
  config: ProviderInfo,
): Promise<DiagnosticResult> {
  const start = performance.now()
  try {
    const health = await fetchCTranslate2Health(
      {
        baseURL: config.baseURL,
        modelName: config.modelName,
      },
      { timeoutMs: 5000, validateModel: false },
    )
    const latency = Math.round(performance.now() - start)
    if (!matchesCTranslate2Model(health.model, config.modelName)) {
      return {
        status: 'model_mismatch',
        latencyMs: latency,
        message:
          `CTranslate2 server loaded "${health.model}" but the extension ` +
          `is set to "${config.modelName}".`,
        detail: `max_input_tokens=${health.max_input_tokens}`,
        provider: 'ctranslate2',
        url: config.baseURL,
        checkedAt: Date.now(),
        health,
      }
    }
    return {
      status: 'connected',
      latencyMs: latency,
      message: `Connected (${health.device}/${health.compute_type})`,
      detail: `max_input_tokens=${health.max_input_tokens}`,
      provider: 'ctranslate2',
      url: config.baseURL,
      checkedAt: Date.now(),
      health,
    }
  } catch (err: any) {
    const latency = Math.round(performance.now() - start)
    if (err instanceof CTranslate2TimeoutError) {
      return {
        status: 'timeout',
        latencyMs: latency,
        message: 'CTranslate2 health check timed out (5s)',
        detail: err.message,
        provider: 'ctranslate2',
        url: config.baseURL,
        checkedAt: Date.now(),
      }
    }
    if (err instanceof CTranslate2RequestError) {
      if (err.status === 503) {
        return {
          status: 'loading',
          latencyMs: latency,
          message:
            'CTranslate2 server is starting or the model is still loading.',
          detail: err.message,
          provider: 'ctranslate2',
          url: config.baseURL,
          checkedAt: Date.now(),
        }
      }
      let status: DiagnosticStatus = 'unknown'
      if (err.status === 401 || err.status === 403) {
        status = 'auth_error'
      } else if (err.status === 404) {
        status = 'not_found'
      }
      return {
        status,
        latencyMs: latency,
        message: err.message,
        provider: 'ctranslate2',
        url: config.baseURL,
        checkedAt: Date.now(),
      }
    }
    const cls = classifyError(err)
    return {
      ...cls,
      latencyMs: null,
      provider: 'ctranslate2',
      url: config.baseURL,
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
    deeplPlan: config.deeplPlan,
    deeplFreeKey: config.deeplFreeKey,
    deeplProKey: config.deeplProKey,
  }
  if (provider === 'ollama') return runOllamaDiagnostic(info)
  if (provider === 'google-translate') return runGoogleTranslateDiagnostic()
  if (provider === 'ctranslate2') return runCTranslate2Diagnostic(info)
  if (provider === 'deepl') return runDeepLDiagnostic(info)
  return runOpenAIDiagnostic(info)
}

export const DIAGNOSTIC_HINTS: Record<DiagnosticStatus, string> = {
  connected: 'All good. Translation requests will succeed.',
  loading:
    'The server is starting or the model is still loading. Wait and test again.',
  cors_blocked:
    'The server rejected the browser extension origin. Check its CORS policy.',
  unreachable:
    'Cannot reach the server. Make sure it is running and the URL is correct.',
  auth_error:
    'Authentication failed. Check your API key or CORS configuration.',
  not_found:
    'Endpoint or model not found. Verify the Base URL, model name and loaded model.',
  model_mismatch:
    'The running server has a different model loaded. Restart it with the selected model, or update the provider model name.',
  timeout:
    'Request took too long (>5s). The server may be slow or unreachable.',
  unknown: 'Unexpected error. See the detail field for more info.',
}