import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './index.scss'
import {
  Alert,
  Button,
  Collapse,
  Input,
  Popconfirm,
  Select,
  Switch,
  message,
} from 'antd'
import { GithubFilled, RightOutlined } from '@ant-design/icons'
import { useTranslation } from '../../hooks/useTranslation'
import { SUPPORTED_LANGS, Lang, ProviderPreset } from '../../utils/i18n'
import {
  detectOllama,
  pullOllamaModel,
  OllamaDetectResult,
  OllamaModel,
} from '../../utils/ollama'
import { CTranslate2SetupCard } from './CTranslate2SetupCard'
import {
  deepLPlanWarning,
  deeplEndpoint,
  getDeepLApiKey,
  normalizeDeepLConfig,
  normalizeDeepLPlan,
  resolveDeepLPlan,
} from '../../utils/deepl'
import {
  runDiagnostic,
  DiagnosticResult,
  DiagnosticStatus,
} from '../../utils/diagnostics'
import { DetectionStatusResponse, SourceKind } from '../../types/detection'
import { getStoredValues, setStoredValues } from '../../utils/storage'
import {
  DEFAULT_CTRANSLATE2_BASE_URL,
  DEFAULT_CTRANSLATE2_MODEL,
  DEFAULT_PROMPT,
  DEFAULT_SOURCE_LANGUAGE,
  DEFAULT_TARGET_LANGUAGE,
  ModelConfig,
  OPENAI_COMPATIBLE_PRESETS,
  ProviderConfigCache,
  ProviderType,
  TARGET_LANGUAGES,
  buildPromptTemplate,
  mergeModelConfig,
  normalizeProvider,
  providerConfigStorageKey,
  resolveOpenAICompatiblePresetId,
  resolveProviderAndConfig,
  resolveProviderSelection,
  switchProviderConfigs,
  withTargetLanguage,
} from '../../utils/settings-utils'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface SaveState {
  status: SaveStatus
  message?: string
}

type SaveScope = 'translation'

type TFunction = (key: string, vars?: Record<string, string>) => string

const PROVIDER_PRESETS: Record<ProviderType, ProviderPreset> = {
  'openai-compatible': {
    name: 'OpenAI-Compatible API',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    requiresApiKey: true,
    descriptionKey: 'options.providerDesc.openaiCompatible',
  },
  ollama: {
    name: 'Ollama (Local)',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'qwen2:0.5b',
    requiresApiKey: false,
    descriptionKey: 'options.providerDesc.ollama',
  },
  'google-translate': {
    name: 'Google Translate (Free)',
    baseURL: 'https://translate.googleapis.com/translate_a',
    defaultModel: 'google-free',
    requiresApiKey: false,
    descriptionKey: 'options.providerDesc.googleTranslate',
  },
  ctranslate2: {
    name: 'CTranslate2 (Local)',
    baseURL: DEFAULT_CTRANSLATE2_BASE_URL,
    defaultModel: DEFAULT_CTRANSLATE2_MODEL,
    sourceLanguage: DEFAULT_SOURCE_LANGUAGE,
    requiresApiKey: false,
    descriptionKey: 'options.providerDesc.ctranslate2',
  },
  deepl: {
    name: 'DeepL',
    baseURL: 'https://api.deepl.com/v2',
    defaultModel: '',
    sourceLanguage: 'auto',
    deeplPlan: 'free',
    requiresApiKey: true,
    descriptionKey: 'options.providerDesc.deepl',
  },
}

const DIAGNOSTIC_STATUSES: DiagnosticStatus[] = [
  'connected',
  'loading',
  'cors_blocked',
  'unreachable',
  'auth_error',
  'not_found',
  'model_mismatch',
  'timeout',
  'unknown',
]

const RECOMMENDED_OLLAMA_MODELS = [
  'qwen2.5:3b',
  'qwen2:0.5b',
  'llama3.2:3b',
  'llama3.2:1b',
  'llama3.1:8b',
  'gemma2:2b',
  'gemma3:4b',
  'mistral:7b',
  'mistral-nemo:12b',
  'phi3:mini',
  'qwen2.5:7b',
  'qwen2.5:14b',
]

message.config({
  top: 50,
  duration: 2,
  maxCount: 1,
})

function isDiagnosticResult(value: unknown): value is DiagnosticResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<DiagnosticResult>
  return (
    typeof candidate.status === 'string' &&
    DIAGNOSTIC_STATUSES.includes(candidate.status as DiagnosticStatus) &&
    typeof candidate.checkedAt === 'number' &&
    typeof candidate.message === 'string'
  )
}

function getExtensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version
  } catch {
    return ''
  }
}

function remedyKeyForStatus(status: DiagnosticStatus | null | undefined): string | null {
  if (!status || status === 'connected') return null
  if (status === 'cors_blocked' || status === 'auth_error') return 'cors'
  if (status === 'unreachable' || status === 'timeout') return 'start'
  return null
}

const SaveIndicator: React.FC<{ state?: SaveState; t: TFunction }> = ({
  state,
  t,
}) => {
  if (!state || state.status === 'idle') return null
  if (state.status === 'saving') {
    return (
      <span className="save-status" role="status">
        {t('options.autosave.saving')}
      </span>
    )
  }
  if (state.status === 'saved') {
    return (
      <span className="save-status save-status--ok" role="status">
        {t('options.autosave.saved')}
      </span>
    )
  }
  return (
    <span className="save-status save-status--error" role="alert">
      {t('options.autosave.error', { message: state.message || '' })}
    </span>
  )
}

interface SettingsSectionProps {
  id: string
  title: string
  description?: string
  status?: React.ReactNode
  children: React.ReactNode
}

const SettingsSection: React.FC<SettingsSectionProps> = ({
  id,
  title,
  description,
  status,
  children,
}) => (
  <section
    id={id}
    className="settings-section"
    aria-labelledby={`${id}-heading`}
  >
    <div className="settings-section__header">
      <div className="settings-section__heading">
        <h2 id={`${id}-heading`} tabIndex={-1}>
          {title}
        </h2>
        {description && (
          <p className="settings-section__description">{description}</p>
        )}
      </div>
      {status && <div className="settings-section__status">{status}</div>}
    </div>
    <div className="settings-section__body">{children}</div>
  </section>
)

interface FieldProps {
  id?: string
  label: string
  hint?: React.ReactNode
  children: React.ReactNode
  className?: string
}

const Field: React.FC<FieldProps> = ({
  id,
  label,
  hint,
  children,
  className,
}) => (
  <div className={className ? `field ${className}` : 'field'}>
    <label className="field__label" htmlFor={id}>
      {label}
    </label>
    {children}
    {hint && <p className="field__hint">{hint}</p>}
  </div>
)

const collapseExpandIcon = ({ isActive }: { isActive?: boolean }) => (
  <RightOutlined rotate={isActive ? 90 : 0} aria-hidden="true" />
)

