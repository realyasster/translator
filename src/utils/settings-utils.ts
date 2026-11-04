import {
  getDeepLApiKey,
  normalizeDeepLConfig,
} from './deepl'
import type { DeepLPlan } from './deepl'

export type ProviderType =
  | 'openai-compatible'
  | 'ollama'
  | 'google-translate'
  | 'ctranslate2'
  | 'deepl'

export interface ModelConfig {
  apiKey: string
  baseURL: string
  modelName: string
  sourceLanguage?: string
  targetLanguage?: string
  /** DeepL only: selected plan and one key per plan. */
  deeplPlan?: DeepLPlan
  deeplFreeKey?: string
  deeplProKey?: string
}

export interface ProviderDefaults {
  baseURL: string
  defaultModel: string
  sourceLanguage?: string
  deeplPlan?: DeepLPlan
}

export type ProviderConfigCache = Partial<Record<ProviderType, ModelConfig>>

export interface ProviderSwitchResult {
  configs: ProviderConfigCache
  nextConfig: ModelConfig
}

export const DEFAULT_TARGET_LANGUAGE = 'English'
export const DEFAULT_SOURCE_LANGUAGE = 'English'
export const DEFAULT_CTRANSLATE2_BASE_URL = 'http://127.0.0.1:8000'
export const DEFAULT_CTRANSLATE2_MODEL =
  'facebook/nllb-200-distilled-600M'
export const DEFAULT_PROMPT =
  'Translate the following English text into Chinese and separate the translations with @@@'

export const TARGET_LANGUAGES: Array<{ value: string; label: string }> = [
  { value: 'English', label: 'English (en)' },
  { value: 'Turkish', label: 'Türkçe (tr)' },
  { value: 'Chinese', label: '中文 (zh-CN)' },
  { value: 'Spanish', label: 'Español (es)' },
  { value: 'French', label: 'Français (fr)' },
  { value: 'German', label: 'Deutsch (de)' },
  { value: 'Portuguese', label: 'Português (pt)' },
  { value: 'Italian', label: 'Italiano (it)' },
  { value: 'Russian', label: 'Русский (ru)' },
  { value: 'Japanese', label: '日本語 (ja)' },
  { value: 'Korean', label: '한국어 (ko)' },
  { value: 'Arabic', label: 'العربية (ar)' },
  { value: 'Dutch', label: 'Nederlands (nl)' },
  { value: 'Polish', label: 'Polski (pl)' },
]


export interface OpenAICompatiblePreset {
  id: 'openai' | 'deepseek' | 'glm' | 'custom'
  labelKey: string
  baseURL?: string
  modelName?: string
}

/**
 * Presets replace the previous promotional example cards. The URLs and model
 * names are the same endpoints the old cards wrote into providerConfig.
 */
export const OPENAI_COMPATIBLE_PRESETS: OpenAICompatiblePreset[] = [
  {
    id: 'openai',
    labelKey: 'options.provider.preset.openai',
    baseURL: 'https://api.openai.com/v1',
    modelName: 'gpt-4o',
  },
  {
    id: 'deepseek',
    labelKey: 'options.provider.preset.deepseek',
    baseURL: 'https://api.deepseek.com/v1',
    modelName: 'deepseek-chat',
  },
  {
    id: 'glm',
    labelKey: 'options.provider.preset.glm',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    modelName: 'glm-4-flash',
  },
  { id: 'custom', labelKey: 'options.provider.preset.custom' },
]

export function normalizeProvider(raw: unknown): ProviderType | null {
  if (
    raw === 'openai-compatible' ||
    raw === 'ollama' ||
    raw === 'google-translate' ||
    raw === 'ctranslate2' ||
    raw === 'deepl'
  ) {
    return raw
  }
  // Legacy provider ids used by older versions.
  if (raw === 'openai' || raw === 'zhipu') return 'openai-compatible'
  return null
}

/**
 * The options page and popup must agree on which provider is active. Prefer
 * the current provider id, then the legacy selectedModel value.
 */
