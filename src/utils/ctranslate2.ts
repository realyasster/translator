import type { ModelConfig } from './settings-utils'

/** NLLB codes for the fourteen languages exposed by the extension UI. */
export const NLLB_LANGUAGE_CODES: Record<string, string> = {
  English: 'eng_Latn',
  Turkish: 'tur_Latn',
  Chinese: 'zho_Hans',
  Spanish: 'spa_Latn',
  French: 'fra_Latn',
  German: 'deu_Latn',
  Portuguese: 'por_Latn',
  Italian: 'ita_Latn',
  Russian: 'rus_Cyrl',
  Japanese: 'jpn_Jpan',
  Korean: 'kor_Hang',
  Arabic: 'arb_Arab',
  Dutch: 'nld_Latn',
  Polish: 'pol_Latn',
}

export const DEFAULT_CTRANSLATE2_SOURCE_LANGUAGE = 'English'
export const DEFAULT_CTRANSLATE2_TARGET_LANGUAGE = 'English'
export const CTRANSLATE2_REQUEST_TIMEOUT_MS = 30000
export const CTRANSLATE2_HEALTH_TIMEOUT_MS = 5000
export const CTRANSLATE2_MAX_INPUT_TOKENS = 512

export interface CTranslate2TranslationRequest {
  model: string
  text: string
  source_lang: string
  target_lang: string
}

export interface CTranslate2Health {
  status: 'ready'
  model: string
  /** Folder name only; servers deliberately do not expose the full path. */
  model_dir?: string
  /** nllb, m2m100, mbart50 or marian (older servers omit it). */
  family?: string
  /** Present for single-pair Marian models. */
  language_pairs?: [string, string][] | null
  device: string
  compute_type: string
  max_input_tokens: number
}

export class CTranslate2RequestError extends Error {
  public readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'CTranslate2RequestError'
    this.status = status
  }
}

export class CTranslate2TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `CTranslate2 request timed out after ${Math.round(timeoutMs / 1000)} seconds`,
    )
    this.name = 'CTranslate2TimeoutError'
  }
}

export class CTranslate2AbortError extends Error {
  constructor() {
    super('CTranslate2 request aborted')
    this.name = 'AbortError'
  }
}

/**
 * Resolve a language label or NLLB code. Unknown values deliberately return
 * null instead of falling back to English.
 */
export function resolveNllbLanguageCode(value?: string): string | null {
  const input = (value || '').trim()
  if (!input) return null
  const normalized = input.toLowerCase()
  for (const [label, code] of Object.entries(NLLB_LANGUAGE_CODES)) {
    if (label.toLowerCase() === normalized || code.toLowerCase() === normalized) {
      return code
    }
  }
  return null
}

export function resolveCTranslate2SourceCode(
  config: Pick<ModelConfig, 'sourceLanguage'>,
): string {
  const label =
    config.sourceLanguage || DEFAULT_CTRANSLATE2_SOURCE_LANGUAGE
  const code = resolveNllbLanguageCode(label)
  if (!code) {
    throw new CTranslate2RequestError(
      `Unsupported CTranslate2 source language "${label}". ` +
        'Choose one of the supported languages in Settings.',
      422,
    )
  }
  return code
}

export function resolveCTranslate2TargetCode(
  config: Pick<ModelConfig, 'targetLanguage'>,
): string {
  const label =
    config.targetLanguage || DEFAULT_CTRANSLATE2_TARGET_LANGUAGE
  const code = resolveNllbLanguageCode(label)
  if (!code) {
    throw new CTranslate2RequestError(
      `Unsupported CTranslate2 target language "${label}". ` +
        'Choose one of the supported languages in Settings.',
      422,
    )
  }
  return code
}

export function normalizeCTranslate2BaseURL(baseURL: string): string {
  const trimmed = (baseURL || '').trim().replace(/\/+$/, '')
  return trimmed.replace(/\/(?:translate|health)$/i, '')
}

export function buildCTranslate2Request(
  config: Pick<ModelConfig, 'modelName' | 'sourceLanguage' | 'targetLanguage'>,
  text: string,
): CTranslate2TranslationRequest {
  return {
    model: config.modelName,
    text,
    source_lang: resolveCTranslate2SourceCode(config),
    target_lang: resolveCTranslate2TargetCode(config),
  }
}

interface DeadlineResponse {
  response: Response
  bodyText: string
  bodyJson: unknown
  jsonInvalid: boolean
}

async function fetchWithDeadline(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<DeadlineResponse> {
  const controller = new AbortController()
  let timedOut = false
  const abortFromOutside = () => controller.abort()

  if (externalSignal?.aborted) {
    throw new CTranslate2AbortError()
  }
  externalSignal?.addEventListener('abort', abortFromOutside, { once: true })

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    // Keep the deadline active through body consumption and JSON parsing.
    const bodyText = await response.text()
    let bodyJson: unknown
    let jsonInvalid = true
    if (bodyText.trim() !== '') {
      try {
        bodyJson = JSON.parse(bodyText)
        jsonInvalid = false
      } catch {
        jsonInvalid = true
      }
    }
    return { response, bodyText, bodyJson, jsonInvalid }
  } catch (error: any) {
    if (externalSignal?.aborted) throw new CTranslate2AbortError()
    if (timedOut || error?.name === 'AbortError') {
      throw new CTranslate2TimeoutError(timeoutMs)
    }
    throw error
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', abortFromOutside)
  }
}

