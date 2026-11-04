import type { ModelConfig } from './settings-utils'

export const DEEPL_FREE_BASE_URL = 'https://api-free.deepl.com/v2'
export const DEEPL_PRO_BASE_URL = 'https://api.deepl.com/v2'

export type DeepLPlan = 'free' | 'pro'
export const DEEPL_DEFAULT_PLAN: DeepLPlan = 'free'

export interface DeepLKeyFields {
  apiKey?: string
  deeplPlan?: DeepLPlan
  deeplFreeKey?: string
  deeplProKey?: string
}

function trimmedField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeDeepLPlan(value: unknown): DeepLPlan | null {
  return value === 'free' || value === 'pro' ? value : null
}

/** Legacy keys carry the Free marker as a `:fx` suffix. */
export function inferDeepLPlanFromKey(key: string | undefined): DeepLPlan | null {
  const value = trimmedField(key)
  if (!value) return null
  return value.endsWith(':fx') ? 'free' : 'pro'
}

export function resolveDeepLPlan(config: DeepLKeyFields): DeepLPlan {
  const explicit = normalizeDeepLPlan(config.deeplPlan)
  if (explicit) return explicit
  if (trimmedField(config.deeplFreeKey)) return 'free'
  if (trimmedField(config.deeplProKey)) return 'pro'
  return inferDeepLPlanFromKey(config.apiKey) ?? DEEPL_DEFAULT_PLAN
}

/**
 * Single source of truth for the DeepL credential. The plan-specific field
 * wins; a legacy `apiKey` is only used when its suffix matches that plan.
 */
export function getDeepLApiKey(config: DeepLKeyFields): string {
  const plan = resolveDeepLPlan(config)
  const planKey = trimmedField(
    plan === 'free' ? config.deeplFreeKey : config.deeplProKey,
  )
  if (planKey) return planKey
  const legacy = trimmedField(config.apiKey)
  if (!legacy) return ''
  return inferDeepLPlanFromKey(legacy) === plan ? legacy : ''
}

export type DeepLPlanWarning =
  | 'free-key-looks-pro'
  | 'pro-key-looks-free'
  | null

/**
 * Warn when the stored key shape contradicts the selected plan. Requests still
 * follow the plan; nothing is guessed or switched automatically.
 */
export function deepLPlanWarning(
  config: DeepLKeyFields,
): DeepLPlanWarning {
  const plan = resolveDeepLPlan(config)
  const planKey = trimmedField(
    plan === 'free' ? config.deeplFreeKey : config.deeplProKey,
  )
  const legacy = trimmedField(config.apiKey)
  const key =
    planKey ||
    (inferDeepLPlanFromKey(legacy) === plan ? legacy : '')
  if (!key) return null
  const looksFree = key.endsWith(':fx')
  if (plan === 'free' && !looksFree) return 'free-key-looks-pro'
  if (plan === 'pro' && looksFree) return 'pro-key-looks-free'
  return null
}

/**
 * Move a legacy `apiKey` into the plan-specific field and keep `apiKey`
 * mirrored to the selected plan. Idempotent for already-migrated configs.
 */
export function normalizeDeepLConfig(
  config: ModelConfig,
  defaultPlan: DeepLPlan = DEEPL_DEFAULT_PLAN,
): ModelConfig {
  const freeKey = trimmedField(config.deeplFreeKey)
  const proKey = trimmedField(config.deeplProKey)
  const legacy = trimmedField(config.apiKey)
  const plan =
    normalizeDeepLPlan(config.deeplPlan) ??
    (freeKey ? 'free' : proKey ? 'pro' : inferDeepLPlanFromKey(legacy)) ??
    defaultPlan

  let nextFree = freeKey
  let nextPro = proKey
  if (!nextFree && !nextPro && legacy) {
    if (inferDeepLPlanFromKey(legacy) === 'free') nextFree = legacy
    else nextPro = legacy
  }

  const selected = plan === 'free' ? nextFree : nextPro
  const next: ModelConfig = {
    ...config,
    deeplPlan: plan,
    apiKey: selected,
  }
  if (nextFree) next.deeplFreeKey = nextFree
  if (nextPro) next.deeplProKey = nextPro
  return next
}

export interface DeepLLanguageCodes {
  /** Target language code sent to /v2/translate. */
  target: string
  /** Source language code used when a source is explicitly requested. */
  source: string
}

/** The fourteen languages exposed by the extension, in extension order. */
export const DEEPL_LANGUAGE_CODES: Record<string, DeepLLanguageCodes> = {
  English: { target: 'EN-US', source: 'EN' },
  Turkish: { target: 'TR', source: 'TR' },
  Chinese: { target: 'ZH-HANS', source: 'ZH' },
  Spanish: { target: 'ES', source: 'ES' },
  French: { target: 'FR', source: 'FR' },
  German: { target: 'DE', source: 'DE' },
  Portuguese: { target: 'PT-BR', source: 'PT' },
  Italian: { target: 'IT', source: 'IT' },
  Russian: { target: 'RU', source: 'RU' },
  Japanese: { target: 'JA', source: 'JA' },
  Korean: { target: 'KO', source: 'KO' },
  Arabic: { target: 'AR', source: 'AR' },
  Dutch: { target: 'NL', source: 'NL' },
  Polish: { target: 'PL', source: 'PL' },
}