export function resolveProviderSelection(
  selectedProvider: unknown,
  selectedModel: unknown,
): ProviderType {
  return (
    normalizeProvider(selectedProvider) ||
    normalizeProvider(selectedModel) ||
    'openai-compatible'
  )
}

export function buildPromptTemplate(source: string, target: string): string {
  return `Translate the following <${source}> text into <${target}> and separate the translations with @@@`
}

export function mergeModelConfig(
  stored: Partial<ModelConfig> | null | undefined,
  preset: ProviderDefaults,
  fallback: Partial<ModelConfig> = {},
): ModelConfig {
  const source = stored || {}
  const asString = (key: keyof ModelConfig): string | undefined =>
    typeof source[key] === 'string' ? (source[key] as string) : undefined

  const config: ModelConfig = {
    apiKey: asString('apiKey') ?? fallback.apiKey ?? '',
    baseURL: asString('baseURL') ?? preset.baseURL,
    modelName: asString('modelName') ?? preset.defaultModel,
    targetLanguage:
      asString('targetLanguage') ||
      fallback.targetLanguage ||
      DEFAULT_TARGET_LANGUAGE,
  }
  const sourceLanguage =
    asString('sourceLanguage') ??
    fallback.sourceLanguage ??
    preset.sourceLanguage
  if (sourceLanguage !== undefined) {
    config.sourceLanguage = sourceLanguage
  }

  const deeplPlan =
    normalizePlan(source.deeplPlan) ?? normalizePlan(fallback.deeplPlan)
  if (deeplPlan) config.deeplPlan = deeplPlan
  const freeKey = asString('deeplFreeKey') ?? fallback.deeplFreeKey
  if (typeof freeKey === 'string') config.deeplFreeKey = freeKey
  const proKey = asString('deeplProKey') ?? fallback.deeplProKey
  if (typeof proKey === 'string') config.deeplProKey = proKey

  const isDeepLConfig =
    preset.deeplPlan !== undefined ||
    deeplPlan !== null ||
    typeof config.deeplFreeKey === 'string' ||
    typeof config.deeplProKey === 'string'
  if (isDeepLConfig) {
    return normalizeDeepLConfig(config, preset.deeplPlan ?? 'free')
  }
  return config
}

function normalizePlan(value: unknown): DeepLPlan | null {
  return value === 'free' || value === 'pro' ? value : null
}

export type ProviderConfigStorageKey =
  | 'openaiConfig'
  | 'ollamaConfig'
  | 'ctranslate2Config'
  | 'deeplConfig'

export function providerConfigStorageKey(
  provider: ProviderType,
): ProviderConfigStorageKey | null {
  if (provider === 'openai-compatible') return 'openaiConfig'
  if (provider === 'ollama') return 'ollamaConfig'
  if (provider === 'ctranslate2') return 'ctranslate2Config'
  if (provider === 'deepl') return 'deeplConfig'
  return null
}

export interface StoredProviderData {
  selectedProvider?: unknown
  selectedModel?: unknown
  providerConfig?: unknown
  openaiConfig?: unknown
  ollamaConfig?: unknown
  ctranslate2Config?: unknown
  deeplConfig?: unknown
}

export interface ResolvedProviderConfig {
  provider: ProviderType
  config: ModelConfig
}

/**
 * The active `providerConfig` is only valid when `selectedProvider` is a known
 * provider. Older installs did not write `selectedProvider`, so in that case
 * read the legacy `selectedModel` key instead of accidentally using another
 * provider's active config.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * `providerConfig` is the active draft, but an earlier write or a failed
 * migration can leave it with an empty credential while the provider-specific
 * record still holds the filled value. Fill only empty identity fields so the
 * active draft always wins.
 */
