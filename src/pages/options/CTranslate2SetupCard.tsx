import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Alert, Button, Collapse, Input, Select, message } from 'antd'
import { RightOutlined } from '@ant-design/icons'
import type { DiagnosticResult } from '../../utils/diagnostics'
import { getStoredValues, setStoredValues } from '../../utils/storage'
import {
  CT2_HOST_VERSION,
  CTranslate2NativeHostError,
  detectNativeBrowser,
  getCTranslate2NativeServerStatus,
  isValidChromeExtensionId,
  listCTranslate2NativeModels,
  startCTranslate2NativeServer,
  stopCTranslate2NativeServer,
  type NativeModelEntry,
  type NativeServerState,
} from '../../utils/ctranslate2-native-host'
import {
  CTRANSLATE2_COMPUTE_TYPES,
  CTRANSLATE2_DEVICES,
  CTRANSLATE2_HOSTS,
  CTRANSLATE2_LOG_LEVELS,
  CTRANSLATE2_SERVER_SETTINGS_STORAGE_KEY,
  CTRANSLATE2_SHELLS,
  CT2_EXTENSION_ID,
  applyDeviceToDraft,
  buildCTranslate2TranslationBaseURL,
  buildInstallCommands,
  buildNativeHostInstallCommand,
  buildOneClickInstallCommand,
  buildOneClickInstallScriptUrl,
  buildPrepareModelCommand,
  buildServeCommand,
  draftFromServerSettings,
  isValidPrepareModelName,
  requestedServerDiffersFromHealth,
  resolveInitialCTranslate2ServerSettings,
  validateCTranslate2ServerSettingsDraft,
  type CTranslate2Device,
  type CTranslate2ServerSettings,
  type CTranslate2ServerSettingsDraft,
  type CTranslate2Shell,
} from '../../utils/ctranslate2-server-settings'

type TFunction = (key: string, vars?: Record<string, string>) => string

interface CTranslate2SetupCardProps {
  t: TFunction
  activeBaseURL: string
  selectedModel: string
  diagnostic: DiagnosticResult | null
  diagnosticTesting: boolean
  onTestConnection: () => void
  onApplyBaseURL: (baseURL: string) => Promise<string | null>
  onSelectModel: (modelId: string) => Promise<string | null>
  onDiagnosticInvalidated: () => void
}

interface SaveState {
  status: 'idle' | 'saving' | 'saved' | 'error'
  message?: string
}

type NativeLauncherState =
  | 'checking'
  | 'unavailable'
  | 'stopped'
  | 'running'
  | 'external_running'
  | 'starting'
  | 'stopping'
  | 'error'

const SAVE_DEBOUNCE_MS = 400

function getExtensionId(): string {
  try {
    return chrome.runtime?.id || ''
  } catch {
    return ''
  }
}

function nativeErrorMessage(error: unknown): string {
  if (error instanceof CTranslate2NativeHostError) return error.message
  return error instanceof Error ? error.message : String(error)
}

const NATIVE_INSTALL_ERROR_CODES = new Set([
  'native_host_not_installed',
  'native_messaging_unavailable',
  'native_host_forbidden',
  'host_config_missing',
  'host_config_invalid',
])

function isNativeInstallError(error: unknown): boolean {
  return (
    error instanceof CTranslate2NativeHostError &&
    NATIVE_INSTALL_ERROR_CODES.has(error.code)
  )
}

const collapseExpandIcon = ({ isActive }: { isActive?: boolean }) => (
  <RightOutlined rotate={isActive ? 90 : 0} aria-hidden="true" />
)

const SetupField: React.FC<{
  id: string
  label: string
  hint?: React.ReactNode
  error?: string
  children: React.ReactNode
}> = ({ id, label, hint, error, children }) => (
  <div className="field">
    <label className="field__label" htmlFor={id}>
      {label}
    </label>
    {children}
    {error ? (
      <p className="field__error" role="alert">
        {error}
      </p>
    ) : hint ? (
      <p className="field__hint">{hint}</p>
    ) : null}
  </div>
)

const HealthRow: React.FC<{ label: string; value: React.ReactNode }> = ({
  label,
  value,
}) => (
  <div className="health-row">
    <span className="health-row__label">{label}</span>
    <span className="health-row__value">{value}</span>
  </div>
)

const copyText = (
  value: string,
  t: TFunction,
  onFailureKey = 'common.copyFailed',
): void => {
  if (!value) return
  navigator.clipboard.writeText(value).then(
    () => message.success(t('options.ctranslate2Setup.copied')),
    () => message.error(t(onFailureKey)),
  )
}

const CommandBlock: React.FC<{
  t: TFunction
  title: string
  description: React.ReactNode
  command: string
  disabled: boolean
  emptyText?: string
}> = ({ t, title, description, command, disabled, emptyText }) => (
  <div className="details-block">
    <div className="command-block__header">
      <p className="field__label">{title}</p>
      <Button
        size="small"
        disabled={disabled || !command}
        onClick={() => copyText(command, t)}
      >
        {t('options.ctranslate2Setup.copyCommands')}
      </Button>
    </div>
    <p className="field__hint">{description}</p>
    <pre className="error-detail">{command || emptyText || '—'}</pre>
  </div>
)

