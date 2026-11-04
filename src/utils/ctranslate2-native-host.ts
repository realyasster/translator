import type { CTranslate2Health } from './ctranslate2'
import type { CTranslate2ServerSettings } from './ctranslate2-server-settings'

export const CTRANSLATE2_NATIVE_HOST_NAME =
  'com.realyasster.universal_subtitle_translator.ct2_launcher'

// v6 runs the server hidden (pythonw.exe + CREATE_NO_WINDOW) and builds the
// launcher with PyInstaller --noconsole.
// v5 introduced the single install root %LOCALAPPDATA%\UniversalSubtitleTranslator
// (venv, models, native-host).
// Must match HOST_VERSION in server/src/ct2_nllb_server/native_host.py.
export const CT2_HOST_VERSION = 6

export const CTRANSLATE2_NATIVE_TIMEOUT_MS = 75000

export type NativeBrowser = 'chrome' | 'edge'

export function isValidChromeExtensionId(value: string): boolean {
  return /^[a-p]{32}$/.test(value)
}

export function detectNativeBrowser(
  userAgent?: string,
): NativeBrowser {
  const ua =
    userAgent ??
    (typeof navigator !== 'undefined' ? navigator.userAgent || '' : '')
  return /Edg\//i.test(ua) ? 'edge' : 'chrome'
}

export type NativeServerState = 'stopped' | 'running' | 'external_running'

export interface NativeModelEntry {
  directory: string
  name: string
  model_id: string | null
  family: string | null
  revision: string | null
  valid: boolean
  problem: string | null
}

export interface NativeServerStatus {
  action: 'ping' | 'status' | 'start' | 'stop' | 'list_models'
  state?: NativeServerState
  managed?: boolean
  pid?: number
  hostVersion?: number
  health?: CTranslate2Health
  models?: NativeModelEntry[]
}

export class CTranslate2NativeHostError extends Error {
  public readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CTranslate2NativeHostError'
    this.code = code
  }
}

