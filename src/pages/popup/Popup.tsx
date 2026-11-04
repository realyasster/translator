import React, { useCallback, useEffect, useRef, useState } from 'react'
import Icon128 from '../../utils/images/icon-128.png'
import './index.scss'
import {
  Alert,
  Button,
  Collapse,
  Popconfirm,
  Popover,
  Slider,
  Switch,
} from 'antd'
import { ReloadOutlined, RightOutlined, SettingOutlined } from '@ant-design/icons'
import { useTranslation } from '../../hooks/useTranslation'
import { DetectionStatusResponse, SourceKind } from '../../types/detection'
import { DiagnosticStatus } from '../../utils/diagnostics'
import { getStoredValues, setStoredValues } from '../../utils/storage'
import {
  APPEARANCE_DEFAULTS,
  AppearanceKey,
  AppearanceValues,
  appearanceResetPayload,
  normalizeAppearance,
  normalizeProvider,
  resolveProviderSelection,
  toHexColor,
} from '../../utils/settings-utils'

type TFunction = (key: string, vars?: Record<string, string>) => string

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

/**
 * antd 4 forwards extra props to rc-slider, which supports an accessible label
 * for the handle, but its type definition omits the prop.
 */
const SliderWithAriaLabel = Slider as React.ComponentType<
  React.ComponentProps<typeof Slider> & {
    ariaLabelForHandle?: string
    ariaLabelledByForHandle?: string
    ariaValueTextFormatterForHandle?: (value: number) => string
  }
>

const collapseExpandIcon = ({ isActive }: { isActive?: boolean }) => (
  <RightOutlined rotate={isActive ? 90 : 0} aria-hidden="true" />
)

function queryOptionsTabs(pattern: string): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: pattern }, (tabs) => {
      if (chrome.runtime.lastError) resolve([])
      else resolve(tabs || [])
    })
  })
}

function activateOrNavigateTab(
  tabId: number,
  url?: string,
): Promise<boolean> {
  const properties: { url?: string; active: boolean } = url
    ? { url, active: true }
    : { active: true }
  return new Promise((resolve) => {
    chrome.tabs.update(tabId, properties, () => {
      resolve(!chrome.runtime.lastError)
    })
  })
}

const PALETTE = [
  'transparent',
  '#000000',
  '#4D4D4D',
  '#999999',
  '#FFFFFF',
  '#F44E3B',
  '#FE9200',
  '#FCDC00',
  '#DBDF00',
  '#A4DD00',
  '#68CCCA',
  '#73D8FF',
  '#AEA1FF',
  '#FDA1FF',
  '#333333',
  '#808080',
  '#cccccc',
  '#D33115',
  '#E27300',
  '#FCC400',
  '#B0BC00',
  '#68BC00',
  '#16A5A5',
  '#009CE0',
  '#7B64FF',
  '#FA28FF',
  '#666666',
  '#B3B3B3',
  '#9F0500',
  '#C45100',
  '#FB9E00',
  '#808900',
  '#194D33',
  '#0C797D',
  '#0062B1',
  '#653294',
  '#AB149E',
]