export const CTranslate2SetupCard: React.FC<
  CTranslate2SetupCardProps
> = ({
  t,
  activeBaseURL,
  selectedModel,
  diagnostic,
  diagnosticTesting,
  onTestConnection,
  onApplyBaseURL,
  onSelectModel,
  onDiagnosticInvalidated,
}) => {
  const initialBaseURLRef = useRef(activeBaseURL)
  const lastActiveBaseURLRef = useRef(activeBaseURL)
  const diagnosticRef = useRef<DiagnosticResult | null>(diagnostic)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [draft, setDraft] = useState<CTranslate2ServerSettingsDraft>(() =>
    draftFromServerSettings(resolveInitialCTranslate2ServerSettings(
      undefined,
      activeBaseURL,
    )),
  )
  const draftRef = useRef(draft)
  const lastValidSettingsRef = useRef<CTranslate2ServerSettings>(
    resolveInitialCTranslate2ServerSettings(undefined, activeBaseURL),
  )
  const pendingSettingsRef = useRef<CTranslate2ServerSettings | null>(null)
  const timerRef = useRef<number | null>(null)
  const saveSequenceRef = useRef(0)
  const mountedRef = useRef(true)
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' })
  const [applyingBaseURL, setApplyingBaseURL] = useState(false)
  const [nativeState, setNativeState] =
    useState<NativeLauncherState>('checking')
  const [nativeHostAvailable, setNativeHostAvailable] = useState<
    boolean | null
  >(null)
  const [nativeManaged, setNativeManaged] = useState(false)
  const [nativeError, setNativeError] = useState('')
  const [nativeBusy, setNativeBusy] = useState(false)
  const [nativeHostVersion, setNativeHostVersion] = useState<number | null>(
    null,
  )
  const [preparedModels, setPreparedModels] = useState<NativeModelEntry[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const nativeStatusLoadedRef = useRef(false)
  const lastNativeStatusKeyRef = useRef(`${draft.host}:${draft.port}`)
  const extensionId = getExtensionId()
  const extensionIdValid = isValidChromeExtensionId(extensionId)
  const nativeBrowser = detectNativeBrowser()
  const nativeHostOutdated =
    nativeHostVersion !== null &&
    nativeHostVersion < CT2_HOST_VERSION

  const persistSettings = useCallback(
    async (settings: CTranslate2ServerSettings): Promise<void> => {
      const sequence = saveSequenceRef.current + 1
      saveSequenceRef.current = sequence
      if (mountedRef.current) {
        setSaveState({ status: 'saving' })
      }
      try {
        await setStoredValues({
          [CTRANSLATE2_SERVER_SETTINGS_STORAGE_KEY]: settings,
        })
        if (mountedRef.current && saveSequenceRef.current === sequence) {
          setSaveState({ status: 'saved' })
        }
      } catch (error: any) {
        if (mountedRef.current && saveSequenceRef.current === sequence) {
          setSaveState({
            status: 'error',
            message: error?.message || String(error),
          })
        }
      }
    },
    [],
  )

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const flushPendingSave = useCallback(() => {
    clearTimer()
    const pending = pendingSettingsRef.current
    pendingSettingsRef.current = null
    if (pending) void persistSettings(pending)
  }, [clearTimer, persistSettings])

  const scheduleSave = useCallback(
    (settings: CTranslate2ServerSettings) => {
      pendingSettingsRef.current = settings
      clearTimer()
      if (mountedRef.current) {
        setSaveState({ status: 'saving' })
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        const pending = pendingSettingsRef.current
        pendingSettingsRef.current = null
        if (pending) void persistSettings(pending)
      }, SAVE_DEBOUNCE_MS)
    },
    [clearTimer, persistSettings],
  )

  useEffect(() => {
    mountedRef.current = true
    let active = true
    const load = async () => {
      try {
        const stored = await getStoredValues<Record<string, unknown>>([
          CTRANSLATE2_SERVER_SETTINGS_STORAGE_KEY,
        ])
        if (!active) return
        const settings = resolveInitialCTranslate2ServerSettings(
          stored?.[CTRANSLATE2_SERVER_SETTINGS_STORAGE_KEY],
          initialBaseURLRef.current,
        )
        const nextDraft = draftFromServerSettings(settings)
        draftRef.current = nextDraft
        lastValidSettingsRef.current = settings
        lastNativeStatusKeyRef.current = `${nextDraft.host}:${nextDraft.port}`
        setDraft(nextDraft)
      } catch (error: any) {
        if (!active) return
        setLoadError(error?.message || String(error))
        const settings = resolveInitialCTranslate2ServerSettings(
          undefined,
          initialBaseURLRef.current,
        )
        const nextDraft = draftFromServerSettings(settings)
        draftRef.current = nextDraft
        lastValidSettingsRef.current = settings
        lastNativeStatusKeyRef.current = `${nextDraft.host}:${nextDraft.port}`
        setDraft(nextDraft)
      } finally {
        if (active) setLoaded(true)
      }
    }
    void load()
    return () => {
      active = false
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const handlePageHide = () => flushPendingSave()
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      flushPendingSave()
    }
  }, [flushPendingSave])

  const validation = useMemo(
    () => validateCTranslate2ServerSettingsDraft(draft),
    [draft],
  )
  const settings = validation.settings
  const modelNameValid = isValidPrepareModelName(selectedModel)
  const portValid = !validation.errors.port

  const invalidateDiagnostic = useCallback(() => {
    if (diagnosticRef.current) onDiagnosticInvalidated()
  }, [onDiagnosticInvalidated])

  useEffect(() => {
    diagnosticRef.current = diagnostic
  }, [diagnostic])

  useEffect(() => {
    if (!loaded) return
    if (lastActiveBaseURLRef.current !== activeBaseURL) {
      lastActiveBaseURLRef.current = activeBaseURL
      invalidateDiagnostic()
    }
  }, [activeBaseURL, invalidateDiagnostic, loaded])

  const handleDraftChange = useCallback(
    (next: CTranslate2ServerSettingsDraft) => {
      invalidateDiagnostic()
      draftRef.current = next
      setDraft(next)
      const result = validateCTranslate2ServerSettingsDraft(next)
      if (result.valid && result.settings) {
        lastValidSettingsRef.current = result.settings
        scheduleSave(result.settings)
      } else {
        // A previously queued valid edit must not be lost just because the
        // current form state became invalid. Persist it immediately so the
        // last valid settings remain durable.
        flushPendingSave()
      }
    },
    [flushPendingSave, invalidateDiagnostic, scheduleSave],
  )

  const handleDeviceChange = useCallback(
    (device: CTranslate2Device) => {
      handleDraftChange(applyDeviceToDraft(draftRef.current, device))
    },
    [handleDraftChange],
  )

  const fieldError = useCallback(
    (field: keyof CTranslate2ServerSettingsDraft): string | undefined => {
      const error = validation.errors[field]
      if (!error) return undefined
      if (field === 'modelDirectory') {
        return error === 'unsafe'
          ? t('options.ctranslate2Setup.validation.unsafe')
          : t('options.ctranslate2Setup.validation.modelDirectoryRequired')
      }
      if (field === 'port') {
        return error === 'range'
          ? t('options.ctranslate2Setup.validation.portRange')
          : t('options.ctranslate2Setup.validation.portInvalid')
      }
      return t('options.ctranslate2Setup.validation.invalid')
    },
    [t, validation.errors],
  )

  const installCommand = useMemo(
    () => buildInstallCommands(draft.shell).join('\n'),
    [draft.shell],
  )

  const oneClickCommand = useMemo(() => {
    try {
      return buildOneClickInstallCommand(
        draft.shell,
        modelNameValid ? selectedModel : undefined,
      )
    } catch {
      return ''
    }
  }, [draft.shell, modelNameValid, selectedModel])

  const prepareCommand = useMemo(() => {
    if (!settings || !modelNameValid) return ''
    try {
      return buildPrepareModelCommand(
        settings,
        selectedModel,
        settings.shell,
      )
    } catch {
      return ''
    }
  }, [modelNameValid, selectedModel, settings])

  const startCommand = useMemo(() => {
    if (!settings) return ''
    try {
      return buildServeCommand(settings, settings.shell)
    } catch {
      return ''
    }
  }, [settings])

  const generatedAddress = portValid
    ? buildCTranslate2TranslationBaseURL({
        host: draft.host,
        port: Number(draft.port),
      })
    : ''
  const normalizedActiveBaseURL = (activeBaseURL || '')
    .trim()
    .replace(/\/+$/, '')
  const addressDiffers =
    !!generatedAddress && generatedAddress !== normalizedActiveBaseURL

  const applyNativeStatus = useCallback((status: {
    state?: NativeServerState
    managed?: boolean
    hostVersion?: number
  }) => {
    setNativeHostAvailable(true)
    setNativeManaged(!!status.managed)
    setNativeState(status.state ?? 'stopped')
    if (typeof status.hostVersion === 'number') {
      setNativeHostVersion(status.hostVersion)
    }
    setNativeError('')
  }, [])

  const refreshNativeStatus = useCallback(async () => {
    setNativeState('checking')
    setNativeError('')
    try {
      const status = await getCTranslate2NativeServerStatus(
        portValid
          ? { host: draft.host, port: Number(draft.port) }
          : undefined,
      )
      applyNativeStatus(status)
    } catch (error: unknown) {
      if (isNativeInstallError(error)) {
        setNativeHostAvailable(false)
        setNativeState('unavailable')
      } else {
        setNativeHostAvailable(true)
        setNativeState('error')
      }
      setNativeError(nativeErrorMessage(error))
    }
  }, [applyNativeStatus, draft.host, draft.port, portValid])

  useEffect(() => {
    if (!loaded || nativeStatusLoadedRef.current) return
    nativeStatusLoadedRef.current = true
    void refreshNativeStatus()
  }, [loaded, refreshNativeStatus])

  const nativeStatusKey = `${draft.host}:${draft.port}`
  useEffect(() => {
    if (!loaded) return
    if (lastNativeStatusKeyRef.current === nativeStatusKey) return
    lastNativeStatusKeyRef.current = nativeStatusKey
    setNativeState('checking')
    setNativeError('')
    const timer = window.setTimeout(() => {
      void refreshNativeStatus()
    }, 300)
    return () => window.clearTimeout(timer)
  }, [loaded, nativeStatusKey, refreshNativeStatus])

  const refreshPreparedModels = useCallback(async () => {
    setModelsLoading(true)
    setModelsError('')
    try {
      const status = await listCTranslate2NativeModels()
      setPreparedModels(status.models ?? [])
      setNativeHostAvailable(true)
    } catch (error: unknown) {
      setPreparedModels([])
      if (
        error instanceof CTranslate2NativeHostError &&
        error.code === 'unknown_action'
      ) {
        setNativeHostVersion((current) =>
          current ?? CT2_HOST_VERSION - 1,
        )
      }
      setModelsError(nativeErrorMessage(error))
      if (isNativeInstallError(error)) {
        setNativeHostAvailable(false)
        setNativeState('unavailable')
      }
    } finally {
      setModelsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!loaded) return
    if (nativeHostAvailable !== true) return
    if (nativeHostOutdated) return
    void refreshPreparedModels()
  }, [
    loaded,
    nativeHostAvailable,
    nativeHostOutdated,
    refreshPreparedModels,
  ])

  const handleSelectPreparedModel = useCallback(
    async (directory: string) => {
      const model = preparedModels.find(
        (entry) => entry.directory === directory,
      )
      if (!model) return
      handleDraftChange({
        ...draftRef.current,
        modelDirectory: directory,
      })
      if (!model.model_id) return
      try {
        const error = await onSelectModel(model.model_id)
        if (error) {
          message.error(
            t('options.ctranslate2Setup.models.selectFailed', {
              message: error,
            }),
          )
        }
      } catch (error: any) {
        message.error(
          t('options.ctranslate2Setup.models.selectFailed', {
            message: error?.message || String(error),
          }),
        )
      }
    },
    [handleDraftChange, onSelectModel, preparedModels, t],
  )

  const nativeInstallCommand = buildNativeHostInstallCommand(
    draft.shell,
    extensionIdValid ? extensionId : undefined,
    nativeBrowser,
  )

  const handleNativeStart = useCallback(async () => {
    if (!settings) return
    invalidateDiagnostic()
    flushPendingSave()
    setNativeBusy(true)
    setNativeState('starting')
    setNativeError('')
    try {
      const status = await startCTranslate2NativeServer(
        settings,
        selectedModel,
      )
      const external =
        status.state === 'external_running' ||
        (status.state === 'running' && !status.managed)
      setNativeHostAvailable(true)
      setNativeManaged(!!status.managed)
      if (typeof status.hostVersion === 'number') {
        setNativeHostVersion(status.hostVersion)
      }
      setNativeState(external ? 'external_running' : status.state ?? 'running')
      if (external) {
        message.info(
          t('options.ctranslate2Setup.native.externalAlreadyRunning'),
        )
        return
      }
      if (generatedAddress === normalizedActiveBaseURL && generatedAddress) {
        message.success(t('options.ctranslate2Setup.native.startedTesting'))
        onTestConnection()
      } else {
        message.success(
          t('options.ctranslate2Setup.native.startedApply', {
            url: generatedAddress || '—',
          }),
        )
      }
    } catch (error: unknown) {
      if (isNativeInstallError(error)) {
        setNativeHostAvailable(false)
        setNativeState('unavailable')
      } else {
        setNativeHostAvailable(true)
        setNativeState('error')
      }
      const messageText = nativeErrorMessage(error)
      setNativeError(
        error instanceof CTranslate2NativeHostError &&
          error.code === 'native_host_timeout'
          ? `${messageText} ${t('options.ctranslate2Setup.native.timeoutHint')}`
          : messageText,
      )
      if (
        error instanceof CTranslate2NativeHostError &&
        error.code === 'model_select_required'
      ) {
        void refreshPreparedModels()
      }
    } finally {
      setNativeBusy(false)
    }
  }, [
    flushPendingSave,
    generatedAddress,
    invalidateDiagnostic,
    normalizedActiveBaseURL,
    onTestConnection,
    refreshPreparedModels,
    selectedModel,
    settings,
    t,
  ])

  const handleNativeStop = useCallback(async () => {
    setNativeBusy(true)
    setNativeState('stopping')
    setNativeError('')
    onDiagnosticInvalidated()
    try {
      const status = await stopCTranslate2NativeServer(
        portValid
          ? { host: draft.host, port: Number(draft.port) }
          : undefined,
      )
      setNativeHostAvailable(true)
      setNativeManaged(!!status.managed)
      if (typeof status.hostVersion === 'number') {
        setNativeHostVersion(status.hostVersion)
      }
      setNativeState(status.state ?? 'stopped')
      message.success(t('options.ctranslate2Setup.native.stopped'))
    } catch (error: unknown) {
      setNativeState('error')
      setNativeError(nativeErrorMessage(error))
    } finally {
      setNativeBusy(false)
    }
  }, [draft.host, draft.port, onDiagnosticInvalidated, portValid, t])

  const nativeStartDisabled =
    !settings ||
    nativeBusy ||
    nativeHostAvailable !== true ||
    nativeState === 'checking' ||
    nativeState === 'running' ||
    nativeState === 'external_running' ||
    nativeState === 'starting' ||
    nativeState === 'stopping'
  const nativeStopDisabled =
    nativeBusy ||
    (nativeState !== 'running' && nativeState !== 'external_running')
  const nativeRefreshDisabled =
    nativeBusy ||
    nativeState === 'checking' ||
    nativeState === 'starting' ||
    nativeState === 'stopping'

  const nativeStatusText = t(
    `options.ctranslate2Setup.native.state.${nativeState}`,
  )

  const effectiveSettings = settings ?? lastValidSettingsRef.current
  const health = diagnostic?.health
  const restartDiff =
    health && effectiveSettings
      ? requestedServerDiffersFromHealth(effectiveSettings, health)
      : null
  const restartNeeded =
    !!restartDiff && (restartDiff.device || restartDiff.computeType)

  const handleApplyBaseURL = useCallback(async () => {
    if (!generatedAddress) return
    setApplyingBaseURL(true)
    try {
      const error = await onApplyBaseURL(generatedAddress)
      if (error) {
        message.error(
          t('options.ctranslate2Setup.baseUrl.applyFailed', {
            message: error,
          }),
        )
      } else {
        message.success(t('options.ctranslate2Setup.baseUrl.applied'))
      }
    } catch (error: any) {
      message.error(
        t('options.ctranslate2Setup.baseUrl.applyFailed', {
          message: error?.message || String(error),
        }),
      )
    } finally {
      setApplyingBaseURL(false)
    }
  }, [generatedAddress, onApplyBaseURL, t])

  const saveStatus = (() => {
    if (saveState.status === 'saving') {
      return t('options.ctranslate2Setup.save.saving')
    }
    if (saveState.status === 'saved') {
      return t('options.ctranslate2Setup.save.saved')
    }
    if (saveState.status === 'error') {
      return t('options.ctranslate2Setup.save.error', {
        message: saveState.message || '',
      })
    }
    return ''
  })()

  if (!loaded) return null

  return (
    <div
      className="ollama-setup"
      id="ctranslate2-setup"
      aria-labelledby="ctranslate2-setup-heading"
    >
      <div className="setup-heading-row">
        <h3 id="ctranslate2-setup-heading" tabIndex={-1}>
          {t('options.ctranslate2Setup.title')}
        </h3>
        {saveStatus && (
          <span
            className={
              saveState.status === 'error'
                ? 'save-status save-status--error'
                : saveState.status === 'saved'
                ? 'save-status save-status--ok'
                : 'save-status'
            }
            role={saveState.status === 'error' ? 'alert' : 'status'}
          >
            {saveStatus}
          </span>
        )}
      </div>
      <p className="field__hint">{t('options.ctranslate2Setup.intro')}</p>
      {loadError && (
        <Alert
          className="connection-alert"
          type="warning"
          showIcon
          message={t('options.ctranslate2Setup.loadFailed', {
            message: loadError,
          })}
        />
      )}

      <SetupField
        id="ctranslate2-prepared-model"
        label={t('options.ctranslate2Setup.models.label')}
        hint={t('options.ctranslate2Setup.models.hint')}
      >
        <div className="details-actions">
          <Select
            id="ctranslate2-prepared-model"
            value={draft.modelDirectory || undefined}
            placeholder={t('options.ctranslate2Setup.models.placeholder')}
            onChange={(value) => void handleSelectPreparedModel(value)}
            options={preparedModels
              .filter((model) => model.valid && model.model_id)
              .map((model) => ({
                value: model.directory,
                label: `${model.name} — ${model.model_id}`,
              }))}
            loading={modelsLoading}
            style={{ minWidth: 280 }}
          />
          <Button
            size="small"
            onClick={() =>
              nativeHostOutdated
                ? void refreshNativeStatus()
                : void refreshPreparedModels()
            }
            loading={modelsLoading}
          >
            {t('options.ctranslate2Setup.models.refresh')}
          </Button>
        </div>
        {nativeHostOutdated && (
          <Alert
            className="connection-alert"
            type="warning"
            showIcon
            message={t('options.ctranslate2Setup.models.hostOutdated', {
              version: String(nativeHostVersion),
              required: String(CT2_HOST_VERSION),
            })}
          />
        )}
        {modelsError && !nativeHostOutdated && (
          <p className="field__error" role="alert">
            {t('options.ctranslate2Setup.models.loadFailed', {
              message: modelsError,
            })}
          </p>
        )}
      </SetupField>

      <SetupField
        id="ctranslate2-model-directory"
        label={t('options.ctranslate2Setup.modelDirectory.label')}
        hint={t('options.ctranslate2Setup.modelDirectory.hint')}
        error={fieldError('modelDirectory')}
      >
        <Input
          id="ctranslate2-model-directory"
          value={draft.modelDirectory}
          aria-invalid={!!validation.errors.modelDirectory}
          onChange={(event) =>
            handleDraftChange({
              ...draftRef.current,
              modelDirectory: event.target.value,
            })
          }
          spellCheck={false}
        />
      </SetupField>

      <div className="form-grid">
        <SetupField
          id="ctranslate2-device"
          label={t('options.ctranslate2Setup.device.label')}
          hint={t('options.ctranslate2Setup.device.hint')}
        >
          <Select
            id="ctranslate2-device"
            value={draft.device}
            onChange={(value) => handleDeviceChange(value as CTranslate2Device)}
            options={CTRANSLATE2_DEVICES.map((device) => ({
              value: device,
              label: t(`options.ctranslate2Setup.device.${device}`),
            }))}
          />
        </SetupField>

        <SetupField
          id="ctranslate2-compute-type"
          label={t('options.ctranslate2Setup.computeType.label')}
          hint={t('options.ctranslate2Setup.computeType.hint')}
        >
          <Select
            id="ctranslate2-compute-type"
            value={draft.computeType}
            onChange={(value) =>
              handleDraftChange({
                ...draftRef.current,
                computeType: value as CTranslate2ServerSettingsDraft['computeType'],
              })
            }
            options={CTRANSLATE2_COMPUTE_TYPES.map((computeType) => ({
              value: computeType,
              label: computeType,
            }))}
          />
        </SetupField>
      </div>

      <SetupField
        id="ctranslate2-shell"
        label={t('options.ctranslate2Setup.shell.label')}
        hint={t('options.ctranslate2Setup.shell.hint')}
      >
        <Select
          id="ctranslate2-shell"
          value={draft.shell}
          onChange={(value) =>
            handleDraftChange({
              ...draftRef.current,
              shell: value as CTranslate2Shell,
            })
          }
          options={CTRANSLATE2_SHELLS.map((shell) => ({
            value: shell,
            label: t(`options.ctranslate2Setup.shell.${shell}`),
          }))}
          style={{ maxWidth: 320 }}
        />
      </SetupField>

      <Collapse
        className="details-collapse"
        defaultActiveKey={[]}
        expandIcon={collapseExpandIcon}
      >
        <Collapse.Panel
          header={t('options.ctranslate2Setup.advanced.title')}
          key="advanced"
        >
          <p className="field__hint">
            {t('options.ctranslate2Setup.advanced.hint')}
          </p>
          <div className="form-grid">
            <SetupField
              id="ctranslate2-host"
              label={t('options.ctranslate2Setup.host.label')}
            >
              <Select
                id="ctranslate2-host"
                value={draft.host}
                onChange={(value) =>
                  handleDraftChange({
                    ...draftRef.current,
                    host: value as CTranslate2ServerSettingsDraft['host'],
                  })
                }
                options={CTRANSLATE2_HOSTS.map((host) => ({
                  value: host,
                  label: host,
                }))}
              />
            </SetupField>

            <SetupField
              id="ctranslate2-port"
              label={t('options.ctranslate2Setup.port.label')}
              error={fieldError('port')}
            >
              <Input
                id="ctranslate2-port"
                value={draft.port}
                inputMode="numeric"
                aria-invalid={!!validation.errors.port}
                onChange={(event) =>
                  handleDraftChange({
                    ...draftRef.current,
                    port: event.target.value,
                  })
                }
              />
            </SetupField>

            <SetupField
              id="ctranslate2-log-level"
              label={t('options.ctranslate2Setup.logLevel.label')}
            >
              <Select
                id="ctranslate2-log-level"
                value={draft.logLevel}
                onChange={(value) =>
                  handleDraftChange({
                    ...draftRef.current,
                    logLevel:
                      value as CTranslate2ServerSettingsDraft['logLevel'],
                  })
                }
                options={CTRANSLATE2_LOG_LEVELS.map((level) => ({
                  value: level,
                  label: level,
                }))}
              />
            </SetupField>
          </div>
        </Collapse.Panel>
      </Collapse>

      <div className="details-block">
        <p className="field__label">
          {t('options.ctranslate2Setup.baseUrl.title')}
        </p>
        <HealthRow
          label={t('options.ctranslate2Setup.baseUrl.generated')}
          value={<code>{generatedAddress || '—'}</code>}
        />
        <HealthRow
          label={t('options.ctranslate2Setup.baseUrl.active')}
          value={<code>{activeBaseURL || '—'}</code>}
        />
        {addressDiffers && (
          <p className="field__hint">
            {t('options.ctranslate2Setup.baseUrl.differs')}
          </p>
        )}
        <div className="details-actions">
          <Button
            type="primary"
            onClick={() => void handleApplyBaseURL()}
            loading={applyingBaseURL}
            disabled={!settings || !generatedAddress || applyingBaseURL}
          >
            {t('options.ctranslate2Setup.baseUrl.apply')}
          </Button>
          <Button
            onClick={onTestConnection}
            loading={diagnosticTesting}
            disabled={diagnosticTesting}
          >
            {diagnosticTesting
              ? t('options.ctranslate2Setup.baseUrl.testing')
              : t('options.ctranslate2Setup.baseUrl.test')}
          </Button>
          <span className="field__hint">
            {t('options.ctranslate2Setup.baseUrl.testTarget', {
              url: activeBaseURL || '—',
            })}
          </span>
        </div>
        <p className="field__hint">
          {t('options.ctranslate2Setup.baseUrl.restartRequired')}
        </p>
      </div>

      <div className="details-block">
        <p className="field__label">
          {t('options.ctranslate2Setup.native.title')}
        </p>
        <p className="field__hint">
          {t('options.ctranslate2Setup.native.description')}
        </p>
        {nativeHostAvailable === false && (
          <div className="details-block">
            <p className="field__label">
              {t('options.ctranslate2Setup.oneClick.title')}
            </p>
            <p className="field__hint">
              {t('options.ctranslate2Setup.oneClick.description')}
            </p>
            <pre className="error-detail">{oneClickCommand || '—'}</pre>
            <div className="details-actions">
              <Button
                size="small"
                disabled={!oneClickCommand}
                onClick={() => copyText(oneClickCommand, t)}
              >
                {t('options.ctranslate2Setup.copyCommands')}
              </Button>
            </div>
            <p className="field__hint">
              {t('options.ctranslate2Setup.oneClick.restartHint')}
            </p>
            <p className="field__hint">
              <a
                href={buildOneClickInstallScriptUrl()}
                target="_blank"
                rel="noreferrer"
              >
                {t('options.ctranslate2Setup.oneClick.reviewSource')}
              </a>
            </p>
          </div>
        )}
        <div className="native-status-row">
          <span
            className={`native-state native-state--${nativeState}`}
            role="status"
          >
            {nativeStatusText}
          </span>
          {nativeState === 'running' && nativeManaged && (
            <span className="field__hint">
              {t('options.ctranslate2Setup.native.managedHint')}
            </span>
          )}
        </div>
        {nativeError && (
          <Alert
            className="connection-alert"
            type="error"
            showIcon
            message={t('options.ctranslate2Setup.native.error', {
              message: nativeError,
            })}
          />
        )}
        {nativeState === 'external_running' && (
          <p className="field__hint">
            {t('options.ctranslate2Setup.native.externalHint')}
          </p>
        )}
        <div className="details-actions">
          <Button
            type="primary"
            onClick={() => void handleNativeStart()}
            loading={nativeState === 'starting'}
            disabled={nativeStartDisabled}
          >
            {nativeState === 'starting'
              ? t('options.ctranslate2Setup.native.starting')
              : t('options.ctranslate2Setup.native.start')}
          </Button>
          <Button
            danger
            onClick={() => void handleNativeStop()}
            loading={nativeState === 'stopping'}
            disabled={nativeStopDisabled}
          >
            {nativeState === 'stopping'
              ? t('options.ctranslate2Setup.native.stopping')
              : t('options.ctranslate2Setup.native.stop')}
          </Button>
          <Button
            onClick={() => void refreshNativeStatus()}
            loading={nativeState === 'checking'}
            disabled={nativeRefreshDisabled}
          >
            {t('options.ctranslate2Setup.native.refresh')}
          </Button>
        </div>
        <p className="field__hint">
          {t('options.ctranslate2Setup.native.restartNote')}
        </p>
      </div>

      <div className="details-block">
        <p className="field__label">
          {t('options.ctranslate2Setup.health.title')}
        </p>
        {!diagnostic ? (
          <p className="field__hint">
            {t('options.ctranslate2Setup.health.neverTested')}
          </p>
        ) : (
          <>
            {diagnostic.status !== 'connected' && (
              <Alert
                className="connection-alert"
                type="warning"
                showIcon
                message={
                  diagnostic.status === 'model_mismatch'
                    ? t('options.ctranslate2Setup.health.modelMismatchTitle')
                    : t('options.ctranslate2Setup.diagnosticFailed')
                }
                description={
                  <>
                    {t(
                      `options.diagnostics.ctranslate2.hint.${diagnostic.status}`,
                    )}
                    <br />
                    <span>{diagnostic.message}</span>
                  </>
                }
              />
            )}
            <HealthRow
              label={t('options.ctranslate2Setup.health.selectedModel')}
              value={<code>{selectedModel || '—'}</code>}
            />
            <HealthRow
              label={t('options.ctranslate2Setup.health.loadedModel')}
              value={<code>{health?.model || t('options.ctranslate2Setup.health.notReported')}</code>}
            />
            <HealthRow
              label={t('options.ctranslate2Setup.health.modelDirectory')}
              value={
                health?.model_dir ? (
                  <code>{health.model_dir}</code>
                ) : health ? (
                  t('options.ctranslate2Setup.health.notReportedOldServer')
                ) : (
                  t('options.ctranslate2Setup.health.notReported')
                )
              }
            />
            <HealthRow
              label={t('options.ctranslate2Setup.health.family')}
              value={
                health?.family ||
                t('options.ctranslate2Setup.health.notReported')
              }
            />
            {health?.language_pairs?.length ? (
              <HealthRow
                label={t('options.ctranslate2Setup.health.languagePairs')}
                value={
                  <code>
                    {health.language_pairs
                      .map(([source, target]) => `${source} → ${target}`)
                      .join(', ')}
                  </code>
                }
              />
            ) : null}
            <HealthRow
              label={t('options.ctranslate2Setup.health.device')}
              value={health?.device || t('options.ctranslate2Setup.health.notReported')}
            />
            <HealthRow
              label={t('options.ctranslate2Setup.health.computeType')}
              value={
                health?.compute_type ||
                t('options.ctranslate2Setup.health.notReported')
              }
            />
            <HealthRow
              label={t('options.ctranslate2Setup.health.lastChecked')}
              value={new Date(diagnostic.checkedAt).toLocaleString()}
            />
            {restartNeeded && health && effectiveSettings && (
              <Alert
                className="connection-alert"
                type="warning"
                showIcon
                message={t('options.ctranslate2Setup.health.restartNeeded')}
                description={t(
                  'options.ctranslate2Setup.health.restartDetail',
                  {
                    requested: `${effectiveSettings.device}/${effectiveSettings.computeType}`,
                    reported: `${health.device}/${health.compute_type}`,
                  },
                )}
              />
            )}
          </>
        )}
      </div>

      <details className="details-block">
        <summary className="field__label">
          {t('options.ctranslate2Setup.oneClick.manualToggle')}
        </summary>
        {nativeHostAvailable === false && (
          <div className="details-block">
            <p className="field__label">
              {t('options.ctranslate2Setup.native.installTitle')}
            </p>
            <p className="field__hint">
              {t('options.ctranslate2Setup.native.installDescription')}
            </p>
            {extensionId !== CT2_EXTENSION_ID && (
              <>
                <HealthRow
                  label={t('options.ctranslate2Setup.native.extensionId')}
                  value={<code>{extensionId || '—'}</code>}
                />
                {!extensionIdValid ? (
                  <p className="field__error" role="alert">
                    {t('options.ctranslate2Setup.native.invalidExtensionId')}
                  </p>
                ) : (
                  <p className="field__error" role="alert">
                    {t('options.ctranslate2Setup.oneClick.extensionIdMismatch')}
                  </p>
                )}
                <div className="details-actions">
                  <Button
                    size="small"
                    disabled={!extensionIdValid}
                    onClick={() => copyText(extensionId, t)}
                  >
                    {t('options.ctranslate2Setup.native.copyExtensionId')}
                  </Button>
                </div>
              </>
            )}
            <p className="field__label">
              {t('options.ctranslate2Setup.native.installCommand')}
            </p>
            <pre className="error-detail">{nativeInstallCommand || '—'}</pre>
            <div className="details-actions">
              <Button
                size="small"
                disabled={!nativeInstallCommand}
                onClick={() => copyText(nativeInstallCommand, t)}
              >
                {t('options.ctranslate2Setup.copyCommands')}
              </Button>
            </div>
            <p className="field__hint">
              {t('options.ctranslate2Setup.native.installAfter')}
            </p>
            <p className="field__hint">
              {t('options.ctranslate2Setup.native.restartChrome')}
            </p>
          </div>
        )}

        <CommandBlock
          t={t}
          title={t('options.ctranslate2Setup.commands.installTitle')}
          description={
            <>
              {t('options.ctranslate2Setup.commands.installDescription')}
              <br />
              {t('options.ctranslate2Setup.commands.repoRoot')}
            </>
          }
          command={installCommand}
          disabled={false}
        />

        <CommandBlock
          t={t}
          title={t('options.ctranslate2Setup.commands.prepareTitle')}
          description={
            <>
              {t('options.ctranslate2Setup.commands.prepareDescription')}
              <br />
              {t('options.ctranslate2Setup.commands.prepareNoOverwrite')}
              {!modelNameValid && (
                <>
                  <br />
                  <span className="field__error" role="alert">
                    {t('options.ctranslate2Setup.validation.modelNameRequired')}
                  </span>
                </>
              )}
            </>
          }
          command={prepareCommand}
          disabled={
            !settings || !modelNameValid || !draft.modelDirectory.trim()
          }
          emptyText={t(
            draft.modelDirectory.trim()
              ? 'options.ctranslate2Setup.commands.invalidSettings'
              : 'options.ctranslate2Setup.commands.selectModelFirst',
          )}
        />

        <CommandBlock
          t={t}
          title={t('options.ctranslate2Setup.commands.startTitle')}
          description={
            <>
              {t('options.ctranslate2Setup.commands.startDescription')}
              <br />
              {t('options.ctranslate2Setup.commands.startVenv')}
            </>
          }
          command={startCommand}
          disabled={!settings || !draft.modelDirectory.trim()}
          emptyText={t(
            draft.modelDirectory.trim()
              ? 'options.ctranslate2Setup.commands.invalidSettings'
              : 'options.ctranslate2Setup.commands.selectModelFirst',
          )}
        />
      </details>

      <div className="details-actions">
        <Button
          size="small"
          onClick={() =>
            chrome.tabs.create({
              url: 'https://github.com/realyasster/translator/blob/main/docs/ctranslate2.md',
            })
          }
        >
          {t('options.ctranslate2Setup.openDocs')}
        </Button>
      </div>
      <p className="field__hint">
        {t('options.ctranslate2Setup.externalNote')}
      </p>
    </div>
  )
}

export default CTranslate2SetupCard
