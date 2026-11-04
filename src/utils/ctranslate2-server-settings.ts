export const CTRANSLATE2_SERVER_SETTINGS_STORAGE_KEY =
  'ctranslate2ServerSettings'

export const CTRANSLATE2_DEVICES = ['cpu', 'cuda'] as const
export type CTranslate2Device = (typeof CTRANSLATE2_DEVICES)[number]

export const CTRANSLATE2_COMPUTE_TYPES = [
  'default',
  'auto',
  'int8',
  'int8_float32',
  'int8_float16',
  'int8_bfloat16',
  'int16',
  'float16',
  'float32',
  'bfloat16',
] as const
export type CTranslate2ComputeType =
  (typeof CTRANSLATE2_COMPUTE_TYPES)[number]

export const CTRANSLATE2_HOSTS = ['127.0.0.1', 'localhost'] as const
export type CTranslate2Host = (typeof CTRANSLATE2_HOSTS)[number]

export const CTRANSLATE2_SHELLS = ['powershell', 'bash'] as const
export type CTranslate2Shell = (typeof CTRANSLATE2_SHELLS)[number]

export const CTRANSLATE2_LOG_LEVELS = [
  'error',
  'warning',
  'info',
  'debug',
] as const
export type CTranslate2LogLevel = (typeof CTRANSLATE2_LOG_LEVELS)[number]

// Stable Chromium extension ID derived from the "key" in public/manifest.json.
// A test keeps both values in sync.
export const CT2_EXTENSION_ID = 'jjpnokgnapgibbacgponlpkeejlcffgh'

export interface CTranslate2ServerSettings {
  modelDirectory: string
  device: CTranslate2Device
  computeType: CTranslate2ComputeType
  host: CTranslate2Host
  port: number
  shell: CTranslate2Shell
  logLevel: CTranslate2LogLevel
}

export interface CTranslate2ServerSettingsDraft {
  modelDirectory: string
  device: CTranslate2Device
  computeType: CTranslate2ComputeType
  host: CTranslate2Host
  port: string
  shell: CTranslate2Shell
  logLevel: CTranslate2LogLevel
}

export type ServerSettingsFieldError =
  | 'required'
  | 'unsafe'
  | 'invalid'
  | 'range'

export interface ServerSettingsValidation {
  valid: boolean
  settings: CTranslate2ServerSettings | null
  errors: Partial<
    Record<keyof CTranslate2ServerSettingsDraft, ServerSettingsFieldError>
  >
}

export const CTRANSLATE2_SERVER_STATIC_DEFAULTS = {
  // Empty means "auto-detect in the install models folder"; saved paths stay.
  modelDirectory: '',
  device: 'cpu' as CTranslate2Device,
  computeType: 'int8' as CTranslate2ComputeType,
  host: '127.0.0.1' as CTranslate2Host,
  port: 8000,
  logLevel: 'info' as CTranslate2LogLevel,
}

export function detectDefaultShell(
  platformText?: string,
): CTranslate2Shell {
  const text =
    platformText ??
    (typeof navigator !== 'undefined'
      ? `${navigator.platform || ''} ${navigator.userAgent || ''}`
      : '')
  return /win/i.test(text) ? 'powershell' : 'bash'
}

export function getDefaultCTranslate2ServerSettings(
  platformText?: string,
): CTranslate2ServerSettings {
  return {
    ...CTRANSLATE2_SERVER_STATIC_DEFAULTS,
    shell: detectDefaultShell(platformText),
  }
}