function errorDetailFromBody(result: DeadlineResponse): string {
  if (!result.bodyText) return ''
  if (!result.jsonInvalid) {
    const detail = (result.bodyJson as any)?.detail
    if (typeof detail === 'string') return detail
    if (detail !== undefined) return JSON.stringify(detail)
  }
  return result.bodyText.slice(0, 300)
}

export function matchesCTranslate2Model(
  loadedModel: string,
  selectedModel: string,
): boolean {
  return loadedModel === selectedModel
}

function throwResponseError(result: DeadlineResponse): never {
  const detail = errorDetailFromBody(result)
  const message = detail
    ? `CTranslate2 server error (${result.response.status}): ${detail}`
    : `CTranslate2 server returned HTTP ${result.response.status}`
  throw new CTranslate2RequestError(message, result.response.status)
}

export function isCTranslate2HealthResponse(
  value: unknown,
): value is CTranslate2Health {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CTranslate2Health>
  return (
    candidate.status === 'ready' &&
    typeof candidate.model === 'string' &&
    candidate.model.trim() !== '' &&
    (candidate.model_dir === undefined ||
      typeof candidate.model_dir === 'string') &&
    (candidate.family === undefined || typeof candidate.family === 'string') &&
    (candidate.language_pairs === undefined ||
      candidate.language_pairs === null ||
      (Array.isArray(candidate.language_pairs) &&
        candidate.language_pairs.every(
          (pair) =>
            Array.isArray(pair) &&
            pair.length === 2 &&
            pair.every((code) => typeof code === 'string'),
        ))) &&
    typeof candidate.device === 'string' &&
    candidate.device.trim() !== '' &&
    typeof candidate.compute_type === 'string' &&
    candidate.compute_type.trim() !== '' &&
    typeof candidate.max_input_tokens === 'number' &&
    Number.isFinite(candidate.max_input_tokens)
  )
}

export async function requestCTranslate2Translation(
  config: Pick<
    ModelConfig,
    'baseURL' | 'modelName' | 'sourceLanguage' | 'targetLanguage'
  >,
  text: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
  if (!(text || '').trim()) {
    throw new CTranslate2RequestError('Text must not be blank.', 422)
  }
  const baseURL = normalizeCTranslate2BaseURL(config.baseURL)
  if (!baseURL) {
    throw new CTranslate2RequestError(
      'CTranslate2 server URL is not configured.',
    )
  }
  const timeoutMs = options.timeoutMs ?? CTRANSLATE2_REQUEST_TIMEOUT_MS
  const body = buildCTranslate2Request(config, text)

  const result = await fetchWithDeadline(
    `${baseURL}/translate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    timeoutMs,
    options.signal,
  )

  if (!result.response.ok) throwResponseError(result)
  if (result.jsonInvalid) {
    throw new CTranslate2RequestError(
      'CTranslate2 server returned invalid JSON.',
      result.response.status,
    )
  }
  const translatedText = (result.bodyJson as any)?.translatedText
  if (typeof translatedText !== 'string' || translatedText.trim() === '') {
    throw new CTranslate2RequestError(
      'CTranslate2 server returned an empty or invalid translation.',
      result.response.status,
    )
  }
  return translatedText
}

export async function fetchCTranslate2Health(
  config: Pick<ModelConfig, 'baseURL' | 'modelName'>,
  options: {
    signal?: AbortSignal
    timeoutMs?: number
    validateModel?: boolean
  } = {},
): Promise<CTranslate2Health> {
  const baseURL = normalizeCTranslate2BaseURL(config.baseURL)
  if (!baseURL) {
    throw new CTranslate2RequestError(
      'CTranslate2 server URL is not configured.',
    )
  }
  const result = await fetchWithDeadline(
    `${baseURL}/health`,
    { method: 'GET' },
    options.timeoutMs ?? CTRANSLATE2_HEALTH_TIMEOUT_MS,
    options.signal,
  )
  if (!result.response.ok) throwResponseError(result)
  if (result.jsonInvalid) {
    throw new CTranslate2RequestError(
      'CTranslate2 health check returned invalid JSON.',
      result.response.status,
    )
  }
  const data = result.bodyJson
  if (!isCTranslate2HealthResponse(data)) {
    throw new CTranslate2RequestError(
      'CTranslate2 health check returned an unexpected shape.',
      result.response.status,
    )
  }
  if (
    options.validateModel !== false &&
    !matchesCTranslate2Model(data.model, config.modelName)
  ) {
    throw new CTranslate2RequestError(
      `CTranslate2 server loaded "${data.model}" but the extension is set to ` +
        `"${config.modelName}".`,
      404,
    )
  }
  return data
}