const Options: React.FC = () => {
  const { lang, setLang, t } = useTranslation()
  const [ready, setReady] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)

  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [promptDraft, setPromptDraft] = useState(DEFAULT_PROMPT)
  const [promptSaveState, setPromptSaveState] = useState<SaveState>({
    status: 'idle',
  })
  const [templateSource, setTemplateSource] = useState('English')
  const [templateTarget, setTemplateTarget] = useState('Chinese')

  const [selectedProvider, setSelectedProvider] =
    useState<ProviderType>('openai-compatible')
  const [providerConfig, setProviderConfig] = useState<ModelConfig>({
    apiKey: '',
    baseURL: PROVIDER_PRESETS['openai-compatible'].baseURL,
    modelName: PROVIDER_PRESETS['openai-compatible'].defaultModel,
    targetLanguage: DEFAULT_TARGET_LANGUAGE,
  })
  const providerConfigRef = useRef<ModelConfig>(providerConfig)
  const selectedProviderRef = useRef<ProviderType>(selectedProvider)
  const providerConfigsRef = useRef<ProviderConfigCache>({})
  const [enableStreaming, setEnableStreamingState] = useState(true)
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({})
  const saveSequenceRef = useRef<Record<string, number>>({})
  const saveTimersRef = useRef<Partial<Record<SaveScope, number>>>({})

  const [diagResult, setDiagResult] = useState<DiagnosticResult | null>(null)
  const [diagHistory, setDiagHistory] = useState<DiagnosticResult[]>([])
  const [diagTesting, setDiagTesting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [ollamaRemedyRequest, setOllamaRemedyRequest] = useState(0)

  useEffect(() => {
    let mounted = true

    const init = async () => {
      try {
        const stored = await getStoredValues<Record<string, any>>([
          'prompt',
          'selectedProvider',
          'providerConfig',
          'selectedModel',
          'openaiConfig',
          'ollamaConfig',
          'ctranslate2Config',
          'deeplConfig',
          'enableStreaming',
          'lastDiagnostic',
          'diagnosticHistory',
        ])
        if (!mounted) return

        const provider = resolveProviderSelection(
          stored?.selectedProvider,
          stored?.selectedModel,
        )

        // Use the same merged view the background reads, so a stale
        // providerConfig cannot hide a filled provider-specific record.
        const resolvedStored = resolveProviderAndConfig(stored)
        let configSource: Partial<ModelConfig> | undefined
        if (resolvedStored && resolvedStored.provider === provider) {
          configSource = resolvedStored.config
        } else if (
          stored?.providerConfig &&
          typeof stored.providerConfig === 'object'
        ) {
          configSource = stored.providerConfig as Partial<ModelConfig>
        } else if (provider === 'ollama' && stored?.ollamaConfig) {
          configSource = stored.ollamaConfig as Partial<ModelConfig>
        } else if (
          provider === 'ctranslate2' &&
          stored?.ctranslate2Config
        ) {
          configSource = stored.ctranslate2Config as Partial<ModelConfig>
        } else if (provider === 'deepl' && stored?.deeplConfig) {
          configSource = stored.deeplConfig as Partial<ModelConfig>
        } else if (
          provider === 'openai-compatible' &&
          stored?.openaiConfig
        ) {
          configSource = stored.openaiConfig as Partial<ModelConfig>
        }

        const merged = mergeModelConfig(configSource, PROVIDER_PRESETS[provider])
        const savedPrompt =
          typeof stored?.prompt === 'string' && stored.prompt
            ? stored.prompt
            : DEFAULT_PROMPT

        setPrompt(savedPrompt)
        setPromptDraft(savedPrompt)
        setSelectedProvider(provider)
        selectedProviderRef.current = provider
        setProviderConfig(merged)
        providerConfigRef.current = merged

        const initialConfigs: ProviderConfigCache = {}
        if (stored?.openaiConfig && typeof stored.openaiConfig === 'object') {
          initialConfigs['openai-compatible'] = mergeModelConfig(
            stored.openaiConfig,
            PROVIDER_PRESETS['openai-compatible'],
          )
        }
        if (stored?.ollamaConfig && typeof stored.ollamaConfig === 'object') {
          initialConfigs.ollama = mergeModelConfig(
            stored.ollamaConfig,
            PROVIDER_PRESETS.ollama,
          )
        }
        if (
          stored?.ctranslate2Config &&
          typeof stored.ctranslate2Config === 'object'
        ) {
          initialConfigs.ctranslate2 = mergeModelConfig(
            stored.ctranslate2Config,
            PROVIDER_PRESETS.ctranslate2,
          )
        }
        if (stored?.deeplConfig && typeof stored.deeplConfig === 'object') {
          initialConfigs.deepl = mergeModelConfig(
            stored.deeplConfig,
            PROVIDER_PRESETS.deepl,
          )
        }
        initialConfigs[provider] = merged
        providerConfigsRef.current = initialConfigs

        setEnableStreamingState(stored?.enableStreaming !== false)

        if (isDiagnosticResult(stored?.lastDiagnostic)) {
          setDiagResult(stored.lastDiagnostic)
        }
        if (Array.isArray(stored?.diagnosticHistory)) {
          setDiagHistory(
            stored.diagnosticHistory
              .filter(isDiagnosticResult)
              .slice(0, 5),
          )
        }

        const migration: Record<string, unknown> = {}
        const hasKnownProvider =
          stored?.selectedProvider !== undefined ||
          stored?.selectedModel !== undefined ||
          stored?.providerConfig !== undefined
        if (hasKnownProvider && stored?.selectedProvider !== provider) {
          migration.selectedProvider = provider
        }
        if (!stored?.providerConfig && configSource) {
          migration.providerConfig = merged
        }
        if (
          provider === 'ctranslate2' &&
          !stored?.ctranslate2Config
        ) {
          migration.ctranslate2Config = merged
        }
        if (provider === 'deepl') {
          // Persist the migrated plan/keys in both records so older builds
          // and the background see the same values. Skip identical writes to
          // avoid resetting active translations on every Options load.
          const sameConfig = (left: unknown) => {
            const storedConfig =
              left && typeof left === 'object'
                ? (left as Record<string, unknown>)
                : {}
            const keys = Object.keys(storedConfig)
              .concat(Object.keys(merged))
              .filter((key, index, list) => list.indexOf(key) === index)
            for (const key of keys) {
              if (
                storedConfig[key] !==
                merged[key as keyof ModelConfig]
              ) {
                return false
              }
            }
            return true
          }
          if (
            !sameConfig(stored?.providerConfig) ||
            !sameConfig(stored?.deeplConfig)
          ) {
            migration.providerConfig = merged
            migration.deeplConfig = merged
          }
        }
        if (Object.keys(migration).length > 0) {
          try {
            await setStoredValues(migration)
          } catch {
            // Legacy migration is best-effort; the UI still uses merged values.
          }
        }
      } catch (error: any) {
        if (mounted) {
          setInitError(error?.message || String(error))
        }
      } finally {
        if (mounted) setReady(true)
      }
    }

    void init()
    return () => {
      mounted = false
    }
  }, [])

  const persist = useCallback(
    async (
      scope: string,
      values: Record<string, unknown>,
    ): Promise<string | null> => {
      const sequence = (saveSequenceRef.current[scope] || 0) + 1
      saveSequenceRef.current[scope] = sequence
      setSaveStates((previous) => ({
        ...previous,
        [scope]: { status: 'saving' },
      }))
      try {
        await setStoredValues(values)
        if (saveSequenceRef.current[scope] === sequence) {
          setSaveStates((previous) => ({
            ...previous,
            [scope]: { status: 'saved' },
          }))
        }
        return null
      } catch (error: any) {
        const errorMessage = error?.message || String(error)
        if (saveSequenceRef.current[scope] === sequence) {
          setSaveStates((previous) => ({
            ...previous,
            [scope]: { status: 'error', message: errorMessage },
          }))
        }
        return errorMessage
      }
    },
    [],
  )

  const clearSaveTimer = useCallback((scope: SaveScope) => {
    const timer = saveTimersRef.current[scope]
    if (timer !== undefined) {
      window.clearTimeout(timer)
      delete saveTimersRef.current[scope]
    }
  }, [])

  const buildTranslationPayload = useCallback((): Record<string, unknown> => {
    const provider = selectedProviderRef.current
    const config = providerConfigRef.current
    const legacyKey = providerConfigStorageKey(provider)
    return {
      selectedProvider: provider,
      providerConfig: config,
      ...(legacyKey ? { [legacyKey]: config } : {}),
    }
  }, [])

  const persistTranslationNow = useCallback(() => {
    clearSaveTimer('translation')
    return persist('translation', buildTranslationPayload())
  }, [buildTranslationPayload, clearSaveTimer, persist])

  const scheduleTranslationSave = useCallback(() => {
    saveSequenceRef.current.translation =
      (saveSequenceRef.current.translation || 0) + 1
    setSaveStates((previous) => ({
      ...previous,
      translation: { status: 'saving' },
    }))
    clearSaveTimer('translation')
    saveTimersRef.current.translation = window.setTimeout(() => {
      delete saveTimersRef.current.translation
      void persist('translation', buildTranslationPayload())
    }, 400)
  }, [buildTranslationPayload, clearSaveTimer, persist])

  const flushTranslationSave = useCallback(() => {
    if (saveTimersRef.current.translation === undefined) return
    clearSaveTimer('translation')
    void persist('translation', buildTranslationPayload())
  }, [buildTranslationPayload, clearSaveTimer, persist])

  const commitProviderConfig = useCallback(
    (next: ModelConfig, options: { debounce?: boolean } = {}) => {
      providerConfigRef.current = next
      setProviderConfig(next)
      providerConfigsRef.current = {
        ...providerConfigsRef.current,
        [selectedProviderRef.current]: next,
      }
      if (options.debounce) {
        scheduleTranslationSave()
        return Promise.resolve(null)
      }
      return persistTranslationNow()
    },
    [persistTranslationNow, scheduleTranslationSave],
  )

  const applyConfigDraft = useCallback((next: ModelConfig) => {
    providerConfigRef.current = next
    setProviderConfig(next)
    providerConfigsRef.current = {
      ...providerConfigsRef.current,
      [selectedProviderRef.current]: next,
    }
  }, [])

  const handleApiKeyDraftChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      applyConfigDraft({
        ...providerConfigRef.current,
        apiKey: event.target.value,
      })
    },
    [applyConfigDraft],
  )

  const handleApiKeyCommit = useCallback(() => {
    const current = providerConfigRef.current
    const trimmed = { ...current, apiKey: current.apiKey.trim() }
    if (trimmed.apiKey !== current.apiKey) {
      providerConfigRef.current = trimmed
      setProviderConfig(trimmed)
      providerConfigsRef.current = {
        ...providerConfigsRef.current,
        [selectedProviderRef.current]: trimmed,
      }
    }
    void persistTranslationNow()
  }, [persistTranslationNow])

  const handleDeepLKeyDraftChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const current = providerConfigRef.current
      const plan = resolveDeepLPlan(current)
      applyConfigDraft({
        ...current,
        [plan === 'free' ? 'deeplFreeKey' : 'deeplProKey']:
          event.target.value,
      })
    },
    [applyConfigDraft],
  )

  const handleDeepLKeyCommit = useCallback(() => {
    const current = providerConfigRef.current
    const plan = resolveDeepLPlan(current)
    const field = plan === 'free' ? 'deeplFreeKey' : 'deeplProKey'
    const value = (current[field] || '').trim()
    applyConfigDraft({ ...current, [field]: value, apiKey: value })
    void persistTranslationNow()
  }, [applyConfigDraft, persistTranslationNow])

  const handleDeepLPlanChange = useCallback(
    (value: string) => {
      const plan = normalizeDeepLPlan(value)
      if (!plan) return
      applyConfigDraft(
        normalizeDeepLConfig(
          { ...providerConfigRef.current, deeplPlan: plan },
          plan,
        ),
      )
      void persistTranslationNow()
    },
    [applyConfigDraft, persistTranslationNow],
  )

  const handleLanguageChange = useCallback(
    async (next: Lang) => {
      const sequence = (saveSequenceRef.current.general || 0) + 1
      saveSequenceRef.current.general = sequence
      setSaveStates((previous) => ({
        ...previous,
        general: { status: 'saving' },
      }))
      try {
        await setLang(next)
        if (saveSequenceRef.current.general === sequence) {
          setSaveStates((previous) => ({
            ...previous,
            general: { status: 'saved' },
          }))
        }
      } catch (error: any) {
        if (saveSequenceRef.current.general === sequence) {
          setSaveStates((previous) => ({
            ...previous,
            general: {
              status: 'error',
              message: error?.message || String(error),
            },
          }))
        }
      }
    },
    [setLang],
  )

  const promptDirty = promptDraft !== prompt
  const promptEmpty = promptDraft.trim() === ''

  const handlePromptDraftChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setPromptDraft(event.target.value)
      setPromptSaveState((previous) =>
        previous.status === 'saved' ? { status: 'idle' } : previous,
      )
    },
    [],
  )

  const handlePromptSave = useCallback(async () => {
    if (!promptDraft.trim()) return
    setPromptSaveState({ status: 'saving' })
    try {
      await setStoredValues({ prompt: promptDraft })
      setPrompt(promptDraft)
      setPromptSaveState({ status: 'saved' })
    } catch (error: any) {
      setPromptSaveState({
        status: 'error',
        message: error?.message || String(error),
      })
    }
  }, [promptDraft])

  const handlePromptReset = useCallback(() => {
    setPromptDraft(DEFAULT_PROMPT)
    setPromptSaveState({ status: 'idle' })
  }, [])

  const handleGenerateDraft = useCallback(() => {
    setPromptDraft(buildPromptTemplate(templateSource, templateTarget))
    setPromptSaveState((previous) =>
      previous.status === 'saved' ? { status: 'idle' } : previous,
    )
  }, [templateSource, templateTarget])

  const handleProviderChange = useCallback(
    (rawValue: string) => {
      const nextProvider = normalizeProvider(rawValue)
      const currentProvider = selectedProviderRef.current
      if (!nextProvider || nextProvider === currentProvider) return

      const currentConfig = providerConfigRef.current
      const { configs, nextConfig } = switchProviderConfigs(
        currentProvider,
        currentConfig,
        nextProvider,
        providerConfigsRef.current,
        PROVIDER_PRESETS[nextProvider],
      )

      providerConfigsRef.current = configs
      selectedProviderRef.current = nextProvider
      setSelectedProvider(nextProvider)
      providerConfigRef.current = nextConfig
      setProviderConfig(nextConfig)
      clearSaveTimer('translation')

      const updates: Record<string, unknown> = {
        selectedProvider: nextProvider,
        providerConfig: nextConfig,
      }
      const currentLegacyKey = providerConfigStorageKey(currentProvider)
      if (currentLegacyKey) {
        updates[currentLegacyKey] = configs[currentProvider] || currentConfig
      }
      const nextLegacyKey = providerConfigStorageKey(nextProvider)
      if (nextLegacyKey) {
        updates[nextLegacyKey] = nextConfig
      }
      void persist('translation', updates)
    },
    [clearSaveTimer, persist],
  )

  const handleProviderPresetChange = useCallback(
    (presetId: string) => {
      const preset = OPENAI_COMPATIBLE_PRESETS.find(
        (candidate) => candidate.id === presetId,
      )
      if (!preset?.baseURL || !preset.modelName) return
      void commitProviderConfig({
        ...providerConfigRef.current,
        baseURL: preset.baseURL,
        modelName: preset.modelName,
      })
    },
    [commitProviderConfig],
  )

  const handleConfigUpdate = useCallback(
    (field: keyof ModelConfig, value: string) => {
      void commitProviderConfig(
        {
          ...providerConfigRef.current,
          [field]: value,
        },
        { debounce: true },
      )
    },
    [commitProviderConfig],
  )

  const handleTargetLanguageChange = useCallback(
    (value: string) => {
      void commitProviderConfig(
        withTargetLanguage(providerConfigRef.current, value),
      )
    },
    [commitProviderConfig],
  )

  const handleSourceLanguageChange = useCallback(
    (value: string) => {
      const fallback =
        selectedProviderRef.current === 'deepl'
          ? 'auto'
          : DEFAULT_SOURCE_LANGUAGE
      void commitProviderConfig({
        ...providerConfigRef.current,
        sourceLanguage: value || fallback,
      })
    },
    [commitProviderConfig],
  )

  const handleStreamingChange = useCallback(
    (checked: boolean) => {
      setEnableStreamingState(checked)
      void persist('streaming', { enableStreaming: checked })
    },
    [persist],
  )

  const handleUseOllamaModel = useCallback(
    async (modelName: string) => {
      const error = await commitProviderConfig({
        ...providerConfigRef.current,
        modelName,
      })
      if (!error) {
        message.success(t('options.ollamaSetup.modelSet', { model: modelName }))
      }
    },
    [commitProviderConfig, t],
  )

  const invalidateCTranslate2Diagnostic = useCallback(() => {
    setDiagResult(null)
    void setStoredValues({ lastDiagnostic: null }).catch(() => {
      // The card still hides stale health even if storage cleanup fails.
    })
  }, [])

  const handleApplyCTranslate2BaseURL = useCallback(
    async (baseURL: string): Promise<string | null> => {
      const error = await commitProviderConfig({
        ...providerConfigRef.current,
        baseURL,
      })
      if (!error) invalidateCTranslate2Diagnostic()
      return error
    },
    [commitProviderConfig, invalidateCTranslate2Diagnostic],
  )

  const handleSelectCTranslate2Model = useCallback(
    async (modelId: string): Promise<string | null> => {
      const error = await commitProviderConfig({
        ...providerConfigRef.current,
        modelName: modelId,
      })
      if (!error) invalidateCTranslate2Diagnostic()
      return error
    },
    [commitProviderConfig, invalidateCTranslate2Diagnostic],
  )

  const runConnectionTest = useCallback(async () => {
    setDiagTesting(true)
    try {
      const result = await runDiagnostic(selectedProvider, {
        baseURL: providerConfigRef.current.baseURL,
        apiKey: providerConfigRef.current.apiKey,
        modelName: providerConfigRef.current.modelName,
        sourceLanguage: providerConfigRef.current.sourceLanguage,
        targetLanguage: providerConfigRef.current.targetLanguage,
      })
      setDiagResult(result)
      const nextHistory = [result, ...diagHistory].slice(0, 5)
      setDiagHistory(nextHistory)
      void setStoredValues({
        lastDiagnostic: result,
        diagnosticHistory: nextHistory,
      }).catch(() => {
        // The result is still shown in the UI if history persistence fails.
      })
      if (selectedProvider === 'ollama' && result.status !== 'connected') {
        setOllamaRemedyRequest((previous) => previous + 1)
      }
    } catch (error: any) {
      message.error(error?.message || String(error))
    } finally {
      setDiagTesting(false)
    }
  }, [diagHistory, selectedProvider])

  const handleResetConnection = useCallback(async () => {
    setResetError(null)
    clearSaveTimer('translation')
    const provider = selectedProviderRef.current
    const nextConfig = mergeModelConfig(
      undefined,
      PROVIDER_PRESETS[provider],
      { targetLanguage: providerConfigRef.current.targetLanguage },
    )
    providerConfigsRef.current = {
      ...providerConfigsRef.current,
      [provider]: nextConfig,
    }
    const legacyKey = providerConfigStorageKey(provider)
    const error = await persist('translation', {
      selectedProvider: provider,
      providerConfig: nextConfig,
      ...(legacyKey ? { [legacyKey]: nextConfig } : {}),
    })
    if (error) {
      setResetError(
        t('options.connection.resetFailed', { message: error }),
      )
      return
    }
    providerConfigRef.current = nextConfig
    setProviderConfig(nextConfig)
    message.success(t('options.connection.resetDone'))
  }, [clearSaveTimer, persist, t])

  const copyBaseUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        providerConfigRef.current.baseURL || '',
      )
      message.success(t('options.connection.copied'))
    } catch {
      message.error(t('options.connection.copyFailed'))
    }
  }, [t])

  const scrollToId = useCallback((id: string) => {
    const target = document.getElementById(id)
    if (!target) return
    target.scrollIntoView({ block: 'start' })
    const heading = target.querySelector<HTMLElement>('h2, h3')
    heading?.focus({ preventScroll: true })
  }, [])

  const handleShowOllamaRemedy = useCallback(() => {
    setOllamaRemedyRequest((previous) => previous + 1)
    scrollToId('ollama-setup')
  }, [scrollToId])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  useEffect(() => {
    if (!ready) return
    const focusHashTarget = () => {
      const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''))
      if (!hash) return
      scrollToId(hash)
    }
    const timer = window.setTimeout(focusHashTarget, 0)
    window.addEventListener('hashchange', focusHashTarget)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('hashchange', focusHashTarget)
    }
  }, [ready, scrollToId])

  useEffect(() => {
    const flushAll = () => {
      flushTranslationSave()
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flushAll()
    }
    window.addEventListener('pagehide', flushAll)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('pagehide', flushAll)
      document.removeEventListener('visibilitychange', handleVisibility)
      clearSaveTimer('translation')
    }
  }, [
    clearSaveTimer,
    flushTranslationSave,
  ])

  const providerPresetId = useMemo(
    () => resolveOpenAICompatiblePresetId(providerConfig),
    [providerConfig],
  )

  const deeplPlan =
    selectedProvider === 'deepl' ? resolveDeepLPlan(providerConfig) : null
  const deeplPlanWarningValue =
    selectedProvider === 'deepl' ? deepLPlanWarning(providerConfig) : null
  const deeplKeyValue =
    deeplPlan === 'pro'
      ? providerConfig.deeplProKey || ''
      : providerConfig.deeplFreeKey || ''

  const providerLabel = useCallback(
    (provider: string) => {
      if (provider === 'ollama') return t('options.provider.short.ollama')
      if (provider === 'ctranslate2') {
        return t('options.provider.short.ctranslate2')
      }
      if (provider === 'google-translate') {
        return t('options.provider.short.googleTranslate')
      }
      if (provider === 'deepl') return t('options.provider.short.deepl')
      return t('options.provider.short.openaiCompatible')
    },
    [t],
  )

  const currentDiag =
    diagResult &&
    normalizeProvider(diagResult.provider) === selectedProvider
      ? diagResult
      : null

  const connectionStatusLabel = currentDiag
    ? t(`options.diagnostics.status.${currentDiag.status}`)
    : t('options.connection.never')

  const connectionStatusMeta = currentDiag
    ? [
        providerLabel(currentDiag.provider),
        currentDiag.latencyMs !== null
          ? `${t('options.connection.latency')}: ${currentDiag.latencyMs} ms`
          : '',
        t('options.connection.lastTested', {
          time: new Date(currentDiag.checkedAt).toLocaleString(),
        }),
      ]
        .filter(Boolean)
        .join(' · ')
    : t('options.connection.neverHint')

  const ollamaFailure =
    selectedProvider === 'ollama' &&
    currentDiag !== null &&
    currentDiag.status !== 'connected'

  const ctranslate2Failure =
    selectedProvider === 'ctranslate2' &&
    currentDiag !== null &&
    currentDiag.status !== 'connected'

  const promptHeader = (
    <span className="collapse-header">
      <span>{t('options.prompt.title')}</span>
      {promptDirty && (
        <span className="unsaved-badge">{t('options.prompt.unsaved')}</span>
      )}
    </span>
  )

  const streamingHeader = (
    <span className="collapse-header">
      <span>{t('options.streaming.title')}</span>
      <span className="collapse-meta">
        {enableStreaming
          ? t('options.streaming.enabled')
          : t('options.streaming.disabled')}
      </span>
    </span>
  )

  const version = getExtensionVersion()

  if (initError) {
    return (
      <div className="OptionsContainer">
        <header className="page-header">
          <h1>{t('options.page.title')}</h1>
        </header>
        <Alert
          className="page-alert"
          type="error"
          showIcon
          message={t('options.loadError', { message: initError })}
        />
        <Button type="primary" onClick={() => window.location.reload()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  }

  return (
    <div className="OptionsContainer">
      <header className="page-header">
        <h1>{t('options.page.title')}</h1>
        <p>{t('options.autosave.pageNote')}</p>
      </header>

      <SettingsSection
        id="general"
        title={t('options.section.general')}
        status={<SaveIndicator state={saveStates.general} t={t} />}
      >
        <Field
          id="interface-language"
          label={t('options.general.language')}
          hint={t('options.general.languageHint')}
        >
          <Select
            id="interface-language"
            value={lang}
            onChange={(value) => void handleLanguageChange(value as Lang)}
            options={SUPPORTED_LANGS.map((item) => ({
              value: item.value,
              label: item.label,
            }))}
            style={{ maxWidth: 320 }}
          />
        </Field>
      </SettingsSection>

      <SettingsSection
        id="translation"
        title={t('options.section.translation')}
        description={t('options.translation.description')}
        status={
          <div className="section-status">
            {promptDirty &&
              selectedProvider !== 'google-translate' &&
              selectedProvider !== 'ctranslate2' &&
              selectedProvider !== 'deepl' && (
                <span className="unsaved-badge">
                  {t('options.prompt.unsaved')}
                </span>
              )}
            <SaveIndicator state={saveStates.translation} t={t} />
            {saveStates.streaming?.status === 'error' && (
              <SaveIndicator state={saveStates.streaming} t={t} />
            )}
          </div>
        }
      >
        <Field
          id="provider"
          label={t('options.provider.label')}
          hint={t('options.provider.hint')}
        >
          <Select
            id="provider"
            value={selectedProvider}
            onChange={(value) => handleProviderChange(String(value))}
            options={[
              {
                value: 'openai-compatible',
                label: t('options.provider.openaiCompatible'),
              },
              { value: 'ollama', label: t('options.provider.ollama') },
              {
                value: 'ctranslate2',
                label: t('options.provider.ctranslate2'),
              },
              {
                value: 'google-translate',
                label: t('options.provider.googleTranslate'),
              },
              { value: 'deepl', label: t('options.provider.deepl') },
            ]}
            style={{ maxWidth: 420 }}
          />
        </Field>

        <p className="provider-description">
          {t(PROVIDER_PRESETS[selectedProvider].descriptionKey)}
        </p>

        {(selectedProvider === 'ctranslate2' ||
          selectedProvider === 'deepl') && (
          <Field
            id="source-language"
            label={t('options.sourceLang.label')}
            hint={t(
              selectedProvider === 'deepl'
                ? 'options.sourceLang.hintDeepL'
                : 'options.sourceLang.hint',
            )}
          >
            <Select
              id="source-language"
              value={
                selectedProvider === 'deepl'
                  ? providerConfig.sourceLanguage || 'auto'
                  : providerConfig.sourceLanguage || DEFAULT_SOURCE_LANGUAGE
              }
              onChange={handleSourceLanguageChange}
              options={
                selectedProvider === 'deepl'
                  ? [
                      {
                        value: 'auto',
                        label: t('options.sourceLang.auto'),
                      },
                      ...TARGET_LANGUAGES,
                    ]
                  : TARGET_LANGUAGES
              }
              style={{ maxWidth: 320 }}
            />
          </Field>
        )}

        <Field
          id="target-language"
          label={t('options.targetLang.label')}
          hint={t('options.targetLang.hint')}
        >
          <Select
            id="target-language"
            value={providerConfig.targetLanguage || DEFAULT_TARGET_LANGUAGE}
            onChange={handleTargetLanguageChange}
            options={TARGET_LANGUAGES}
            style={{ maxWidth: 320 }}
          />
        </Field>

        {selectedProvider === 'google-translate' ? (
          <>
            <p className="note">{t('options.translation.googleNote')}</p>
            <Field
              id="base-url-google"
              label={t('options.baseUrl.label')}
              hint={t('options.baseUrl.googleFixed')}
            >
              <Input
                id="base-url-google"
                value={
                  providerConfig.baseURL ||
                  PROVIDER_PRESETS['google-translate'].baseURL
                }
                readOnly
                style={{ maxWidth: 480 }}
              />
            </Field>
          </>
        ) : (
          <>
            {selectedProvider === 'openai-compatible' && (
              <Field
                id="provider-preset"
                label={t('options.provider.presetLabel')}
                hint={t('options.provider.presetHint')}
              >
                <Select
                  id="provider-preset"
                  value={providerPresetId}
                  onChange={handleProviderPresetChange}
                  options={OPENAI_COMPATIBLE_PRESETS.map((preset) => ({
                    value: preset.id,
                    label: t(preset.labelKey),
                    disabled: preset.id === 'custom',
                  }))}
                  style={{ maxWidth: 320 }}
                />
              </Field>
            )}

            {selectedProvider !== 'deepl' &&
              PROVIDER_PRESETS[selectedProvider].requiresApiKey && (
              <Field
                id="api-key"
                label={t('options.apiKey.label')}
                hint={t('options.apiKey.hint')}
              >
                <Input.Password
                  id="api-key"
                  value={providerConfig.apiKey}
                  onChange={handleApiKeyDraftChange}
                  onBlur={handleApiKeyCommit}
                  placeholder={t('options.apiKey.placeholder')}
                  style={{ maxWidth: 480 }}
                />
              </Field>
            )}

            {selectedProvider === 'deepl' ? (
              <>
                <Field
                  id="deepl-plan"
                  label={t('options.deepl.planLabel')}
                  hint={t('options.deepl.planHint')}
                >
                  <Select
                    id="deepl-plan"
                    value={deeplPlan ?? 'free'}
                    onChange={handleDeepLPlanChange}
                    options={[
                      {
                        value: 'free',
                        label: t('options.deepl.planFree'),
                      },
                      {
                        value: 'pro',
                        label: t('options.deepl.planPro'),
                      },
                    ]}
                    style={{ maxWidth: 320 }}
                  />
                </Field>

                <Field
                  id="deepl-key"
                  label={t(
                    deeplPlan === 'pro'
                      ? 'options.deepl.proKeyLabel'
                      : 'options.deepl.freeKeyLabel',
                  )}
                  hint={t('options.deepl.keyHint')}
                >
                  <Input.Password
                    id="deepl-key"
                    value={deeplKeyValue}
                    onChange={handleDeepLKeyDraftChange}
                    onBlur={handleDeepLKeyCommit}
                    placeholder={t('options.apiKey.placeholder')}
                    style={{ maxWidth: 480 }}
                  />
                </Field>

                {deeplPlanWarningValue === 'free-key-looks-pro' && (
                  <p className="note">
                    {t('options.deepl.planMismatchFree')}
                  </p>
                )}
                {deeplPlanWarningValue === 'pro-key-looks-free' && (
                  <p className="note">
                    {t('options.deepl.planMismatchPro')}
                  </p>
                )}

                {!getDeepLApiKey(providerConfig) && (
                  <p className="field__hint">
                    {t('options.deepl.enterKey')}
                  </p>
                )}

                <Field
                  id="base-url-deepl"
                  label={t('options.baseUrl.label')}
                  hint={t('options.baseUrl.deeplFixed')}
                >
                  <Input
                    id="base-url-deepl"
                    value={deeplEndpoint(providerConfig)}
                    readOnly
                    style={{ maxWidth: 480 }}
                  />
                </Field>
                <p className="note">{t('options.deepl.keyNote')}</p>
              </>
            ) : (
              <>
                <Field id="base-url" label={t('options.baseUrl.label')}>
                  <Input
                    id="base-url"
                    value={providerConfig.baseURL}
                    onChange={(event) =>
                      handleConfigUpdate('baseURL', event.target.value)
                    }
                    onBlur={flushTranslationSave}
                    placeholder={t(
                      selectedProvider === 'ollama'
                        ? 'options.baseUrl.placeholder.ollama'
                        : selectedProvider === 'ctranslate2'
                        ? 'options.baseUrl.placeholder.ctranslate2'
                        : 'options.baseUrl.placeholder.openaiCompatible',
                    )}
                    style={{ maxWidth: 480 }}
                  />
                </Field>

                <Field id="model-name" label={t('options.modelName.label')}>
                  <Input
                    id="model-name"
                    value={providerConfig.modelName}
                    onChange={(event) =>
                      handleConfigUpdate('modelName', event.target.value)
                    }
                    onBlur={flushTranslationSave}
                    placeholder={t('options.modelName.placeholder', {
                      model: PROVIDER_PRESETS[selectedProvider].defaultModel,
                    })}
                    style={{ maxWidth: 480 }}
                  />
                </Field>
              </>
            )}

              <Collapse
                className="details-collapse"
                defaultActiveKey={[]}
                expandIcon={collapseExpandIcon}
              >
                {selectedProvider !== 'ctranslate2' &&
                  selectedProvider !== 'deepl' && (
                  <Collapse.Panel header={promptHeader} key="prompt">
                    <p className="field__hint">
                      {t('options.prompt.description')}
                    </p>
                    <Field
                      id="prompt-draft"
                      label={t('options.prompt.draftLabel')}
                    >
                  <Input.TextArea
                    id="prompt-draft"
                    value={promptDraft}
                    onChange={handlePromptDraftChange}
                    placeholder={t('options.prompt.placeholder')}
                    autoSize={{ minRows: 4, maxRows: 8 }}
                  />
                </Field>

                <div className="template-generator">
                  <p className="field__label">
                    {t('options.prompt.generateTitle')}
                  </p>
                  <p className="field__hint">
                    {t('options.prompt.generateHint')}
                  </p>
                  <div className="form-grid">
                    <Field
                      id="template-source"
                      label={t('options.prompt.sourceLang')}
                    >
                      <Select
                        id="template-source"
                        value={templateSource}
                        onChange={setTemplateSource}
                        options={[
                          ...TARGET_LANGUAGES,
                          {
                            value: 'auto',
                            label: t('options.prompt.autoDetect'),
                          },
                        ]}
                      />
                    </Field>
                    <Field
                      id="template-target"
                      label={t('options.prompt.targetLang')}
                    >
                      <Select
                        id="template-target"
                        value={templateTarget}
                        onChange={setTemplateTarget}
                        options={TARGET_LANGUAGES}
                      />
                    </Field>
                  </div>
                  <Button onClick={handleGenerateDraft}>
                    {t('options.prompt.generate')}
                  </Button>
                </div>

                <div className="prompt-actions">
                  <Button
                    type="primary"
                    onClick={() => void handlePromptSave()}
                    disabled={
                      !promptDirty ||
                      promptEmpty ||
                      promptSaveState.status === 'saving'
                    }
                    loading={promptSaveState.status === 'saving'}
                  >
                    {promptSaveState.status === 'saving'
                      ? t('options.prompt.saving')
                      : t('options.prompt.save')}
                  </Button>
                  <Button onClick={handlePromptReset}>
                    {t('options.prompt.reset')}
                  </Button>
                  <span className="prompt-status" aria-live="polite">
                    {promptSaveState.status === 'error' ? (
                      <span className="save-status save-status--error" role="alert">
                        {t('options.prompt.saveFailed', {
                          message: promptSaveState.message || '',
                        })}
                      </span>
                    ) : promptEmpty ? (
                      <span className="field__error" role="alert">
                        {t('options.prompt.empty')}
                      </span>
                    ) : promptDirty ? (
                      <span className="unsaved-badge">
                        {t('options.prompt.unsaved')}
                      </span>
                    ) : promptSaveState.status === 'saved' ? (
                      <span className="save-status save-status--ok">
                        {t('options.prompt.saved')}
                      </span>
                    ) : null}
                  </span>
                </div>
                  </Collapse.Panel>
                )}

              <Collapse.Panel header={streamingHeader} key="streaming">
                <div className="switch-row">
                  <div>
                    <label className="field__label" htmlFor="enable-streaming">
                      {t('options.streaming.label')}
                    </label>
                    <p className="field__hint">{t('options.streaming.hint')}</p>
                    <p className="field__hint">
                      {t('options.streaming.onlyProviders')}
                    </p>
                    {(selectedProvider === 'ctranslate2' ||
                      selectedProvider === 'deepl') && (
                      <p className="field__hint">
                        {t('options.streaming.ctranslate2Note')}
                      </p>
                    )}
                  </div>
                  <Switch
                    id="enable-streaming"
                    checked={enableStreaming}
                    onChange={handleStreamingChange}
                  />
                </div>
                <SaveIndicator state={saveStates.streaming} t={t} />
              </Collapse.Panel>
            </Collapse>

            {selectedProvider === 'ollama' && (
              <OllamaSetupCard
                t={t}
                baseURL={providerConfig.baseURL}
                activeModel={providerConfig.modelName}
                onUseModel={handleUseOllamaModel}
                diagnosticStatus={currentDiag?.status ?? null}
                remedyRequest={ollamaRemedyRequest}
              />
            )}

            {selectedProvider === 'ctranslate2' && (
              <CTranslate2SetupCard
                t={t}
                activeBaseURL={providerConfig.baseURL}
                selectedModel={providerConfig.modelName}
                diagnostic={currentDiag}
                diagnosticTesting={diagTesting}
                onTestConnection={() => void runConnectionTest()}
                onApplyBaseURL={handleApplyCTranslate2BaseURL}
                onSelectModel={handleSelectCTranslate2Model}
                onDiagnosticInvalidated={invalidateCTranslate2Diagnostic}
              />
            )}
          </>
        )}
      </SettingsSection>

      <SettingsSection
        id="connection"
        title={t('options.section.connection')}
        description={t('options.connection.description')}
      >
        <div className="connection-summary">
          <div className="connection-status">
            <span
              className={`status-dot status-dot--${
                currentDiag?.status ?? 'unknown'
              }`}
              aria-hidden="true"
            />
            <div>
              <div className="connection-status__label">
                {connectionStatusLabel}
              </div>
              <div className="connection-status__meta">
                {connectionStatusMeta}
              </div>
              {diagResult && !currentDiag && (
                <div className="connection-status__meta">
                  {t('options.connection.otherProvider', {
                    provider: providerLabel(diagResult.provider),
                  })}
                </div>
              )}
            </div>
          </div>
          <Button
            type="primary"
            onClick={() => void runConnectionTest()}
            loading={diagTesting}
            disabled={diagTesting}
          >
            {diagTesting
              ? t('options.connection.testing')
              : t('options.connection.test')}
          </Button>
        </div>

        {ollamaFailure && (
          <Alert
            className="connection-alert"
            type="warning"
            showIcon
            message={t('options.connection.ollamaRemedy')}
            action={
              <Button size="small" onClick={handleShowOllamaRemedy}>
                {t('options.connection.showRemedy')}
              </Button>
            }
          />
        )}

        {ctranslate2Failure && currentDiag && (
          <Alert
            className="connection-alert"
            type="warning"
            showIcon
            message={t('options.connection.ctranslate2Remedy')}
            description={t(
              `options.diagnostics.ctranslate2.hint.${currentDiag.status}`,
            )}
          />
        )}

        <details className="details">
          <summary>{t('options.connection.details')}</summary>

          {diagResult && (
            <div className="details-block">
              <p className="details-label">
                {t('options.connection.lastError')}
              </p>
              <pre className="error-detail">
                {diagResult.message}
                {diagResult.detail ? `\n${diagResult.detail}` : ''}
              </pre>
            </div>
          )}

          <div className="details-block">
            <p className="details-label">{t('options.connection.history')}</p>
            {diagHistory.length === 0 ? (
              <p className="field__hint">{t('options.connection.noHistory')}</p>
            ) : (
              <ul className="history-list">
                {diagHistory.map((entry, index) => (
                  <li key={`${entry.checkedAt}-${index}`}>
                    <span className="history-status">
                      {t(`options.diagnostics.status.${entry.status}`)}
                    </span>
                    <span className="history-time">
                      {new Date(entry.checkedAt).toLocaleString()}
                    </span>
                    <span className="history-message">
                      {entry.message}
                      {entry.latencyMs !== null
                        ? ` (${entry.latencyMs} ms)`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {resetError && (
            <p className="field__error" role="alert">
              {resetError}
            </p>
          )}

          <div className="details-actions">
            <Button onClick={() => void copyBaseUrl()}>
              {t('options.connection.copyUrl')}
            </Button>
            {selectedProvider === 'ollama' && (
              <Button
                onClick={() => chrome.tabs.create({ url: 'ollama://' })}
              >
                {t('options.connection.openOllama')}
              </Button>
            )}
            <Popconfirm
              title={t('options.connection.resetConfirm')}
              okText={t('common.confirm')}
              cancelText={t('common.cancel')}
              onConfirm={() => void handleResetConnection()}
            >
              <Button danger>{t('options.connection.reset')}</Button>
            </Popconfirm>
          </div>
        </details>
      </SettingsSection>

      <SettingsSection
        id="sites"
        title={t('options.autoDetection.title')}
        description={t('options.autoDetection.description')}
      >
        <DetectionStatusPanel t={t} />
        <p className="field__hint">{t('options.autoDetection.legacyNote')}</p>
      </SettingsSection>

      <footer className="page-footer">
        {version && (
          <span>{t('options.footer.version', { version })}</span>
        )}
        <a
          href="https://github.com/ChenYCL/chrome-extension-udemy-translate"
          target="_blank"
          rel="noopener noreferrer"
        >
          <GithubFilled aria-hidden="true" />
          <span>{t('options.footer.project')}</span>
        </a>
      </footer>
    </div>
  )
}

interface OllamaSetupCardProps {
  t: TFunction
  baseURL: string
  activeModel: string
  onUseModel: (modelName: string) => void
  diagnosticStatus: DiagnosticStatus | null
  remedyRequest: number
}

const OllamaSetupCard: React.FC<OllamaSetupCardProps> = ({
  t,
  baseURL,
  activeModel,
  onUseModel,
  diagnosticStatus,
  remedyRequest,
}) => {
  const [detecting, setDetecting] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [pullStatus, setPullStatus] = useState('')
  const [pullModel, setPullModel] = useState('qwen2:0.5b')
  const [result, setResult] = useState<OllamaDetectResult | null>(null)
  const [error, setError] = useState('')
  const [pullError, setPullError] = useState('')
  const [activeKeys, setActiveKeys] = useState<string[]>([])

  const remedyKey = remedyKeyForStatus(diagnosticStatus)

  useEffect(() => {
    if (!remedyKey) return
    setActiveKeys((previous) =>
      previous.includes(remedyKey) ? previous : [...previous, remedyKey],
    )
  }, [remedyKey, remedyRequest])

  const openRemedy = useCallback((key: string) => {
    setActiveKeys((previous) =>
      previous.includes(key) ? previous : [...previous, key],
    )
  }, [])

  const handleDetect = useCallback(async () => {
    setDetecting(true)
    setError('')
    try {
      const detected = await detectOllama(baseURL)
      setResult(detected)
      if (!detected.ok) {
        if (detected.cors) {
          setError(t('options.ollamaSetup.errorCors'))
          openRemedy('cors')
        } else {
          setError(
            t('options.ollamaSetup.errorConnect', { url: baseURL }) +
              (detected.error ? ` (${detected.error})` : ''),
          )
          openRemedy('start')
        }
      }
    } catch (detectError: any) {
      setError(detectError?.message || String(detectError))
    } finally {
      setDetecting(false)
    }
  }, [baseURL, openRemedy, t])

  const handlePull = useCallback(async () => {
    if (!pullModel.trim()) return
    setPulling(true)
    setPullStatus('')
    setError('')
    setPullError('')
    try {
      await pullOllamaModel(baseURL, pullModel.trim(), (event) => {
        if ('status' in event) {
          let line = event.status
          if (event.total && event.completed !== undefined) {
            const percent = Math.round((event.completed / event.total) * 100)
            line = `${event.status} ${percent}%`
          }
          setPullStatus(line)
        }
      })
      message.success(
        t('options.ollamaSetup.pullDone', { model: pullModel.trim() }),
      )
      setPullStatus('')
      void handleDetect()
    } catch (pullError: any) {
      setPullError(
        t('options.ollamaSetup.pullFailed', {
          message: pullError?.message || String(pullError),
        }),
      )
    } finally {
      setPulling(false)
    }
  }, [baseURL, handleDetect, pullModel, t])

  return (
    <div className="ollama-setup" id="ollama-setup" aria-labelledby="ollama-setup-heading">
      <h3 id="ollama-setup-heading" tabIndex={-1}>
        {t('options.ollamaSetup.title')}
      </h3>
      <p className="field__hint">{t('options.ollamaSetup.intro')}</p>

      {diagnosticStatus && diagnosticStatus !== 'connected' && (
        <Alert
          className="connection-alert"
          type="warning"
          showIcon
          message={t('options.ollamaSetup.connectionFailed')}
          description={t(`options.diagnostics.hint.${diagnosticStatus}`)}
        />
      )}

      {result && (
        <Alert
          className="connection-alert"
          type={result.ok ? 'success' : 'error'}
          showIcon
          message={
            result.ok
              ? t('options.ollamaSetup.running')
              : t('options.ollamaSetup.notRunning')
          }
          description={
            result.ok
              ? result.version
                ? `${t('options.ollamaSetup.version')}: ${result.version}`
                : undefined
              : error || t('options.ollamaSetup.installHint')
          }
        />
      )}

      <div className="inline-controls">
        <Button
          onClick={() => void handleDetect()}
          loading={detecting}
        >
          {detecting
            ? t('options.ollamaSetup.detecting')
            : t('options.ollamaSetup.detect')}
        </Button>
        {activeModel && (
          <span className="field__hint">
            {t('options.ollamaSetup.activeModel')}: <code>{activeModel}</code>
          </span>
        )}
      </div>

      {result?.ok && (
        <div className="details-block">
          <p className="details-label">
            {t('options.ollamaSetup.modelsTitle')} ({result.models.length})
          </p>
          {result.models.length === 0 ? (
            <p className="field__hint">
              {t('options.ollamaSetup.noModels')}
            </p>
          ) : (
            <ul className="model-list">
              {result.models.map((model: OllamaModel) => (
                <li key={model.name}>
                  <code>{model.name}</code>
                  {model.details?.parameter_size && (
                    <span className="field__hint">
                      {model.details.parameter_size}
                    </span>
                  )}
                  <Button size="small" onClick={() => onUseModel(model.name)}>
                    {t('options.ollamaSetup.useModel')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="details-block">
        <p className="field__label">{t('options.ollamaSetup.pullTitle')}</p>
        <Field
          id="ollama-pull-model"
          label={t('options.ollamaSetup.pullModelLabel')}
        >
          <div className="inline-controls">
            <Input
              id="ollama-pull-model"
              value={pullModel}
              onChange={(event) => setPullModel(event.target.value)}
              placeholder={t('options.ollamaSetup.pullPlaceholder')}
              disabled={pulling}
              style={{ flex: '1 1 200px' }}
            />
            <Button
              type="primary"
              onClick={() => void handlePull()}
              loading={pulling}
              disabled={!pullModel.trim()}
            >
              {pulling
                ? t('options.ollamaSetup.pulling')
                : t('options.ollamaSetup.pullButton')}
            </Button>
            <Button
              onClick={() => {
                const model = pullModel.trim()
                if (model) onUseModel(model)
              }}
              disabled={!pullModel.trim()}
            >
              {t('options.ollamaSetup.useModel')}
            </Button>
          </div>
        </Field>
        {pullStatus && (
          <p className="save-status" role="status">
            {t('options.ollamaSetup.pullProgress', { status: pullStatus })}
          </p>
        )}
        {pullError && (
          <Alert
            className="connection-alert"
            type="error"
            showIcon
            message={pullError}
          />
        )}
        <p className="field__hint">
          {t('options.ollamaSetup.recommendHint')}
        </p>
        <div
          className="recommendation-list"
          role="group"
          aria-label={t('options.ollamaSetup.recommendTitle')}
        >
          {RECOMMENDED_OLLAMA_MODELS.map((model) => (
            <Button
              key={model}
              size="small"
              onClick={() => setPullModel(model)}
              disabled={pulling}
            >
              {model}
            </Button>
          ))}
        </div>
      </div>

      <p className="field__label">{t('options.ollamaSetup.setupCommands')}</p>
      <Collapse
        className="details-collapse"
        activeKey={activeKeys}
        expandIcon={collapseExpandIcon}
        onChange={(keys) =>
          setActiveKeys(Array.isArray(keys) ? keys : [keys])
        }
      >
        <Collapse.Panel
          header={t('options.ollamaSetup.startTitle')}
          key="start"
        >
          <StartOllamaBlock t={t} />
        </Collapse.Panel>
        <Collapse.Panel
          header={t('options.ollamaSetup.corsFixTitle')}
          key="cors"
        >
          <CorsFixBlock t={t} />
        </Collapse.Panel>
      </Collapse>
    </div>
  )
}

function detectPlatform(): 'mac' | 'win' | 'linux' | 'unknown' {
  const userAgent = (navigator.userAgent || '').toLowerCase()
  const platform = (navigator.platform || '').toLowerCase()
  if (platform.includes('mac') || userAgent.includes('mac')) return 'mac'
  if (platform.includes('win') || userAgent.includes('win')) return 'win'
  if (platform.includes('linux') || userAgent.includes('linux')) return 'linux'
  return 'unknown'
}

const StartOllamaBlock: React.FC<{ t: TFunction }> = ({ t }) => {
  const [platform, setPlatform] = useState<
    'mac' | 'win' | 'linux' | 'unknown'
  >('unknown')

  useEffect(() => {
    setPlatform(detectPlatform())
  }, [])

  const commandKey =
    platform === 'mac'
      ? 'options.ollamaSetup.cmd.macos'
      : platform === 'win'
      ? 'options.ollamaSetup.cmd.windows'
      : 'options.ollamaSetup.cmd.linux'
  const command = t(commandKey)

  const copyCommand = useCallback(() => {
    navigator.clipboard.writeText(command).then(
      () => message.success(t('options.ollamaSetup.copied')),
      () => message.error(t('common.copyFailed')),
    )
  }, [command, t])

  const openUrl = useCallback((url: string) => {
    chrome.tabs.create({ url })
  }, [])

  return (
    <div className="remedy-block">
      <p className="field__hint">{t('options.ollamaSetup.startHint')}</p>
      <div className="command-row">
        <code>{command}</code>
        <Button size="small" onClick={copyCommand}>
          {t('options.ollamaSetup.copyCommand')}
        </Button>
      </div>
      <div className="details-actions">
        {platform === 'mac' && (
          <Button size="small" onClick={() => openUrl('ollama://')}>
            {t('options.ollamaSetup.openApp')}
          </Button>
        )}
        <Button
          size="small"
          onClick={() => openUrl('https://ollama.com/download')}
        >
          {t('options.ollamaSetup.openDownload')}
        </Button>
        <Button
          size="small"
          onClick={() =>
            openUrl('https://github.com/ollama/ollama/blob/main/docs/api.md')
          }
        >
          {t('options.ollamaSetup.openDocs')}
        </Button>
      </div>
    </div>
  )
}

const CorsFixBlock: React.FC<{ t: TFunction }> = ({ t }) => {
  const [platform, setPlatform] = useState<
    'mac' | 'win' | 'linux' | 'unknown'
  >('unknown')

  useEffect(() => {
    setPlatform(detectPlatform())
  }, [])

  const strictKey =
    platform === 'mac'
      ? 'options.ollamaSetup.corsCmd.macos'
      : platform === 'win'
      ? 'options.ollamaSetup.corsCmd.windows'
      : 'options.ollamaSetup.corsCmd.linux'
  const permKey =
    platform === 'mac'
      ? 'options.ollamaSetup.corsPermCmd.macos'
      : platform === 'win'
      ? 'options.ollamaSetup.corsPermCmd.windows'
      : 'options.ollamaSetup.corsPermCmd.linux'

  const strict = t(strictKey)
  const perm = t(permKey)

  const copyText = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text).then(
        () => message.success(t('options.ollamaSetup.copied')),
        () => message.error(t('common.copyFailed')),
      )
    },
    [t],
  )

  const CodeRow: React.FC<{ value: string }> = ({ value }) => (
    <div className="command-row">
      <code>{value}</code>
      <Button size="small" onClick={() => copyText(value)}>
        {t('options.ollamaSetup.copyCommand')}
      </Button>
    </div>
  )

  return (
    <div className="remedy-block">
      <p className="field__hint">{t('options.ollamaSetup.corsFixHint')}</p>
      <CodeRow value={strict} />
      <p className="field__hint">
        {t('options.ollamaSetup.corsAltTitle')}
      </p>
      <CodeRow value={perm} />
      <div className="field__hint">
        <p>{t('options.ollamaSetup.corsAltHint')}</p>
        <ul>
          <li>{t('options.ollamaSetup.corsRestartHint')}</li>
          <li>{t('options.ollamaSetup.corsWindowsHint')}</li>
          <li>{t('options.ollamaSetup.corsServiceHint')}</li>
        </ul>
      </div>
    </div>
  )
}

const DETECTION_REASON_KEYS: Record<string, string> = {
  connected: 'detection.reason.connected',
  'video-not-found': 'detection.reason.videoNotFound',
  'video-offscreen': 'detection.reason.videoOffscreen',
  'frame-visibility-unknown': 'detection.reason.frameUnknown',
  'subtitle-not-found': 'detection.reason.subtitleNotFound',
  'no-readable-subtitles': 'detection.reason.noReadable',
  'low-confidence': 'detection.reason.lowConfidence',
  'ambiguous-second-candidate': 'detection.reason.ambiguous',
  'insufficient-behavior-evidence': 'detection.reason.insufficient',
  'waiting-for-text': 'detection.reason.waitingText',
  'waiting-for-next-line': 'detection.reason.waitingLine',
  'awaiting-source-grant': 'detection.reason.awaitingGrant',
  'source-changed-or-lost': 'detection.reason.sourceLost',
  'page-hidden': 'detection.reason.pageHidden',
  'frame-visibility': 'detection.reason.frameUnknown',
  'extension-disabled': 'detection.reason.extensionDisabled',
  'no-frame': 'detection.reason.noFrame',
  'switching-source': 'detection.reason.switching',
  stopped: 'detection.reason.disabled',
  disabled: 'detection.reason.disabled',
}

const phaseColor = (phase: string): { background: string; color: string; border: string } => {
  if (phase === 'connected') {
    return { background: '#f6ffed', color: '#389e0d', border: '1px solid #b7eb8f' }
  }
  if (phase === 'waiting' || phase === 'verifying') {
    return { background: '#fffbe6', color: '#ad6800', border: '1px solid #ffe58f' }
  }
  if (phase === 'unavailable') {
    return { background: '#fff2f0', color: '#cf1322', border: '1px solid #ffccc7' }
  }
  return { background: '#f5f5f5', color: '#595959', border: '1px solid #d9d9d9' }
}

const DetectionStatusPanel: React.FC<{
  t: (key: string, vars?: Record<string, string>) => string
}> = ({ t }) => {
  const [data, setData] = useState<DetectionStatusResponse | null>(null)

  useEffect(() => {
    let mounted = true
    const load = () => {
      if (!chrome?.runtime?.sendMessage) return
      try {
        chrome.runtime.sendMessage(
          { type: 'GET_DETECTION_STATUS' },
          (response: DetectionStatusResponse | undefined) => {
            if (!mounted) return
            if (chrome.runtime.lastError) return
            if (response?.type === 'DETECTION_STATUS') setData(response)
          },
        )
      } catch {
        // Eklenti bağlamı yenilenmiş olabilir.
      }
    }
    load()
    const timer = window.setInterval(load, 2000)
    return () => {
      mounted = false
      window.clearInterval(timer)
    }
  }, [])

  const enabled = data?.enabled ?? false
  const status = data?.status
  const phase = enabled ? status?.phase || 'searching' : 'disabled'
  const sourceKind: SourceKind | undefined =
    status?.sourceKind || status?.source?.kind
  const colors = phaseColor(phase)
  const reason = status?.reason || 'searching'
  const reasonKey = DETECTION_REASON_KEYS[reason]

  return (
    <div
      style={{
        marginTop: '10px',
        padding: '10px 12px',
        borderRadius: '6px',
        backgroundColor: '#fafafa',
        border: '1px solid #f0f0f0',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 10px',
            borderRadius: '10px',
            fontSize: '12px',
            fontWeight: 'bold',
            ...colors,
          }}
        >
          ● {t(`detection.phase.${phase}`)}
        </span>
        {sourceKind && (
          <span style={{ fontSize: '12px', color: '#595959' }}>
            {t('options.autoDetection.source')}: {t(`detection.source.${sourceKind}`)}
          </span>
        )}
        {typeof status?.score === 'number' && (
          <span style={{ fontSize: '12px', color: '#8c8c8c' }}>
            {t('options.autoDetection.score')}: {status.score}
          </span>
        )}
      </div>
      <details style={{ marginTop: '8px' }}>
        <summary style={{ cursor: 'pointer', fontSize: '12px', color: '#666' }}>
          {t('options.autoDetection.diagnostics')}
        </summary>
        <p style={{ margin: '6px 0 2px 0', fontSize: '12px', color: '#666' }}>
          {t('options.autoDetection.diagnosticsHint')}
        </p>
        <code style={{ fontSize: '11px', color: '#8c8c8c' }}>
          {reasonKey ? t(reasonKey) : reason}
          {status?.frameId !== undefined ? ` · frame ${status.frameId}` : ''}
        </code>
      </details>
    </div>
  )
}


export default Options