function mergeProviderConfigFallback(
  primary: unknown,
  fallback: unknown,
): ModelConfig {
  // Stored configs are partial by design; consumers validate the fields they
  // use, so the legacy return shape is kept here.
  if (!isRecord(primary)) {
    return (isRecord(fallback) ? fallback : {}) as unknown as ModelConfig
  }
  const specific = isRecord(fallback) ? fallback : null
  if (!specific) return primary as unknown as ModelConfig

  let merged: Record<string, unknown> | null = null
  for (const field of ['apiKey', 'baseURL', 'modelName'] as const) {
    const value = primary[field]
    if (typeof value === 'string' && value.trim() !== '') continue
    const specificValue = specific[field]
    if (
      typeof specificValue !== 'string' ||
      specificValue.trim() === ''
    ) {
      continue
    }
    if (!merged) merged = { ...specific, ...primary }
    merged[field] = specificValue
  }
  return (merged ?? primary) as unknown as ModelConfig
}

export function resolveProviderAndConfig(
  storage: StoredProviderData | null | undefined,
): ResolvedProviderConfig | null {
  if (!storage) return null

  const selectedProvider = normalizeProvider(storage.selectedProvider)
  if (selectedProvider) {
    const storageKey = providerConfigStorageKey(selectedProvider)
    const specific = storageKey ? storage[storageKey] : undefined
    let candidate: unknown = storage.providerConfig
    if (!candidate || typeof candidate !== 'object') {
      candidate = specific
    }
    if (!candidate || typeof candidate !== 'object') return null
    const merged = mergeProviderConfigFallback(candidate, specific)
    return {
      provider: selectedProvider,
      config:
        selectedProvider === 'deepl'
          ? normalizeDeepLConfig(merged)
          : merged,
    }
  }

  const legacyProvider =
    normalizeProvider(storage.selectedModel) || 'openai-compatible'
  const legacyKey = providerConfigStorageKey(legacyProvider)
  const legacyCandidate = legacyKey ? storage[legacyKey] : undefined
  if (!legacyCandidate || typeof legacyCandidate !== 'object') return null
  const legacyConfig = legacyCandidate as ModelConfig
  return {
    provider: legacyProvider,
    config:
      legacyProvider === 'deepl'
        ? normalizeDeepLConfig(legacyConfig)
        : legacyConfig,
  }
}

export function isModelConfigComplete(
  provider: ProviderType,
  config: Partial<ModelConfig> | null | undefined,
): boolean {
  if (!config) return false
  const baseURL = typeof config.baseURL === 'string' ? config.baseURL.trim() : ''
  const modelName =
    typeof config.modelName === 'string' ? config.modelName.trim() : ''
  if (provider === 'google-translate') return baseURL !== ''
  if (provider === 'deepl') {
    return getDeepLApiKey(config) !== ''
  }
  if (provider === 'ollama' || provider === 'ctranslate2') {
    return baseURL !== '' && modelName !== ''
  }
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : ''
  return baseURL !== '' && modelName !== '' && apiKey !== ''
}

/**
 * Switching providers caches the current config and restores the target
 * provider's previous config. Only the target language is shared; credentials
 * and custom endpoints stay with their provider.
 */
export function switchProviderConfigs(
  currentProvider: ProviderType,
  currentConfig: ModelConfig,
  nextProvider: ProviderType,
  cachedConfigs: ProviderConfigCache,
  nextPreset: ProviderDefaults,
): ProviderSwitchResult {
  const targetLanguage =
    currentConfig.targetLanguage || DEFAULT_TARGET_LANGUAGE
  const configs: ProviderConfigCache = {
    ...cachedConfigs,
    [currentProvider]: { ...currentConfig, targetLanguage },
  }
  const nextConfig: ModelConfig = {
    ...mergeModelConfig(configs[nextProvider], nextPreset),
    targetLanguage,
  }
  return {
    configs: { ...configs, [nextProvider]: nextConfig },
    nextConfig,
  }
}

export function withTargetLanguage(
  config: ModelConfig,
  targetLanguage: string,
): ModelConfig {
  return {
    ...config,
    targetLanguage: targetLanguage || DEFAULT_TARGET_LANGUAGE,
  }
}

export function resolveOpenAICompatiblePresetId(
  config: Pick<ModelConfig, 'baseURL' | 'modelName'>,
): OpenAICompatiblePreset['id'] {
  const match = OPENAI_COMPATIBLE_PRESETS.find(
    (preset) =>
      preset.baseURL &&
      preset.modelName &&
      preset.baseURL === config.baseURL &&
      preset.modelName === config.modelName,
  )
  return match ? match.id : 'custom'
}