function isSameColor(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

const ColorField: React.FC<{
  id: string
  label: string
  value: string
  onChange: (color: string) => void
  t: TFunction
  disabled?: boolean
}> = ({ id, label, value, onChange, t, disabled = false }) => {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const firstSwatchRef = useRef<HTMLButtonElement | null>(null)

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    if (!next) {
      window.setTimeout(() => {
        const active = document.activeElement
        if (!active || active === document.body) {
          triggerRef.current?.focus()
        }
      }, 0)
    }
  }, [])

  const handleAfterVisibleChange = useCallback((visible: boolean) => {
    if (visible) firstSwatchRef.current?.focus()
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  const popoverContent = (
    <div
      className="color-popover"
      role="dialog"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          handleClose()
        }
      }}
    >
      <div className="color-grid" role="group" aria-label={label}>
        {PALETTE.map((color, index) => {
          const isTransparent = color === 'transparent'
          return (
            <button
              key={color}
              ref={index === 0 ? firstSwatchRef : undefined}
              type="button"
              className={
                isTransparent
                  ? 'color-swatch-button color-swatch-button--transparent'
                  : 'color-swatch-button'
              }
              style={
                isTransparent ? undefined : { backgroundColor: color }
              }
              aria-label={
                isTransparent ? t('popup.color.transparent') : color
              }
              aria-pressed={isSameColor(value, color)}
              onClick={() => {
                onChange(color)
                handleClose()
              }}
            />
          )
        })}
      </div>
      <label className="custom-color-row" htmlFor={`${id}-custom`}>
        <span>{t('popup.color.custom')}</span>
        <input
          id={`${id}-custom`}
          type="color"
          value={toHexColor(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </div>
  )

  return (
    <div className="control-field">
      <div className="control-field__head">
        <label className="control-field__label" htmlFor={id}>
          {label}
        </label>
      </div>
      <Popover
        content={popoverContent}
        trigger="click"
        placement="bottomLeft"
        visible={open}
        onVisibleChange={handleOpenChange}
        afterVisibleChange={handleAfterVisibleChange}
      >
        <button
          ref={triggerRef}
          id={id}
          type="button"
          className="color-button"
          disabled={disabled}
          style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${label}: ${
            isSameColor(value, 'transparent')
              ? t('popup.color.transparent')
              : value
          }`}
        >
          <span
            className={
              isSameColor(value, 'transparent')
                ? 'color-button__swatch color-button__swatch--transparent'
                : 'color-button__swatch'
            }
            style={
              isSameColor(value, 'transparent')
                ? undefined
                : { backgroundColor: value }
            }
            aria-hidden="true"
          />
          <span>{t('popup.color.choose')}</span>
        </button>
      </Popover>
    </div>
  )
}

const SliderField: React.FC<{
  id: string
  label: string
  value: number
  valueText: string
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  onCommit: (value: number) => void
  disabled?: boolean
}> = ({
  id,
  label,
  value,
  valueText,
  min,
  max,
  step,
  onChange,
  onCommit,
  disabled = false,
}) => (
  <div className="control-field">
    <div className="control-field__head">
      <span className="control-field__label" id={`${id}-label`}>
        {label}
      </span>
      <span className="control-field__value">{valueText}</span>
    </div>
    <SliderWithAriaLabel
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(next) => onChange(Number(next))}
      onAfterChange={(next) => onCommit(Number(next))}
      ariaLabelledByForHandle={`${id}-label`}
      ariaValueTextFormatterForHandle={() => valueText}
    />
  </div>
)

const Popup = () => {
  const { lang, t } = useTranslation()
  const [status, setStatus] = useState(false)
  const [detection, setDetection] = useState<DetectionStatusResponse | null>(null)
  const [appearance, setAppearance] = useState<AppearanceValues>(
    APPEARANCE_DEFAULTS,
  )
  const [diagStatus, setDiagStatus] = useState<DiagnosticStatus | null>(null)
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const savedAppearanceRef = useRef<AppearanceValues>(appearance)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  useEffect(() => {
    let mounted = true
    getStoredValues<Record<string, any>>(null)
      .then((data) => {
        if (!mounted) return
        setStatus(data?.status === true)
        const normalizedAppearance = normalizeAppearance(data)
        setAppearance(normalizedAppearance)
        savedAppearanceRef.current = normalizedAppearance
        const currentProvider = resolveProviderSelection(
          data?.selectedProvider,
          data?.selectedModel,
        )
        const storedDiagnostic = data?.lastDiagnostic
        const diagnosticProvider = normalizeProvider(storedDiagnostic?.provider)
        const storedStatus = storedDiagnostic?.status
        if (
          diagnosticProvider === currentProvider &&
          typeof storedStatus === 'string' &&
          DIAGNOSTIC_STATUSES.includes(storedStatus as DiagnosticStatus)
        ) {
          setDiagStatus(storedStatus as DiagnosticStatus)
        }
      })
      .catch((error: any) => {
        if (mounted) {
          setLoadError(error?.message || String(error))
        }
      })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!status) {
      setDetection(null)
      return
    }
    let mounted = true
    const load = () => {
      try {
        chrome.runtime.sendMessage(
          { type: 'GET_DETECTION_STATUS' },
          (response: DetectionStatusResponse | undefined) => {
            if (!mounted) return
            if (chrome.runtime.lastError) return
            if (response?.type === 'DETECTION_STATUS') setDetection(response)
          },
        )
      } catch {
        // Eklenti bağlamı yenilenmiş olabilir.
      }
    }
    load()
    const timer = window.setInterval(load, 1000)
    return () => {
      mounted = false
      window.clearInterval(timer)
    }
  }, [status])


  const persist = useCallback(
    async (values: Record<string, unknown>): Promise<boolean> => {
      const keys = Object.keys(values)
      try {
        await setStoredValues(values)
        setSaveErrors((previous) => {
          if (!keys.some((key) => key in previous)) return previous
          const next = { ...previous }
          keys.forEach((key) => {
            delete next[key]
          })
          return next
        })
        return true
      } catch (error: any) {
        const message = error?.message || String(error)
        setSaveErrors((previous) => {
          const next = { ...previous }
          keys.forEach((key) => {
            next[key] = message
          })
          return next
        })
        return false
      }
    },
    [],
  )

  const openSettings = useCallback(async (hash?: string) => {
    const optionsUrl = chrome.runtime.getURL('options.html')
    const targetUrl = `${optionsUrl}${hash ? `#${hash}` : ''}`
    try {
      const tabs = await queryOptionsTabs(`${optionsUrl}*`)
      const existing = tabs.find((tab) => typeof tab.id === 'number')
      if (existing?.id !== undefined) {
        const alreadyAtTarget = existing.url === targetUrl
        const updated = await activateOrNavigateTab(
          existing.id,
          alreadyAtTarget ? undefined : targetUrl,
        )
        if (updated) return
      }
    } catch {
      // Fall back to opening a new options tab.
    }
    chrome.tabs.create({ url: targetUrl }, () => {
      // Reading lastError avoids an unchecked-runtime warning.
      void chrome.runtime.lastError
    })
  }, [])

  const handleStatusChange = useCallback(
    async (checked: boolean) => {
      const previous = status
      setStatus(checked)
      const saved = await persist({ status: checked })
      if (!saved) setStatus(previous)
    },
    [persist, status],
  )

  const previewAppearance = useCallback(
    <K extends AppearanceKey>(key: K, value: AppearanceValues[K]) => {
      setAppearance((previous) => ({ ...previous, [key]: value }))
    },
    [],
  )

  const commitAppearance = useCallback(
    async <K extends AppearanceKey>(
      key: K,
      value: AppearanceValues[K],
    ): Promise<void> => {
      const previous = savedAppearanceRef.current[key]
      const saved = await persist({ [key]: value })
      if (!saved) {
        setAppearance((current) => ({ ...current, [key]: previous }))
        return
      }
      savedAppearanceRef.current = {
        ...savedAppearanceRef.current,
        [key]: value,
      }
    },
    [persist],
  )

  const showOriginalSubtitle = appearance.showOriginalSubtitle !== false

  const handleShowOriginalChange = useCallback(
    (checked: boolean) => {
      previewAppearance('showOriginalSubtitle', checked)
      void commitAppearance('showOriginalSubtitle', checked)
    },
    [previewAppearance, commitAppearance],
  )

  const resetAppearance = useCallback(async () => {
    const previous = savedAppearanceRef.current
    const payload = appearanceResetPayload()
    setAppearance(payload)
    const saved = await persist({ ...payload })
    if (saved) savedAppearanceRef.current = payload
    else setAppearance(previous)
  }, [persist])

  const detectionPhase = detection?.enabled
    ? detection.status?.phase || 'searching'
    : 'disabled'
  const detectionSource: SourceKind | undefined =
    detection?.status?.sourceKind || detection?.status?.source?.kind

  const statusLabel = diagStatus
    ? t(`options.diagnostics.status.${diagStatus}`)
    : t('popup.status.never')
  const saveErrorMessage = Object.values(saveErrors)[0]

  const weightText = (weight: number) =>
    weight === 400
      ? `${weight} (${t('popup.weight.normal')})`
      : weight === 700
      ? `${weight} (${t('popup.weight.bold')})`
      : String(weight)

  return (
    <div className="PopupContainer">
      <header className="popup-header">
        <div className="popup-brand">
          <img src={Icon128} alt="" width={24} height={24} />
          <h1>{t('popup.brand')}</h1>
        </div>
        <div className="popup-header__actions">
          <button
            type="button"
            className={`connection-button connection-button--${
              diagStatus ?? 'never'
            }`}
            onClick={() => openSettings('connection')}
            title={t('popup.status.tooltip')}
            aria-label={`${statusLabel}. ${t('popup.status.tooltip')}`}
          >
            <span className="connection-dot" aria-hidden="true" />
            <span>{statusLabel}</span>
          </button>
          <Button
            type="text"
            className="settings-button"
            icon={<SettingOutlined />}
            aria-label={t('popup.openSettings')}
            title={t('popup.openSettings')}
            onClick={() => openSettings()}
          />
        </div>
      </header>

      <main className="popup-main">
        {loadError && (
          <Alert
            type="error"
            showIcon
            message={t('popup.loadError', { message: loadError })}
          />
        )}

        <section
          className="primary-control"
          aria-labelledby="translation-enabled-label"
        >
          <div>
            <label
              className="primary-control__label"
              htmlFor="translation-enabled"
              id="translation-enabled-label"
            >
              {t('popup.translationEnabled')}
            </label>
            <p className="field__hint">
              {t('popup.translationEnabledHint')}
            </p>
          </div>
          <Switch
            id="translation-enabled"
            checked={status}
            onChange={handleStatusChange}
            checkedChildren={t('popup.switch.on')}
            unCheckedChildren={t('popup.switch.off')}
          />
        </section>

        <section
          className="primary-control"
          aria-labelledby="show-original-label"
        >
          <div>
            <label
              className="primary-control__label"
              htmlFor="show-original"
              id="show-original-label"
            >
              {t('popup.label.showOriginal')}
            </label>
            <p className="field__hint">
              {t('popup.hint.showOriginal')}
            </p>
          </div>
          <Switch
            id="show-original"
            checked={showOriginalSubtitle}
            onChange={handleShowOriginalChange}
            checkedChildren={t('popup.switch.on')}
            unCheckedChildren={t('popup.switch.off')}
          />
        </section>

      {detection && (
        <div
          style={{
            margin: '8px 12px 0 12px',
            padding: '8px 10px',
            borderRadius: '6px',
            backgroundColor: '#fafafa',
            border: '1px solid #f0f0f0',
            fontSize: '12px',
            color: '#595959',
            lineHeight: '1.5',
          }}
        >
          <div style={{ fontWeight: 'bold', color: '#262626' }}>
            {t('popup.detection.title')}
          </div>
          <div>
            <span
              style={{
                color:
                  detectionPhase === 'connected'
                    ? '#389e0d'
                    : detectionPhase === 'unavailable'
                      ? '#cf1322'
                      : '#ad6800',
                fontWeight: 'bold',
              }}
            >
              ● {t(`detection.phase.${detectionPhase}`)}
            </span>
          </div>
          {detectionSource && (
            <div style={{ color: '#8c8c8c' }}>
              {t('popup.detection.source')}: {t(`detection.source.${detectionSource}`)}
            </div>
          )}
        </div>
      )}

        <section className="appearance" aria-labelledby="appearance-title">
          <h2 id="appearance-title">{t('popup.appearance.title')}</h2>
          <Collapse
            ghost
            className="appearance-collapse"
            defaultActiveKey={[]}
            expandIcon={collapseExpandIcon}
          >
            <Collapse.Panel
              header={t('popup.group.background')}
              key="background"
            >
              <ColorField
                id="background-color"
                label={t('popup.label.bgColor')}
                value={appearance.backgroundColor}
                onChange={(color) => {
                  previewAppearance('backgroundColor', color)
                  void commitAppearance('backgroundColor', color)
                }}
                t={t}
              />
              <SliderField
                id="background-opacity"
                label={t('popup.label.bgOpacity')}
                value={appearance.backgroundOpacity}
                valueText={t('popup.value.percent', {
                  value: String(
                    Math.round(appearance.backgroundOpacity * 100),
                  ),
                })}
                min={0}
                max={1}
                step={0.05}
                onChange={(value) =>
                  previewAppearance('backgroundOpacity', value)
                }
                onCommit={(value) =>
                  void commitAppearance('backgroundOpacity', value)
                }
              />
            </Collapse.Panel>

            <Collapse.Panel
              header={t('popup.group.original')}
              key="original"
            >
              <SliderField
                id="origin-size"
                label={t('popup.label.originSize')}
                disabled={!showOriginalSubtitle}
                value={appearance.originFontSize}
                valueText={t('popup.value.px', {
                  value: String(appearance.originFontSize),
                })}
                min={12}
                max={72}
                step={1}
                onChange={(value) =>
                  previewAppearance('originFontSize', value)
                }
                onCommit={(value) =>
                  void commitAppearance('originFontSize', value)
                }
              />
              <ColorField
                id="origin-color"
                label={t('popup.label.originColor')}
                disabled={!showOriginalSubtitle}
                value={appearance.originFontColor}
                onChange={(color) => {
                  previewAppearance('originFontColor', color)
                  void commitAppearance('originFontColor', color)
                }}
                t={t}
              />
              <SliderField
                id="origin-weight"
                label={t('popup.label.originWeight')}
                disabled={!showOriginalSubtitle}
                value={appearance.originFontWeight}
                valueText={weightText(appearance.originFontWeight)}
                min={100}
                max={900}
                step={100}
                onChange={(value) =>
                  previewAppearance('originFontWeight', value)
                }
                onCommit={(value) =>
                  void commitAppearance('originFontWeight', value)
                }
              />
            </Collapse.Panel>

            <Collapse.Panel
              header={t('popup.group.translation')}
              key="translation"
            >
              <SliderField
                id="translated-size"
                label={t('popup.label.translatedSize')}
                value={appearance.translatedFontSize}
                valueText={t('popup.value.px', {
                  value: String(appearance.translatedFontSize),
                })}
                min={12}
                max={72}
                step={1}
                onChange={(value) =>
                  previewAppearance('translatedFontSize', value)
                }
                onCommit={(value) =>
                  void commitAppearance('translatedFontSize', value)
                }
              />
              <ColorField
                id="translated-color"
                label={t('popup.label.translatedColor')}
                value={appearance.translatedFontColor}
                onChange={(color) => {
                  previewAppearance('translatedFontColor', color)
                  void commitAppearance('translatedFontColor', color)
                }}
                t={t}
              />
              <SliderField
                id="translated-weight"
                label={t('popup.label.translatedWeight')}
                value={appearance.translatedFontWeight}
                valueText={weightText(appearance.translatedFontWeight)}
                min={100}
                max={900}
                step={100}
                onChange={(value) =>
                  previewAppearance('translatedFontWeight', value)
                }
                onCommit={(value) =>
                  void commitAppearance('translatedFontWeight', value)
                }
              />
            </Collapse.Panel>
          </Collapse>
        </section>
      </main>

      <footer className="popup-footer">
        <div className="popup-footer__status">
          <p className="autosave-note">{t('popup.autosave')}</p>
          {saveErrorMessage && (
            <p className="save-error" role="alert">
              {t('popup.saveError', { message: saveErrorMessage })}
            </p>
          )}
        </div>
        <Popconfirm
          title={t('popup.reset.confirm')}
          okText={t('popup.reset.ok')}
          cancelText={t('popup.reset.cancel')}
          onConfirm={() => void resetAppearance()}
        >
          <Button type="text" icon={<ReloadOutlined />}>
            {t('popup.reset.button')}
          </Button>
        </Popconfirm>
      </footer>
    </div>
  )
}

export default Popup