const DEEPL_ALIASES: Record<string, string> = {
  'en-us': 'EN-US',
  en: 'EN-US',
  'zh-cn': 'ZH-HANS',
  'zh-hans': 'ZH-HANS',
  zh: 'ZH-HANS',
  'pt-br': 'PT-BR',
  pt: 'PT-BR',
}

function normalizeLanguageKey(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '-')
}

/**
 * Resolve a language label or DeepL code to a language entry. Unknown values
 * return null instead of silently falling back to English.
 */
function resolveDeepLLanguage(
  value: string | undefined,
  useAliases: boolean,
): DeepLLanguageCodes | null {
  const input = normalizeLanguageKey(value || '')
  if (!input) return null
  for (const [label, codes] of Object.entries(DEEPL_LANGUAGE_CODES)) {
    if (label.toLowerCase() === input) return codes
    if (codes.target.toLowerCase() === input) return codes
    if (codes.source.toLowerCase() === input) return codes
  }
  if (!useAliases) return null
  const alias = DEEPL_ALIASES[input]
  if (!alias) return null
  return (
    Object.values(DEEPL_LANGUAGE_CODES).find(
      (codes) => codes.target === alias,
    ) || null
  )
}

export function resolveDeepLTargetCode(value?: string): string | null {
  return resolveDeepLLanguage(value, true)?.target ?? null
}

export function resolveDeepLSourceCode(value?: string): string | null {
  return resolveDeepLLanguage(value, true)?.source ?? null
}

/**
 * The selected plan, never the key suffix, chooses the host. The stored base
 * URL is informational; requests always use this function.
 */
export function deeplEndpoint(config: DeepLKeyFields, path = ''): string {
  const base =
    resolveDeepLPlan(config) === 'free'
      ? DEEPL_FREE_BASE_URL
      : DEEPL_PRO_BASE_URL
  const suffix = path.replace(/^\/+/, '')
  return suffix ? `${base}/${suffix}` : base
}

export const DEEPL_REQUEST_TIMEOUT_MS = 30000
export const DEEPL_RETRY_BASE_MS = 500
export const DEEPL_RETRY_MAX_MS = 2000

export type DeepLErrorCode =
  | 'auth'
  | 'quota'
  | 'rate_limit'
  | 'language'
  | 'blocked'
  | 'empty'
  | 'network'

export class DeepLRequestError extends Error {
  public readonly code: DeepLErrorCode
  public readonly status: number | null

  constructor(
    message: string,
    code: DeepLErrorCode,
    status: number | null = null,
  ) {
    super(message)
    this.name = 'DeepLRequestError'
    this.code = code
    this.status = status
  }
}

export interface DeepLTranslationRequestBody {
  text: string[]
  target_lang: string
  source_lang?: string
  preserve_formatting: boolean
}

/**
 * Build the /v2/translate body. The source is omitted (DeepL auto-detects)
 * unless the provider config explicitly sets one.
 */
export function buildDeepLTranslationRequest(
  config: Pick<ModelConfig, 'sourceLanguage' | 'targetLanguage'>,
  text: string,
): DeepLTranslationRequestBody {
  const target = resolveDeepLTargetCode(config.targetLanguage)
  if (!target) {
    throw new DeepLRequestError(
      `Unsupported DeepL target language "${config.targetLanguage || ''}". ` +
        'Choose one of the supported languages in Settings.',
      'language',
      400,
    )
  }
  const body: DeepLTranslationRequestBody = {
    text: [text],
    target_lang: target,
    preserve_formatting: true,
  }
  const sourceLabel = (config.sourceLanguage || '').trim()
  if (sourceLabel && sourceLabel.toLowerCase() !== 'auto') {
    const source = resolveDeepLSourceCode(sourceLabel)
    if (!source) {
      throw new DeepLRequestError(
        `Unsupported DeepL source language "${sourceLabel}". ` +
          'Choose one of the supported languages in Settings.',
        'language',
        400,
      )
    }
    body.source_lang = source
  }
  return body
}

function mapDeepLStatus(status: number): DeepLErrorCode {
  if (status === 401 || status === 403) return 'auth'
  if (status === 456) return 'quota'
  if (status === 429) return 'rate_limit'
  if (status === 400) return 'language'
  if (status === 413) return 'blocked'
  return 'network'
}