export interface AppearanceValues {
  showOriginalSubtitle: boolean
  backgroundColor: string
  backgroundOpacity: number
  originFontSize: number
  originFontColor: string
  originFontWeight: number
  translatedFontSize: number
  translatedFontColor: string
  translatedFontWeight: number
}

export const APPEARANCE_KEYS = [
  'showOriginalSubtitle',
  'backgroundColor',
  'backgroundOpacity',
  'originFontSize',
  'originFontColor',
  'originFontWeight',
  'translatedFontSize',
  'translatedFontColor',
  'translatedFontWeight',
] as const

export type AppearanceKey = (typeof APPEARANCE_KEYS)[number]

/**
 * These mirror the installation defaults used by the background script and the
 * content script rather than the popup's old hard-coded values. Nothing writes
 * these values on load; they are only used for display fallbacks and an
 * explicit appearance reset.
 */
export const APPEARANCE_DEFAULTS: AppearanceValues = {
  showOriginalSubtitle: true,
  backgroundColor: 'rgba(0, 0, 0, 0.75)',
  backgroundOpacity: 0.8,
  originFontSize: 16,
  originFontColor: '#ffffff',
  originFontWeight: 400,
  translatedFontSize: 16,
  translatedFontColor: '#ffff00',
  translatedFontWeight: 400,
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === null || value === undefined || value === '') return fallback
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, numeric))
}

function normalizeWeight(value: unknown): number {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'normal') return 400
    if (normalized === 'bold' || normalized === 'bolder') return 700
    if (normalized === 'lighter') return 300
  }
  const numeric = clampNumber(value, 100, 900, 400)
  return Math.round(numeric / 100) * 100
}

function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback
}

export function normalizeAppearance(
  raw: Record<string, unknown> | null | undefined,
): AppearanceValues {
  const source = raw || {}
  return {
    showOriginalSubtitle: source.showOriginalSubtitle !== false,
    backgroundColor: normalizeColor(
      source.backgroundColor,
      APPEARANCE_DEFAULTS.backgroundColor,
    ),
    backgroundOpacity: clampNumber(
      source.backgroundOpacity,
      0,
      1,
      APPEARANCE_DEFAULTS.backgroundOpacity,
    ),
    originFontSize: clampNumber(
      source.originFontSize,
      12,
      72,
      APPEARANCE_DEFAULTS.originFontSize,
    ),
    originFontColor: normalizeColor(
      source.originFontColor,
      APPEARANCE_DEFAULTS.originFontColor,
    ),
    originFontWeight: normalizeWeight(source.originFontWeight),
    translatedFontSize: clampNumber(
      source.translatedFontSize,
      12,
      72,
      APPEARANCE_DEFAULTS.translatedFontSize,
    ),
    translatedFontColor: normalizeColor(
      source.translatedFontColor,
      APPEARANCE_DEFAULTS.translatedFontColor,
    ),
    translatedFontWeight: normalizeWeight(source.translatedFontWeight),
  }
}

/**
 * The reset is deliberately appearance-only: it must never include `status`.
 */
export function appearanceResetPayload(): AppearanceValues {
  return { ...APPEARANCE_DEFAULTS }
}

const NAMED_COLORS: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  yellow: '#ffff00',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
}

export function toHexColor(value: string, fallback = '#000000'): string {
  const input = (value || '').trim()
  if (/^#[0-9a-f]{6}$/i.test(input)) return input.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(input)) {
    return (
      '#' +
      input
        .slice(1)
        .split('')
        .map((part) => part + part)
        .join('')
    ).toLowerCase()
  }
  const named = NAMED_COLORS[input.toLowerCase()]
  if (named) return named
  const rgb = input.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i,
  )
  if (rgb) {
    return (
      '#' +
      rgb
        .slice(1, 4)
        .map((part) =>
          Math.max(0, Math.min(255, Number(part)))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    ).toLowerCase()
  }
  return fallback
}