type NativeResponse = {
  ok?: boolean
  code?: string
  message?: string
  action?: string
  state?: string
  managed?: boolean
  pid?: number
  hostVersion?: number
  health?: unknown
  models?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isHealth(value: unknown): value is CTranslate2Health {
  if (!isRecord(value)) return false
  return (
    value.status === 'ready' &&
    typeof value.model === 'string' &&
    (value.model_dir === undefined || typeof value.model_dir === 'string') &&
    typeof value.device === 'string' &&
    typeof value.compute_type === 'string' &&
    typeof value.max_input_tokens === 'number'
  )
}

function isModelEntry(value: unknown): value is NativeModelEntry {
  if (!isRecord(value)) return false
  return (
    typeof value.directory === 'string' &&
    typeof value.name === 'string' &&
    (value.model_id === null || typeof value.model_id === 'string') &&
    (value.family === null || typeof value.family === 'string') &&
    (value.revision === null || typeof value.revision === 'string') &&
    typeof value.valid === 'boolean' &&
    (value.problem === null || typeof value.problem === 'string')
  )
}

function normalizeNativeResponse(
  response: unknown,
): NativeServerStatus {
  if (!isRecord(response)) {
    throw new CTranslate2NativeHostError(
      'native_host_invalid_response',
      'Native host returned an empty or invalid response.',
    )
  }
  const candidate = response as NativeResponse
  if (candidate.ok === false) {
    throw new CTranslate2NativeHostError(
      candidate.code || 'native_host_error',
      candidate.message || 'Native host request failed.',
    )
  }
  if (candidate.ok !== true) {
    throw new CTranslate2NativeHostError(
      'native_host_invalid_response',
      'Native host returned an invalid response.',
    )
  }
  const state = candidate.state
  if (
    state !== undefined &&
    state !== 'stopped' &&
    state !== 'running' &&
    state !== 'external_running'
  ) {
    throw new CTranslate2NativeHostError(
      'native_host_invalid_response',
      `Native host returned an unknown server state: ${String(state)}`,
    )
  }
  const action =
    candidate.action === 'ping' ||
    candidate.action === 'status' ||
    candidate.action === 'start' ||
    candidate.action === 'stop' ||
    candidate.action === 'list_models'
      ? candidate.action
      : null
  if (!action) {
    throw new CTranslate2NativeHostError(
      'native_host_invalid_response',
      'Native host returned no recognized action.',
    )
  }
  const statefulAction =
    action === 'status' || action === 'start' || action === 'stop'
  if (statefulAction && state === undefined) {
    throw new CTranslate2NativeHostError(
      'native_host_invalid_response',
      'Native host returned no server state.',
    )
  }
  if (candidate.health !== undefined && !isHealth(candidate.health)) {
    throw new CTranslate2NativeHostError(
      'native_host_invalid_response',
      'Native host returned an invalid health payload.',
    )
  }
  if (
    candidate.models !== undefined &&
    (!Array.isArray(candidate.models) ||
      !candidate.models.every(isModelEntry))
  ) {
    throw new CTranslate2NativeHostError(
      'native_host_invalid_response',
      'Native host returned an invalid model list.',
    )
  }
  if (action === 'list_models' && candidate.models === undefined) {
    throw new CTranslate2NativeHostError(
      'native_host_invalid_response',
      'Native host returned no model list.',
    )
  }
  return {
    action,
    state: state as NativeServerState | undefined,
    managed:
      typeof candidate.managed === 'boolean'
        ? candidate.managed
        : undefined,
    pid:
      typeof candidate.pid === 'number' && Number.isFinite(candidate.pid)
        ? candidate.pid
        : undefined,
    hostVersion:
      typeof candidate.hostVersion === 'number'
        ? candidate.hostVersion
        : undefined,
    health: candidate.health as CTranslate2Health | undefined,
    models: candidate.models as NativeModelEntry[] | undefined,
  }
}

function nativeUnavailableError(): CTranslate2NativeHostError {
  return new CTranslate2NativeHostError(
    'native_messaging_unavailable',
    'Native messaging is not available in this extension context.',
  )
}

export function sendCTranslate2NativeMessage(
  request: Record<string, unknown>,
  timeoutMs = CTRANSLATE2_NATIVE_TIMEOUT_MS,
): Promise<NativeServerStatus> {
  return new Promise((resolve, reject) => {
    if (
      typeof chrome === 'undefined' ||
      !chrome.runtime ||
      typeof chrome.runtime.sendNativeMessage !== 'function'
    ) {
      reject(nativeUnavailableError())
      return
    }
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new CTranslate2NativeHostError(
            'native_host_timeout',
            `Native host did not respond within ${Math.round(
              timeoutMs / 1000,
            )} seconds.`,
          ),
        ),
      )
    }, timeoutMs)

    try {
      chrome.runtime.sendNativeMessage(
        CTRANSLATE2_NATIVE_HOST_NAME,
        request,
        (response: unknown) => {
          const lastError = chrome.runtime.lastError
          if (lastError) {
            const message =
              lastError.message || 'Native messaging host failed.'
            const lower = message.toLowerCase()
            finish(() =>
              reject(
                new CTranslate2NativeHostError(
                  lower.includes('not found')
                    ? 'native_host_not_installed'
                    : lower.includes('forbidden')
                    ? 'native_host_forbidden'
                    : 'native_host_error',
                  message,
                ),
              ),
            )
            return
          }
          try {
            const normalized = normalizeNativeResponse(response)
            finish(() => resolve(normalized))
          } catch (error: any) {
            finish(() => reject(error))
          }
        },
      )
    } catch (error: any) {
      finish(() =>
        reject(
          new CTranslate2NativeHostError(
            'native_host_error',
            error?.message || String(error),
          ),
        ),
      )
    }
  })
}

export async function pingCTranslate2NativeHost(): Promise<NativeServerStatus> {
  return sendCTranslate2NativeMessage({ action: 'ping' }, 5000)
}

export async function getCTranslate2NativeServerStatus(
  settings?: Partial<CTranslate2ServerSettings>,
): Promise<NativeServerStatus> {
  const payload: Record<string, unknown> = { action: 'status' }
  if (settings) {
    payload.settings = {
      host: settings.host,
      port: settings.port,
    }
  }
  return sendCTranslate2NativeMessage(payload)
}

export async function listCTranslate2NativeModels(): Promise<
  NativeServerStatus
> {
  return sendCTranslate2NativeMessage({ action: 'list_models' }, 15000)
}

export async function startCTranslate2NativeServer(
  settings: CTranslate2ServerSettings,
  selectedModel: string,
): Promise<NativeServerStatus> {
  return sendCTranslate2NativeMessage({
    action: 'start',
    selectedModel,
    settings: {
      modelDirectory: settings.modelDirectory,
      device: settings.device,
      computeType: settings.computeType,
      host: settings.host,
      port: settings.port,
      logLevel: settings.logLevel,
    },
  })
}

export async function stopCTranslate2NativeServer(
  settings?: Pick<CTranslate2ServerSettings, 'host' | 'port'>,
): Promise<NativeServerStatus> {
  const payload: Record<string, unknown> = { action: 'stop' }
  if (settings) {
    payload.settings = {
      host: settings.host,
      port: settings.port,
    }
  }
  return sendCTranslate2NativeMessage(payload)
}