export function suggestedComputeType(
  device: CTranslate2Device,
): CTranslate2ComputeType {
  return device === 'cuda' ? 'int8_float16' : 'int8'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isDevice(value: unknown): value is CTranslate2Device {
  return CTRANSLATE2_DEVICES.includes(value as CTranslate2Device)
}

function isComputeType(value: unknown): value is CTranslate2ComputeType {
  return CTRANSLATE2_COMPUTE_TYPES.includes(value as CTranslate2ComputeType)
}

function isHost(value: unknown): value is CTranslate2Host {
  return CTRANSLATE2_HOSTS.includes(value as CTranslate2Host)
}

function isShell(value: unknown): value is CTranslate2Shell {
  return CTRANSLATE2_SHELLS.includes(value as CTranslate2Shell)
}

function isLogLevel(value: unknown): value is CTranslate2LogLevel {
  return CTRANSLATE2_LOG_LEVELS.includes(value as CTranslate2LogLevel)
}

export function isShellSafeArgument(value: string): boolean {
  return (
    typeof value === 'string' &&
    !/[\0\r\n]/.test(value) &&
    !value.startsWith('-')
  )
}

function isShellQuotable(value: string): boolean {
  return typeof value === 'string' && !/[\0\r\n]/.test(value)
}

function normalizePort(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 1 && value <= 65535
      ? value
      : null
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const port = Number(trimmed)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
}

function normalizeModelDirectory(
  value: unknown,
  fallback: string,
): string {
  if (typeof value !== 'string') return fallback
  if (value.trim() === '') return ''
  return isShellSafeArgument(value) ? value : fallback
}

export function normalizeCTranslate2ServerSettings(
  raw: unknown,
  fallback: CTranslate2ServerSettings = getDefaultCTranslate2ServerSettings(),
): CTranslate2ServerSettings {
  if (!isRecord(raw)) return { ...fallback }
  return {
    modelDirectory: normalizeModelDirectory(
      raw.modelDirectory,
      fallback.modelDirectory,
    ),
    device: isDevice(raw.device) ? raw.device : fallback.device,
    computeType: isComputeType(raw.computeType)
      ? raw.computeType
      : fallback.computeType,
    host: isHost(raw.host) ? raw.host : fallback.host,
    port: normalizePort(raw.port) ?? fallback.port,
    shell: isShell(raw.shell) ? raw.shell : fallback.shell,
    logLevel: isLogLevel(raw.logLevel)
      ? raw.logLevel
      : fallback.logLevel,
  }
}

export function deriveHostPortFromBaseURL(
  baseURL: string,
): { host: CTranslate2Host; port: number } | null {
  try {
    const url = new URL(baseURL)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const host = url.hostname.toLowerCase()
    if (host !== '127.0.0.1' && host !== 'localhost') return null
    if (!url.port) return { host, port: 8000 }
    const port = normalizePort(url.port)
    return port ? { host, port } : null
  } catch {
    return null
  }
}

export function resolveInitialCTranslate2ServerSettings(
  raw: unknown,
  activeBaseURL: string,
  platformText?: string,
): CTranslate2ServerSettings {
  const defaults = getDefaultCTranslate2ServerSettings(platformText)
  if (isRecord(raw)) {
    return normalizeCTranslate2ServerSettings(raw, defaults)
  }
  const derived = deriveHostPortFromBaseURL(activeBaseURL)
  return derived ? { ...defaults, ...derived } : defaults
}

export function draftFromServerSettings(
  settings: CTranslate2ServerSettings,
): CTranslate2ServerSettingsDraft {
  return { ...settings, port: String(settings.port) }
}

export function applyDeviceToDraft(
  draft: CTranslate2ServerSettingsDraft,
  device: CTranslate2Device,
): CTranslate2ServerSettingsDraft {
  return {
    ...draft,
    device,
    computeType: suggestedComputeType(device),
  }
}

export function validateCTranslate2ServerSettingsDraft(
  draft: CTranslate2ServerSettingsDraft,
): ServerSettingsValidation {
  const errors: ServerSettingsValidation['errors'] = {}
  // Empty means auto-detect on the native host side.
  if (
    draft.modelDirectory.trim() !== '' &&
    !isShellSafeArgument(draft.modelDirectory)
  ) {
    errors.modelDirectory = 'unsafe'
  }
  if (!isDevice(draft.device)) errors.device = 'invalid'
  if (!isComputeType(draft.computeType)) errors.computeType = 'invalid'
  if (!isHost(draft.host)) errors.host = 'invalid'
  if (!isShell(draft.shell)) errors.shell = 'invalid'
  if (!isLogLevel(draft.logLevel)) errors.logLevel = 'invalid'

  const port = normalizePort(draft.port)
  if (/^[+-]?\d+$/.test(draft.port.trim()) && port === null) {
    errors.port = 'range'
  } else if (port === null) {
    errors.port = 'invalid'
  }

  if (Object.keys(errors).length > 0 || port === null) {
    return { valid: false, settings: null, errors }
  }

  return {
    valid: true,
    errors,
    settings: {
      modelDirectory: draft.modelDirectory,
      device: draft.device,
      computeType: draft.computeType,
      host: draft.host,
      port,
      shell: draft.shell,
      logLevel: draft.logLevel,
    },
  }
}

export function isValidPrepareModelName(modelName: string): boolean {
  return modelName.trim() !== '' && isShellSafeArgument(modelName)
}

export function buildCTranslate2TranslationBaseURL(
  settings: Pick<CTranslate2ServerSettings, 'host' | 'port'>,
): string {
  return `http://${settings.host}:${settings.port}`
}

function quotePowerShellArgument(value: string): string {
  if (!isShellQuotable(value)) {
    throw new Error('Shell arguments cannot contain NUL or newlines.')
  }
  return `'${value.replace(/['\u2018\u2019\u201A\u201B]/g, (quote) => quote + quote)}'`
}

function quoteBashArgument(value: string): string {
  if (!isShellQuotable(value)) {
    throw new Error('Shell arguments cannot contain NUL or newlines.')
  }
  return `'${value.replace(/'/g, "'\\''")}'`
}

export function quoteShellArgument(
  value: string,
  shell: CTranslate2Shell,
): string {
  return shell === 'powershell'
    ? quotePowerShellArgument(value)
    : quoteBashArgument(value)
}

function buildCommandLine(
  executable: string,
  args: string[],
  shell: CTranslate2Shell,
): string {
  return [executable, ...args.map((arg) => quoteShellArgument(arg, shell))].join(
    ' ',
  )
}

export function buildPrepareModelCommand(
  settings: Pick<CTranslate2ServerSettings, 'modelDirectory'>,
  modelName: string,
  shell: CTranslate2Shell,
): string {
  if (
    !settings.modelDirectory.trim() ||
    !isShellSafeArgument(settings.modelDirectory)
  ) {
    throw new Error('A non-empty, single-line model directory is required.')
  }
  if (!isValidPrepareModelName(modelName)) {
    throw new Error('A non-empty, single-line model name is required.')
  }
  return buildCommandLine(
    'ct2-nllb-server',
    [
      'prepare-model',
      '--model',
      modelName,
      '--family',
      'auto',
      '--output',
      settings.modelDirectory,
    ],
    shell,
  )
}

export function buildServeCommand(
  settings: CTranslate2ServerSettings,
  shell: CTranslate2Shell,
): string {
  const validation = validateCTranslate2ServerSettingsDraft(
    draftFromServerSettings(settings),
  )
  if (!validation.valid) {
    throw new Error('CTranslate2 server settings are invalid.')
  }
  if (!settings.modelDirectory.trim()) {
    throw new Error('Select a prepared model directory first.')
  }
  return buildCommandLine(
    'ct2-nllb-server',
    [
      'serve',
      '--model-dir',
      settings.modelDirectory,
      '--host',
      settings.host,
      '--port',
      String(settings.port),
      '--device',
      settings.device,
      '--compute-type',
      settings.computeType,
      '--log-level',
      settings.logLevel,
    ],
    shell,
  )
}

export function buildInstallCommands(shell: CTranslate2Shell): string[] {
  return shell === 'powershell'
    ? [
        'py -3.11 -m venv .venv',
        '.\\.venv\\Scripts\\Activate.ps1',
        'python -m pip install -e ".\\server[convert]"',
      ]
    : [
        'python3.11 -m venv .venv',
        '. .venv/bin/activate',
        'python -m pip install -e "./server[convert]"',
      ]
}

function currentExtensionVersion(): string {
  try {
    const manifest = chrome.runtime?.getManifest?.()
    if (manifest?.version) return manifest.version
  } catch {
    // Tests and non-extension contexts fall back to the release version.
  }
  return '3.6.0'
}

export function buildOneClickInstallScriptUrl(
  version: string = currentExtensionVersion(),
): string {
  return (
    'https://raw.githubusercontent.com/realyasster/translator/' +
    `v${version}/scripts/install-ct2-server.ps1`
  )
}

export function buildOneClickInstallCommand(
  shell: CTranslate2Shell,
  model?: string,
  version: string = currentExtensionVersion(),
): string {
  if (model !== undefined && !isValidPrepareModelName(model)) {
    throw new Error('A non-empty, single-line model name is required.')
  }
  if (shell !== 'powershell') {
    const script = './scripts/install-ct2-server.sh'
    if (!model) return script
    return `${script} --model ${quoteShellArgument(model, shell)}`
  }
  const url = buildOneClickInstallScriptUrl(version)
  if (!model) return `irm ${url} | iex`
  return (
    `& ([scriptblock]::Create((irm ${url}))) -Model ` +
    quoteShellArgument(model, shell)
  )
}

export function buildNativeHostInstallCommand(
  shell: CTranslate2Shell,
  extensionId?: string,
  browser: 'chrome' | 'edge' = 'chrome',
): string {
  const installExtra =
    shell === 'powershell'
      ? 'python -m pip install -e ".\\server[native]"'
      : 'python -m pip install -e "./server[native]"'
  const browserFlag = browser === 'edge' ? ' --browser edge' : ''
  const idFlag =
    extensionId && extensionId !== CT2_EXTENSION_ID
      ? ` --extension-id ${extensionId}`
      : ''
  return [
    installExtra,
    `ct2-nllb-server install-native-host${idFlag}${browserFlag}`,
  ].join('\n')
}

export function requestedServerDiffersFromHealth(
  settings: CTranslate2ServerSettings,
  health: { device: string; compute_type: string },
): { device: boolean; computeType: boolean } {
  return {
    device: settings.device.toLowerCase() !== health.device.toLowerCase(),
    computeType:
      settings.computeType.toLowerCase() !==
      health.compute_type.toLowerCase(),
  }
}