function deepLErrorFromStatus(status: number): DeepLRequestError {
  const code = mapDeepLStatus(status)
  if (code === 'auth') {
    return new DeepLRequestError(
      'DeepL rejected the API key (HTTP 403). Check the key in Settings.',
      code,
      status,
    )
  }
  if (code === 'quota') {
    return new DeepLRequestError(
      'DeepL quota exceeded (HTTP 456). The free monthly limit is used up.',
      code,
      status,
    )
  }
  if (code === 'rate_limit') {
    return new DeepLRequestError(
      'DeepL is receiving too many requests (HTTP 429). Try again shortly.',
      code,
      status,
    )
  }
  if (code === 'language') {
    return new DeepLRequestError(
      'DeepL does not support this language pair (HTTP 400).',
      code,
      status,
    )
  }
  return new DeepLRequestError(`DeepL request failed (HTTP ${status}).`, code, status)
}

/**
 * Honor DeepL's Retry-After (seconds) for a 429, capped at two seconds so a
 * stalled quota does not block the subtitle flow for long.
 */
export function retryAfterDelayMs(
  headerValue: string | null | undefined,
): number {
  if (!headerValue) return DEEPL_RETRY_BASE_MS
  const seconds = Number(headerValue.trim())
  if (!Number.isFinite(seconds) || seconds <= 0) return DEEPL_RETRY_BASE_MS
  return Math.min(DEEPL_RETRY_MAX_MS, Math.round(seconds * 1000))
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function readTranslationText(payload: unknown): string | null {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('translations' in payload)
  ) {
    return null
  }
  const translations = payload.translations
  if (!Array.isArray(translations) || translations.length === 0) return null
  const first: unknown = translations[0]
  if (!first || typeof first !== 'object' || !('text' in first)) return null
  return typeof first.text === 'string' ? first.text : null
}

function readUsage(payload: unknown): DeepLUsage {
  if (!payload || typeof payload !== 'object') return {}
  const usage: DeepLUsage = {}
  if (
    'character_count' in payload &&
    typeof payload.character_count === 'number'
  ) {
    usage.character_count = payload.character_count
  }
  if (
    'character_limit' in payload &&
    typeof payload.character_limit === 'number'
  ) {
    usage.character_limit = payload.character_limit
  }
  return usage
}

export interface DeepLRequestOptions {
  signal?: AbortSignal
}

/**
 * Translate one subtitle line. Never includes the API key in an error
 * message or a URL.
 */
export async function requestDeepLTranslation(
  config: DeepLKeyFields &
    Partial<Pick<ModelConfig, 'sourceLanguage' | 'targetLanguage'>>,
  text: string,
  options: DeepLRequestOptions = {},
): Promise<string> {
  const plan = resolveDeepLPlan(config)
  const apiKey = getDeepLApiKey(config)
  if (!apiKey) {
    throw new DeepLRequestError(
      plan === 'free'
        ? 'DeepL Free API key is missing. Add it in Settings.'
        : 'DeepL Pro API key is missing. Add it in Settings.',
      'auth',
      403,
    )
  }
  const body = buildDeepLTranslationRequest(config, text)
  const url = deeplEndpoint(config, 'translate')

  for (let attempt = 0; ; attempt += 1) {
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `DeepL-Auth-Key ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: options.signal,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new DeepLRequestError(
        'Could not reach DeepL. Check the network connection.',
        'network',
        null,
      )
    }

    const payload: unknown = await response.json().catch(() => null)
    if (response.ok) {
      const translated = readTranslationText(payload)
      if (translated === null || !translated.trim()) {
        throw new DeepLRequestError(
          'DeepL returned an empty translation.',
          'empty',
          response.status,
        )
      }
      return translated.trim()
    }

    const retryable = response.status === 429 || response.status >= 500
    if (retryable && attempt === 0) {
      const waitMs =
        response.status === 429
          ? retryAfterDelayMs(response.headers.get('retry-after'))
          : DEEPL_RETRY_BASE_MS
      await delay(waitMs, options.signal)
      continue
    }
    throw deepLErrorFromStatus(response.status)
  }
}

export interface DeepLUsage {
  character_count?: number
  character_limit?: number
}

/**
 * Read the account usage. Used by the connection test: it authenticates the
 * key without consuming translation characters.
 */
export async function fetchDeepLUsage(
  config: DeepLKeyFields,
  options: DeepLRequestOptions = {},
): Promise<DeepLUsage> {
  const plan = resolveDeepLPlan(config)
  const apiKey = getDeepLApiKey(config)
  if (!apiKey) {
    throw new DeepLRequestError(
      plan === 'free'
        ? 'DeepL Free API key is missing. Add it in Settings.'
        : 'DeepL Pro API key is missing. Add it in Settings.',
      'auth',
      403,
    )
  }
  let response: Response
  try {
    response = await fetch(deeplEndpoint(config, 'usage'), {
      method: 'GET',
      headers: { Authorization: `DeepL-Auth-Key ${apiKey}` },
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new DeepLRequestError(
      'Could not reach DeepL. Check the network connection.',
      'network',
      null,
    )
  }
  if (!response.ok) {
    throw deepLErrorFromStatus(response.status)
  }
  const payload: unknown = await response.json().catch(() => null)
  return readUsage(payload)
}
