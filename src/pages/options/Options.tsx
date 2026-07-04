import React, { useEffect, useState, useCallback } from 'react'
import './index.scss'
import { Card, message, Input, Button, Tooltip } from 'antd'
import { GithubFilled, InfoCircleOutlined } from '@ant-design/icons'
import { useTranslation } from '../../hooks/useTranslation'
import { SUPPORTED_LANGS, Lang, ProviderPreset } from '../../utils/i18n'
import {
  detectOllama,
  pullOllamaModel,
  OllamaDetectResult,
  OllamaModel,
} from '../../utils/ollama'
import { SITE_PRESETS } from '../../utils/site-presets'
import {
  scanSubtitleElements,
  SubtitleCandidate,
} from '../../utils/subtitle-scanner'
import { runDiagnostic, DiagnosticResult } from '../../utils/diagnostics'

interface DomConfig {
  domain: string
  selector: string
  selectors?: string[]
}

interface ModelConfig {
  apiKey: string
  baseURL: string
  modelName: string
  targetLanguage?: string
}

type ProviderType = 'openai-compatible' | 'ollama' | 'google-translate'

const PROVIDER_PRESETS: Record<ProviderType, ProviderPreset> = {
  'openai-compatible': {
    name: 'OpenAI-Compatible API',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    requiresApiKey: true,
    descriptionKey: 'options.providerDesc.openaiCompatible',
    examples: [
      {
        name: 'OpenAI',
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        description: 'Official OpenAI API',
      },
      {
        name: 'GLM (智谱 AI) 🎁',
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
        model: 'glm-4-flash',
        description:
          'Free model glm-4-flash, supports Claude Code, Cline, and 10+ coding tools',
        signupUrl: 'https://www.bigmodel.cn/claude-code?ic=HTKMARY5TE',
        promoText:
          '🚀 GLM Coding plan: Claude Code, Cline and 10+ coding tools supported. Limited-time offer!',
      },
      {
        name: 'DeepSeek',
        baseURL: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        description: 'DeepSeek AI API',
      },
    ],
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
}

const setItem = async (key: string, value: any): Promise<void> => {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError)
      } else {
        resolve()
      }
    })
  })
}

const getItem = async (key: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key], (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError)
      } else {
        resolve(result[key])
      }
    })
  })
}

message.config({
  top: 50,
  duration: 2,
  maxCount: 1,
})

const Options: React.FC = () => {
  const { lang, setLang, t } = useTranslation()
  const [prompt, setPrompt] = useState<string>(
    `Translate the following English text into Chinese and separate the translations with @@@`,
  )
  const [domConfigs, setDomConfigs] = useState<DomConfig[]>([
    { domain: '', selector: '' },
  ])
  const [selectedProvider, setSelectedProvider] =
    useState<ProviderType>('openai-compatible')
  const [providerConfig, setProviderConfig] = useState<ModelConfig>({
    apiKey: '',
    baseURL: PROVIDER_PRESETS['openai-compatible'].baseURL,
    modelName: PROVIDER_PRESETS['openai-compatible'].defaultModel,
  })
  const [testing, setTesting] = useState<boolean>(false)
  const [enableStreaming, setEnableStreamingState] = useState<boolean>(true)
  const setEnableStreaming = useCallback((val: boolean) => {
    setEnableStreamingState(val)
    setItem('enableStreaming', val).catch(console.error)
  }, [])
  const [testResult, setTestResult] = useState<{
    success: boolean
    message: string
  } | null>(null)

  useEffect(() => {
    const init = async () => {
      const [
        storedPrompt,
        storedDomConfigs,
        storedSelectedProvider,
        storedProviderConfig,
        storedSelectedModel,
        storedOpenaiConfig,
        storedOllamaConfig,
        storedEnableStreaming,
      ] = await Promise.all([
        getItem('prompt'),
        getItem('domConfigs'),
        getItem('selectedProvider'),
        getItem('providerConfig'),
        getItem('selectedModel'),
        getItem('openaiConfig'),
        getItem('ollamaConfig'),
        getItem('enableStreaming'),
      ])

      if (storedPrompt) setPrompt(storedPrompt)
      if (storedEnableStreaming !== undefined) {
        setEnableStreaming(storedEnableStreaming)
      } else {
        setEnableStreaming(true)
      }
      if (storedDomConfigs) setDomConfigs(storedDomConfigs)

      if (storedSelectedProvider) {
        if (
          storedSelectedProvider === 'openai' ||
          storedSelectedProvider === 'zhipu'
        ) {
          setSelectedProvider('openai-compatible')
          await setItem('selectedProvider', 'openai-compatible')
        } else {
          setSelectedProvider(storedSelectedProvider)
        }
      } else if (storedSelectedModel) {
        if (
          storedSelectedModel === 'openai' ||
          storedSelectedModel === 'zhipu'
        ) {
          setSelectedProvider('openai-compatible')
          await setItem('selectedProvider', 'openai-compatible')
        } else {
          setSelectedProvider(storedSelectedModel as ProviderType)
          await setItem('selectedProvider', storedSelectedModel)
        }
      }

      if (storedProviderConfig) {
        setProviderConfig(storedProviderConfig)
      } else {
        if (storedSelectedModel === 'openai' && storedOpenaiConfig) {
          setProviderConfig(storedOpenaiConfig)
          await setItem('providerConfig', storedOpenaiConfig)
        } else if (storedSelectedModel === 'zhipu' && storedOpenaiConfig) {
          setProviderConfig(storedOpenaiConfig)
          await setItem('providerConfig', storedOpenaiConfig)
        } else if (storedSelectedModel === 'ollama' && storedOllamaConfig) {
          setProviderConfig(storedOllamaConfig)
          await setItem('providerConfig', storedOllamaConfig)
        }
      }
    }
    init()
  }, [])

  const [testingIndex, setTestingIndex] = useState<number | null>(null)

  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = SITE_PRESETS.find((p) => p.id === presetId)
      if (!preset) return
      setDomConfigs((prev) => {
        const replaced = [
          ...prev.filter((c) => c.domain && c.domain !== preset.domain),
          { domain: preset.domain, selector: preset.selector, selectors: preset.selectors },
        ]
        setItem('domConfigs', replaced).catch(console.error)
        return replaced
      })
    },
    [],
  )

  const handleTestSelector = useCallback(
    async (index: number) => {
      const cfg = domConfigs[index]
      if (!cfg?.domain) {
        message.warning(t('options.domConfig.domainPlaceholder'))
        return
      }
      setTestingIndex(index)
      try {
        let targetOrigin: string | null = null
        try {
          targetOrigin = new URL(cfg.domain).origin
        } catch {
          targetOrigin = cfg.domain
        }

        const allTabs = await chrome.tabs.query({})
        const matching = allTabs.find((tb) => {
          if (!tb.url || !tb.id) return false
          if (
            tb.url.startsWith('chrome://') ||
            tb.url.startsWith('chrome-extension://') ||
            tb.url.startsWith('edge://') ||
            tb.url.startsWith('about:') ||
            tb.url.startsWith('moz-extension://')
          )
            return false
          try {
            return new URL(tb.url).origin === targetOrigin
          } catch {
            return false
          }
        })

        let tab = matching
        if (!tab) {
          const [active] = await chrome.tabs.query({
            active: true,
            lastFocusedWindow: true,
          })
          if (active?.url && active.id) {
            const restricted =
              active.url.startsWith('chrome://') ||
              active.url.startsWith('chrome-extension://') ||
              active.url.startsWith('edge://') ||
              active.url.startsWith('about:') ||
              active.url.startsWith('moz-extension://')
            if (!restricted) {
              tab = active
            }
          }
        }

        if (!tab?.id || !tab.url) {
          message.warning(t('options.domConfig.testNoTabOpen', { domain: targetOrigin || cfg.domain }))
          return
        }

        const url = tab.url
        const restricted =
          url.startsWith('chrome://') ||
          url.startsWith('chrome-extension://') ||
          url.startsWith('edge://') ||
          url.startsWith('about:') ||
          url.startsWith('moz-extension://')
        if (restricted) {
          message.warning(t('options.domConfig.testRestricted', { url }))
          return
        }

        const candidates = [cfg.selector, ...(cfg.selectors || [])].filter(Boolean)
        let results
        try {
          results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (sels: string[]) => {
              const out: { selector: string; count: number; preview: string[] }[] = []
              for (const sel of sels) {
                try {
                  const els = Array.from(document.querySelectorAll(sel))
                  out.push({
                    selector: sel,
                    count: els.length,
                    preview: els
                      .slice(0, 3)
                      .map((e) => (e.textContent || '').trim().slice(0, 60))
                      .filter(Boolean),
                  })
                } catch {
                  out.push({ selector: sel, count: -1, preview: [] })
                }
              }
              return out
            },
            args: [candidates],
          })
        } catch (scriptErr: any) {
          const msg = scriptErr?.message || String(scriptErr)
          if (
            msg.toLowerCase().includes('permission') ||
            msg.toLowerCase().includes('cannot access')
          ) {
            message.error(t('options.domConfig.testNoPermission', { url }))
          } else {
            message.error(msg)
          }
          return
        }

        const r = results?.[0]?.result as
          | { selector: string; count: number; preview: string[] }[]
          | undefined
        if (!r) {
          message.error('Test failed')
          return
        }
        const summary = r
          .filter((x) => x.count > 0)
          .map(
            (x) =>
              `${x.selector} → ${x.count} elem · ${x.preview[0]?.slice(0, 40) || '(empty)'}`,
          )
          .join(' | ')
        const hit = r.find((x) => x.count > 0)
        if (hit) {
          message.success(
            t('options.domConfig.testResult', { count: String(hit.count) }) +
              ` (${hit.selector})` +
              (hit.preview.length ? ` — "${hit.preview[0]}"` : ''),
            6,
          )
          console.log('[Test Selector] All candidates:', summary)
          if (tab.id) {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: (sel: string) => {
                document
                  .querySelectorAll(sel)
                  .forEach((e) => {
                    ;(e as HTMLElement).style.outline = '3px solid #ff4d4f'
                    ;(e as HTMLElement).style.outlineOffset = '2px'
                  })
                setTimeout(() => {
                  document
                    .querySelectorAll(sel)
                    .forEach((e) => {
                      ;(e as HTMLElement).style.outline = ''
                      ;(e as HTMLElement).style.outlineOffset = ''
                    })
                }, 3000)
              },
              args: [hit.selector],
            })
          }
        } else {
          message.warning(t('options.domConfig.testNone'))
        }
      } catch (e: any) {
        message.error(e?.message || String(e))
      } finally {
        setTestingIndex(null)
      }
    },
    [domConfigs, t],
  )

  const [autoScanning, setAutoScanning] = useState(false)
  const [autoCandidates, setAutoCandidates] = useState<SubtitleCandidate[]>([])

  const handleAutoDetect = useCallback(async () => {
    setAutoScanning(true)
    setAutoCandidates([])
    try {
      const tabs = await chrome.tabs.query({})
      let tab = tabs.find((tb) => {
        if (!tb.url || !tb.id) return false
        if (
          tb.url.startsWith('chrome://') ||
          tb.url.startsWith('chrome-extension://') ||
          tb.url.startsWith('about:') ||
          tb.url.startsWith('edge://')
        )
          return false
        return tb.url.startsWith('http')
      })
      if (!tab) {
        const [active] = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        })
        tab = active
      }
      if (!tab?.id) {
        message.warning(t('options.domConfig.testNoTab'))
        return
      }
      const url = tab.url || ''
      if (
        url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('about:')
      ) {
        message.warning(t('options.domConfig.testRestricted', { url }))
        return
      }

      let result: {
        candidates: SubtitleCandidate[]
        best: SubtitleCandidate | null
        totalScanned: number
        framesScanned: number
      }
      try {
        const execResults = await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          func: scanSubtitleElements,
        })
        const merged: {
          candidates: SubtitleCandidate[]
          best: SubtitleCandidate | null
          totalScanned: number
          framesScanned: number
        } = {
          candidates: [],
          best: null,
          totalScanned: 0,
          framesScanned: 0,
        }
        for (const r of execResults || []) {
          const res = r?.result as
            | {
                candidates: SubtitleCandidate[]
                best: SubtitleCandidate | null
                totalScanned: number
                framesScanned: number
              }
            | undefined
          if (!res) continue
          merged.candidates.push(...res.candidates)
          merged.totalScanned += res.totalScanned || 0
          merged.framesScanned += res.framesScanned || 0
        }
        merged.candidates.sort((a, b) => b.score - a.score)
        merged.candidates = merged.candidates.slice(0, 15)
        merged.best = merged.candidates[0] ?? null
        result = merged
      } catch (scriptErr: any) {
        const msg = scriptErr?.message || String(scriptErr)
        if (msg.toLowerCase().includes('permission')) {
          message.error(t('options.domConfig.testNoPermission', { url }))
        } else {
          message.error(msg)
        }
        return
      }

      setAutoCandidates(result.candidates)
      console.log(
        '[Auto-detect] scanned',
        result.totalScanned,
        'elements across',
        result.framesScanned,
        'frame(s), found',
        result.candidates.length,
        'candidates',
      )

      if (!result.best) {
        message.warning(
          `${t('options.domConfig.autoNone')} (scanned ${result.totalScanned} elements / ${result.framesScanned} frame(s))`,
          6,
        )
        return
      }

      try {
        const u = new URL(url)
        const origin = u.origin
        const cleanSelector = (result.best!.selector || '').replace(/^iframe\s*>>>\s*/, '')
        setDomConfigs((prev) => {
          const replaced = [
            ...prev.filter((c) => c.domain && c.domain !== origin),
            { domain: origin, selector: cleanSelector },
          ]
          setItem('domConfigs', replaced).catch(console.error)
          return replaced
        })
      } catch {
        // ignore
      }

      message.success(
        t('options.domConfig.autoFound', {
          count: String(result.candidates.length),
        }),
        4,
      )
    } catch (e: any) {
      message.error(e?.message || String(e))
    } finally {
      setAutoScanning(false)
    }
  }, [t])

  const handleAddConfig = useCallback(() => {
    setDomConfigs((prevConfigs) => [
      ...prevConfigs,
      { domain: '', selector: '' },
    ])
  }, [])

  const handleRemoveConfig = useCallback((index: number) => {
    setDomConfigs((prevConfigs) => {
      const newConfigs = prevConfigs.filter((_, i) => i !== index)
      setItem('domConfigs', newConfigs).catch(console.error)
      return newConfigs
    })
  }, [])

  const handleConfigChange = useCallback(
    (index: number, field: keyof DomConfig, value: string) => {
      setDomConfigs((prevConfigs) => {
        const newConfigs = prevConfigs.map((config, i) =>
          i === index ? { ...config, [field]: value } : config,
        )
        setItem('domConfigs', newConfigs).catch(console.error)
        return newConfigs
      })
    },
    [],
  )

  const [promptDraft, setPromptDraft] = useState<string>('')
  const [sourceLang, setSourceLang] = useState<string>('English')
  const [targetLang, setTargetLang] = useState<string>('English')
  const [promptSaved, setPromptSaved] = useState<boolean>(true)

  useEffect(() => {
    setPromptDraft(prompt)
    setPromptSaved(true)
  }, [prompt])

  const handlePromptDraftChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setPromptDraft(e.target.value)
      setPromptSaved(false)
    },
    [],
  )

  const handlePromptSave = useCallback(() => {
    setPrompt(promptDraft)
    setItem('prompt', promptDraft).catch(console.error)
    setPromptSaved(true)
    message.success('Prompt saved')
  }, [promptDraft])

  const handlePromptReset = useCallback(() => {
    const defaultPrompt = `Translate the following <English> text into <Chinese> and separate the translations with @@@`
    setPromptDraft(defaultPrompt)
    setPromptSaved(false)
  }, [])

  const buildPromptFromLanguages = useCallback((src: string, tgt: string) => {
    return `Translate the following <${src}> text into <${tgt}> and separate the translations with @@@`
  }, [])

  const handleSourceLangChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newSrc = e.target.value
      setSourceLang(newSrc)
      const newPrompt = buildPromptFromLanguages(newSrc, targetLang)
      setPromptDraft(newPrompt)
      setPromptSaved(false)
    },
    [targetLang, buildPromptFromLanguages],
  )

  const handleTargetLangChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newTgt = e.target.value
      setTargetLang(newTgt)
      const newPrompt = buildPromptFromLanguages(sourceLang, newTgt)
      setPromptDraft(newPrompt)
      setPromptSaved(false)
    },
    [sourceLang, buildPromptFromLanguages],
  )

  const handleProviderChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newProvider = e.target.value as ProviderType
      setSelectedProvider(newProvider)
      setItem('selectedProvider', newProvider)

      const preset = PROVIDER_PRESETS[newProvider]
      const newConfig: ModelConfig = {
        apiKey: providerConfig.apiKey,
        baseURL: preset.baseURL,
        modelName: preset.defaultModel,
      }
      setProviderConfig(newConfig)
      setItem('providerConfig', newConfig)
    },
    [providerConfig.apiKey],
  )

  const handleConfigUpdate = useCallback(
    (field: keyof ModelConfig, value: string) => {
      setProviderConfig((prev) => {
        const newConfig = { ...prev, [field]: value }
        setItem('providerConfig', newConfig)
        return newConfig
      })
    },
    [],
  )

  const handleLanguageChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setLang(e.target.value as Lang)
    },
    [setLang],
  )

  const testProviderConfig = useCallback(async () => {
    setTesting(true)
    setTestResult(null)

    try {
      const preset = PROVIDER_PRESETS[selectedProvider]
      console.log(`🧪 Testing ${preset.name}:`, {
        provider: selectedProvider,
        baseURL: providerConfig.baseURL,
        modelName: providerConfig.modelName,
        hasApiKey: !!providerConfig.apiKey,
      })

      if (selectedProvider === 'ollama') {
        const healthUrl = providerConfig.baseURL.replace('/v1', '') + '/health'
        console.log('🏥 Ollama health:', healthUrl)

        const healthResponse = await fetch(healthUrl, { method: 'GET' })
        console.log(
          '📥 Health response:',
          healthResponse.status,
          healthResponse.statusText,
        )

        if (!healthResponse.ok) {
          setTestResult({
            success: false,
            message: t('options.test.ollama.unavailable', {
              status: String(healthResponse.status),
            }),
          })
          return
        }
        console.log('✅ Ollama health OK')
      }

      const requestBody = {
        model: providerConfig.modelName,
        messages: [
          {
            role: 'system',
            content:
              'Translate the following English text into Chinese and separate the translations with @@@',
          },
          {
            role: 'user',
            content: 'Hello, how are you?',
          },
        ],
        temperature: 0.3,
        max_tokens: 100,
        stream: false,
      }

      console.log('📤 Sending test request:', requestBody)

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (preset.requiresApiKey && providerConfig.apiKey) {
        headers['Authorization'] = `Bearer ${providerConfig.apiKey}`
      }

      const response = await fetch(
        `${providerConfig.baseURL}/chat/completions`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
        },
      )

      console.log('📥 Response:', response.status, response.statusText)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('❌ API error:', errorText)

        let errorMessage = `HTTP ${response.status}: ${response.statusText}`

        try {
          const errorData = JSON.parse(errorText)
          if (errorData.error?.message) {
            errorMessage = errorData.error.message
          } else if (errorData.error) {
            errorMessage =
              typeof errorData.error === 'string'
                ? errorData.error
                : JSON.stringify(errorData.error)
          }
        } catch (e) {
          errorMessage = errorText || errorMessage
        }

        if (selectedProvider === 'ollama' && response.status === 404) {
          errorMessage = t('options.test.ollama.modelNotFound', {
            model: providerConfig.modelName,
          })
        }

        setTestResult({
          success: false,
          message: t('options.test.requestFailed', { message: errorMessage }),
        })
        return
      }

      const data = await response.json()
      console.log('✅ API response:', data)

      if (data.choices && data.choices[0] && data.choices[0].message) {
        const translatedText = data.choices[0].message.content
        setTestResult({
          success: true,
          message: `✅ ${preset.name} ${t('options.test.successTitle')}!\nOriginal: "Hello, how are you?"\nTranslated: "${translatedText}"`,
        })
      } else {
        console.error('❌ Bad response format:', data)
        setTestResult({
          success: false,
          message: t('options.test.formatError'),
        })
      }
    } catch (error: any) {
      console.error('❌ Test exception:', error)

      let errorMessage = error.message || 'Unknown error'

      if (error.message.includes('Failed to fetch')) {
        if (selectedProvider === 'ollama') {
          errorMessage = t('options.test.connectionFailed.ollama', {
            url: providerConfig.baseURL,
          })
        } else {
          errorMessage = t('options.test.connectionFailed.generic', {
            url: providerConfig.baseURL,
          })
        }
      }

      setTestResult({
        success: false,
        message: t('options.test.failedWith', { message: errorMessage }),
      })
    } finally {
      setTesting(false)
    }
  }, [selectedProvider, providerConfig, t])

  return (
    <div className="OptionsContainer">
      <DiagnosticsCard
        t={t}
        selectedProvider={selectedProvider}
        baseURL={providerConfig.baseURL}
        apiKey={providerConfig.apiKey}
        modelName={providerConfig.modelName}
        onResetConfig={() => {
          const preset = PROVIDER_PRESETS[selectedProvider]
          const newConfig: ModelConfig = {
            apiKey: '',
            baseURL: preset.baseURL,
            modelName: preset.defaultModel,
            targetLanguage: providerConfig.targetLanguage || 'English',
          }
          setProviderConfig(newConfig)
          setItem('providerConfig', newConfig).catch(console.error)
          message.success('Config reset to defaults')
        }}
      />

      <Card
        className="Card"
        title={t('options.apiConfig.title')}
        extra={
          <Tooltip title={t('options.apiConfig.tooltip')}>
            <InfoCircleOutlined />
          </Tooltip>
        }
        bordered={false}
      >
        <p>{t('options.language.label')}</p>
        <select value={lang} onChange={handleLanguageChange}>
          {SUPPORTED_LANGS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>

        <p style={{ marginTop: '10px' }}>{t('options.provider.label')}</p>
        <select value={selectedProvider} onChange={handleProviderChange}>
          <option value="openai-compatible">
            {t('options.provider.openaiCompatible')}
          </option>
          <option value="ollama">{t('options.provider.ollama')}</option>
          <option value="google-translate">
            {t('options.provider.googleTranslate')}
          </option>
        </select>

        <p style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
          {t(PROVIDER_PRESETS[selectedProvider].descriptionKey)}
        </p>

        {PROVIDER_PRESETS[selectedProvider].examples && (
          <div
            style={{
              marginTop: '10px',
              padding: '10px',
              backgroundColor: '#f5f5f5',
              borderRadius: '4px',
            }}
          >
            <p style={{ margin: '0 0 8px 0', fontWeight: 'bold' }}>
              {t('options.examples.title')}:
            </p>
            {PROVIDER_PRESETS[selectedProvider].examples?.map(
              (example, idx) => (
                <div
                  key={idx}
                  style={{
                    marginBottom: '8px',
                    padding: '8px',
                    backgroundColor: 'white',
                    borderRadius: '4px',
                    border: example.promoText
                      ? '2px solid #ff6b6b'
                      : '1px solid #e8e8e8',
                  }}
                >
                  <div
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      const newConfig = {
                        ...providerConfig,
                        baseURL: example.baseURL,
                        modelName: example.model,
                      }
                      setProviderConfig(newConfig)
                      setItem('providerConfig', newConfig).catch(console.error)
                    }}
                  >
                    <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                      {example.name}
                    </div>
                    {example.description && (
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#666',
                          marginBottom: '4px',
                        }}
                      >
                        {example.description}
                      </div>
                    )}
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      Base URL: {example.baseURL}
                    </div>
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      Model: {example.model}
                    </div>
                    <div
                      style={{
                        fontSize: '11px',
                        color: '#1890ff',
                        marginTop: '4px',
                      }}
                    >
                      {t('options.examples.clickToUse')}
                    </div>
                  </div>

                  {example.promoText && example.signupUrl && (
                    <div
                      style={{
                        marginTop: '8px',
                        padding: '8px',
                        backgroundColor: '#fff7e6',
                        borderRadius: '4px',
                        border: '1px solid #ffd591',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#d46b08',
                          marginBottom: '6px',
                          lineHeight: '1.5',
                        }}
                      >
                        {example.promoText}
                      </div>
                      <a
                        href={example.signupUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-block',
                          fontSize: '12px',
                          color: '#1890ff',
                          textDecoration: 'none',
                          fontWeight: 'bold',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        🎁 {t('options.examples.signup')} →
                      </a>
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
        )}

        <p style={{ marginTop: '10px' }}>{t('options.modelName.label')}</p>
        <Input
          value={providerConfig.modelName}
          onChange={(e) => handleConfigUpdate('modelName', e.target.value)}
          placeholder={t('options.modelName.placeholder', {
            model: PROVIDER_PRESETS[selectedProvider].defaultModel,
          })}
        />

        {PROVIDER_PRESETS[selectedProvider].requiresApiKey && (
          <>
            <p style={{ marginTop: '10px' }}>{t('options.apiKey.label')}</p>
            <Input
              value={providerConfig.apiKey}
              onChange={(e) => handleConfigUpdate('apiKey', e.target.value)}
              placeholder={t('options.apiKey.placeholder')}
              type="password"
            />
          </>
        )}

        <p style={{ marginTop: '10px' }}>{t('options.baseUrl.label')}</p>
        <Input
          value={providerConfig.baseURL}
          onChange={(e) => handleConfigUpdate('baseURL', e.target.value)}
          placeholder={t(
            selectedProvider === 'ollama'
              ? 'options.baseUrl.placeholder.ollama'
              : selectedProvider === 'google-translate'
              ? 'options.baseUrl.placeholder.google'
              : 'options.baseUrl.placeholder.openaiCompatible',
          )}
        />

        <p style={{ marginTop: '10px' }}>{t('options.targetLang.label')}</p>
        <select
          value={providerConfig.targetLanguage || 'English'}
          onChange={(e) => handleConfigUpdate('targetLanguage', e.target.value)}
          style={{ width: '100%', padding: '4px 8px' }}
        >
          <option value="English">English (en)</option>
          <option value="Turkish">Türkçe (tr)</option>
          <option value="Chinese">中文 (zh-CN)</option>
          <option value="Spanish">Español (es)</option>
          <option value="French">Français (fr)</option>
          <option value="German">Deutsch (de)</option>
          <option value="Portuguese">Português (pt)</option>
          <option value="Italian">Italiano (it)</option>
          <option value="Russian">Русский (ru)</option>
          <option value="Japanese">日本語 (ja)</option>
          <option value="Korean">한국어 (ko)</option>
          <option value="Arabic">العربية (ar)</option>
          <option value="Dutch">Nederlands (nl)</option>
          <option value="Polish">Polski (pl)</option>
        </select>

        <p style={{ marginTop: '12px', fontSize: '12px', color: '#666' }}>
          💡 {t('options.test.hint')}
        </p>

        <div
          style={{
            marginTop: '14px',
            padding: '10px',
            backgroundColor: '#f0f5ff',
            border: '1px solid #adc6ff',
            borderRadius: '4px',
          }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={enableStreaming}
              onChange={(e) => setEnableStreaming(e.target.checked)}
            />
            <span style={{ fontWeight: 'bold' }}>
              ⚡ {t('options.streaming.title')}
            </span>
            <span style={{ fontSize: '11px', color: '#1677ff' }}>
              SSE
            </span>
          </label>
          <p
            style={{
              fontSize: '12px',
              color: '#666',
              marginTop: '6px',
              marginBottom: 0,
            }}
          >
            {t('options.streaming.hint')}
          </p>
        </div>
      </Card>

      {selectedProvider === 'ollama' && (
        <OllamaSetupCard
          t={t}
          selectedProvider={selectedProvider}
          baseURL={providerConfig.baseURL}
          activeModel={providerConfig.modelName}
          onUseModel={(modelName) => {
            const newConfig = { ...providerConfig, modelName }
            setProviderConfig(newConfig)
            setItem('providerConfig', newConfig).catch(console.error)
            message.success(
            t('options.ollamaSetup.modelSet', { model: modelName }),
          )
        }}
        />
      )}

      <Card className="Card" title={t('options.subtitle.title')} bordered={false}>
        <p>{t('options.subtitle.promptLabel')}</p>

        <div
          style={{
            display: 'flex',
            gap: '12px',
            flexWrap: 'wrap',
            marginBottom: '12px',
          }}
        >
          <div style={{ flex: '1 1 200px' }}>
            <p style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
              {t('options.subtitle.sourceLang')}
            </p>
            <select
              value={sourceLang}
              onChange={handleSourceLangChange}
              style={{ width: '100%', padding: '4px 8px' }}
            >
              <option value="English">English</option>
              <option value="Turkish">Türkçe</option>
              <option value="Chinese">中文</option>
              <option value="Spanish">Español</option>
              <option value="French">Français</option>
              <option value="German">Deutsch</option>
              <option value="Portuguese">Português</option>
              <option value="Italian">Italiano</option>
              <option value="Russian">Русский</option>
              <option value="Japanese">日本語</option>
              <option value="Korean">한국어</option>
              <option value="Arabic">العربية</option>
              <option value="auto">Auto-detect</option>
            </select>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <p style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
              {t('options.subtitle.targetLang')}
            </p>
            <select
              value={targetLang}
              onChange={handleTargetLangChange}
              style={{ width: '100%', padding: '4px 8px' }}
            >
              <option value="English">English</option>
              <option value="Turkish">Türkçe</option>
              <option value="Chinese">中文</option>
              <option value="Spanish">Español</option>
              <option value="French">Français</option>
              <option value="German">Deutsch</option>
              <option value="Portuguese">Português</option>
              <option value="Italian">Italiano</option>
              <option value="Russian">Русский</option>
              <option value="Japanese">日本語</option>
              <option value="Korean">한국어</option>
              <option value="Arabic">العربية</option>
              <option value="Dutch">Nederlands</option>
              <option value="Polish">Polski</option>
            </select>
          </div>
        </div>

        <Input.TextArea
          value={promptDraft}
          onChange={handlePromptDraftChange}
          placeholder={t('options.subtitle.promptPlaceholder')}
          autoSize={{ minRows: 3, maxRows: 6 }}
          style={{
            borderColor: promptSaved ? undefined : '#faad14',
          }}
        />

        <div
          style={{
            marginTop: '10px',
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <Button type="primary" onClick={handlePromptSave} disabled={promptSaved}>
            💾 {t('options.subtitle.save')}
          </Button>
          <Button onClick={handlePromptReset}>
            ↺ {t('options.subtitle.reset')}
          </Button>
          {!promptSaved && (
            <span style={{ fontSize: '12px', color: '#faad14' }}>
              ● {t('options.subtitle.unsaved')}
            </span>
          )}
          {promptSaved && promptDraft === prompt && (
            <span style={{ fontSize: '12px', color: '#52c41a' }}>
              ✓ {t('options.subtitle.saved')}
            </span>
          )}
        </div>

        <p style={{ marginTop: '12px', fontSize: '12px', color: '#666' }}>
          {t('options.subtitle.promptExample')}:{' '}
          <code style={{ backgroundColor: '#f5f5f5', padding: '1px 4px' }}>
            {t('options.subtitle.promptExampleText')}
          </code>
        </p>
      </Card>

      <Card
        className="Card"
        title={t('options.domConfig.title')}
        bordered={false}
      >
        <p style={{ fontWeight: 'bold', marginBottom: '4px' }}>
          {t('options.domConfig.presetsTitle')}
        </p>
        <p style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
          {t('options.domConfig.presetsHint')}
        </p>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px',
            marginBottom: '16px',
          }}
        >
          {SITE_PRESETS.map((p) => (
            <Button
              key={p.id}
              size="small"
              onClick={() => applyPreset(p.id)}
              title={p.hint}
            >
              {p.name}
            </Button>
          ))}
        </div>

        <div
          style={{
            marginBottom: '16px',
            padding: '10px',
            backgroundColor: '#f0f5ff',
            border: '1px solid #adc6ff',
            borderRadius: '4px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
            }}
          >
            <Button
              type="primary"
              loading={autoScanning}
              onClick={handleAutoDetect}
            >
              🔮 {t('options.domConfig.autoDetect')}
            </Button>
            <span style={{ fontSize: '12px', color: '#666' }}>
              {t('options.domConfig.autoPickHint')}
            </span>
          </div>

          {autoCandidates.length > 0 && (
            <div style={{ marginTop: '10px' }}>
              <p style={{ fontWeight: 'bold', margin: 0, fontSize: '13px' }}>
                {t('options.domConfig.autoPickTitle')}:
              </p>
              <ul style={{ paddingLeft: '16px', margin: '4px 0 0 0' }}>
                {autoCandidates.map((c, i) => (
                  <li
                    key={i}
                    style={{
                      cursor: 'pointer',
                      padding: '4px 6px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      marginBottom: '2px',
                      backgroundColor:
                        i === 0 ? '#f6ffed' : 'transparent',
                      border:
                        i === 0
                          ? '1px solid #b7eb8f'
                          : '1px solid transparent',
                    }}
                    onClick={() => {
                      const [active] = [autoCandidates[i]]
                      if (!active) return
                      chrome.tabs.query(
                        { active: true, lastFocusedWindow: true },
                        (tabs) => {
                          const tab = tabs[0]
                          if (!tab?.url) return
                          try {
                            const origin = new URL(tab.url).origin
                            setDomConfigs((prev) => {
                              const replaced = [
                                ...prev.filter(
                                  (c) => c.domain && c.domain !== origin,
                                ),
                                { domain: origin, selector: active.selector },
                              ]
                              setItem('domConfigs', replaced).catch(
                                console.error,
                              )
                              return replaced
                            })
                            message.success(
                              `✓ ${active.selector.slice(0, 60)}`,
                              3,
                            )
                          } catch {
                            // ignore
                          }
                        },
                      )
                    }}
                  >
                    <div>
                      <code
                        style={{
                          backgroundColor: '#f5f5f5',
                          padding: '1px 4px',
                          borderRadius: '2px',
                          fontSize: '11px',
                        }}
                      >
                        {c.selector.slice(0, 80)}
                      </code>{' '}
                      <span style={{ color: '#52c41a', fontWeight: 'bold' }}>
                        score {c.score}
                      </span>{' '}
                      <span style={{ color: '#999' }}>
                        ({c.reason})
                      </span>
                    </div>
                    <div
                      style={{
                        color: '#666',
                        fontSize: '11px',
                        marginTop: '2px',
                      }}
                    >
                      "{c.sample.slice(0, 80)}"
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {domConfigs.map((config, index) => (
          <div key={index} style={{ marginBottom: '20px' }}>
            <Input
              placeholder={t('options.domConfig.domainPlaceholder')}
              value={config.domain}
              onChange={(e: any) =>
                handleConfigChange(index, 'domain', e.target.value)
              }
              style={{ marginBottom: '5px' }}
            />
            <Input
              placeholder={t('options.domConfig.selectorPlaceholder')}
              value={config.selector}
              onChange={(e: any) =>
                handleConfigChange(index, 'selector', e.target.value)
              }
              style={{ marginBottom: '5px' }}
            />
            <Button
              size="small"
              onClick={() => handleTestSelector(index)}
              loading={testingIndex === index}
              style={{ marginRight: '8px' }}
            >
              🔍 {t('options.domConfig.test')}
            </Button>
            <Button onClick={() => handleRemoveConfig(index)}>
              {t('options.domConfig.delete')}
            </Button>
          </div>
        ))}
        <Button onClick={handleAddConfig}>
          {t('options.domConfig.add')}
        </Button>
      </Card>

      <Card
        className="Card"
        title={t('options.download.title')}
        bordered={false}
      >
        <p>{t('options.download.experimental')}</p>
      </Card>

      <Card className="Card" title={t('options.about.title')} bordered={false}>
        <p>
          {t('options.about.star')}{' '}
          <a
            href="https://github.com/ChenYCL/chrome-extension-udemy-translate"
            target="_blank"
            rel="noopener noreferrer"
          >
            <GithubFilled style={{ fontSize: '28px', color: '#08c' }} />
          </a>{' '}
          {t('options.about.motivation')}
        </p>
      </Card>
    </div>
  )
}

interface OllamaSetupCardProps {
  t: (key: string, vars?: Record<string, string>) => string
  selectedProvider: ProviderType
  baseURL: string
  activeModel: string
  onUseModel: (modelName: string) => void
}

const OllamaSetupCard: React.FC<OllamaSetupCardProps> = ({
  t,
  selectedProvider,
  baseURL,
  activeModel,
  onUseModel,
}) => {
  const [detecting, setDetecting] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [pullStatus, setPullStatus] = useState<string>('')
  const [pullModel, setPullModel] = useState<string>('qwen2:0.5b')
  const [result, setResult] = useState<OllamaDetectResult | null>(null)
  const [error, setError] = useState<string>('')

  const isOllama = selectedProvider === 'ollama'

  const handleDetect = useCallback(async () => {
    setDetecting(true)
    setError('')
    try {
      const r = await detectOllama(baseURL)
      setResult(r)
      if (!r.ok) {
        if (r.cors) {
          setError(t('options.ollamaSetup.errorCors'))
        } else {
          setError(
            t('options.ollamaSetup.errorConnect', { url: baseURL }) +
              (r.error ? ` (${r.error})` : ''),
          )
        }
      }
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setDetecting(false)
    }
  }, [baseURL, t])

  const handlePull = useCallback(async () => {
    if (!pullModel.trim()) return
    setPulling(true)
    setPullStatus('')
    setError('')
    try {
      await pullOllamaModel(baseURL, pullModel.trim(), (event) => {
        if ('status' in event) {
          let line = event.status
          if (event.total && event.completed !== undefined) {
            const pct = Math.round((event.completed / event.total) * 100)
            line = `${event.status} ${pct}%`
          }
          setPullStatus(line)
        }
      })
      message.success(
        t('options.ollamaSetup.pullDone', { model: pullModel.trim() }),
      )
      setPullStatus('')
      handleDetect()
    } catch (e: any) {
      setError(t('options.ollamaSetup.pullFailed', { message: e?.message || String(e) }))
    } finally {
      setPulling(false)
    }
  }, [baseURL, pullModel, t, handleDetect])

  const recommendModels = [
    { label: '🥇 qwen2.5:3b (balanced, ~2 GB)', value: 'qwen2.5:3b' },
    { label: '⚡ qwen2:0.5b (lightest, ~500 MB)', value: 'qwen2:0.5b' },
    { label: '🦙 llama3.2:3b (Meta, ~2 GB)', value: 'llama3.2:3b' },
    { label: '🦙 llama3.2:1b (Meta, ~1 GB)', value: 'llama3.2:1b' },
    { label: '🦙 llama3.1:8b (quality, ~5 GB)', value: 'llama3.1:8b' },
    { label: '💎 gemma2:2b (Google, ~1.6 GB)', value: 'gemma2:2b' },
    { label: '💎 gemma3:4b (Google, ~3 GB)', value: 'gemma3:4b' },
    { label: '🌬️ mistral:7b (~4 GB)', value: 'mistral:7b' },
    { label: '🌬️ mistral-nemo:12b (multilingual, ~7 GB)', value: 'mistral-nemo' },
    { label: '🧠 phi3:mini (Microsoft, ~2 GB)', value: 'phi3:mini' },
    { label: '🧠 phi3.5:3.8b-mini-instruct-4k (~2.3 GB)', value: 'phi3.5:3.8b-mini-instruct-4k' },
    { label: '🔬 qwen2.5:7b (best mid-size, ~4.5 GB)', value: 'qwen2.5:7b' },
    { label: '🚀 qwen2.5:14b (high quality, ~9 GB)', value: 'qwen2.5:14b' },
  ]

  return (
    <Card className="Card" title={t('options.ollamaSetup.title')} bordered={false}>
      <p style={{ fontSize: '12px', color: '#666' }}>
        {t('options.ollamaSetup.intro')}
      </p>

      <p style={{ marginTop: '8px', fontWeight: 'bold' }}>
        ✅ {t('options.ollamaSetup.useDirect')}
      </p>
      <p style={{ fontSize: '12px', color: '#666' }}>
        {t('options.ollamaSetup.useDirectHint')}
      </p>

      {activeModel && (
        <div
          style={{
            marginTop: '10px',
            padding: '8px 12px',
            backgroundColor: '#e6f4ff',
            border: '1px solid #91caff',
            borderRadius: '4px',
            fontSize: '13px',
          }}
        >
          <span style={{ fontWeight: 'bold' }}>
            🎯 {t('options.ollamaSetup.activeModel')}:
          </span>{' '}
          <code style={{ color: '#1677ff' }}>{activeModel}</code>
        </div>
      )}

      <div style={{ marginTop: '12px' }}>
        <Button onClick={handleDetect} loading={detecting} disabled={!isOllama}>
          {detecting
            ? t('options.ollamaSetup.detecting')
            : t('options.ollamaSetup.detect')}
        </Button>
        {!isOllama && (
          <span style={{ marginLeft: '8px', fontSize: '12px', color: '#999' }}>
            ({t('options.provider.ollama')} provider only)
          </span>
        )}
      </div>

      {result && (
        <div style={{ marginTop: '12px' }}>
          <div
            style={{
              padding: '8px',
              borderRadius: '4px',
              backgroundColor: result.ok ? '#f6ffed' : '#fff2f0',
              border: `1px solid ${result.ok ? '#b7eb8f' : '#ffccc7'}`,
            }}
          >
            {result.ok ? (
              <>
                <div style={{ color: '#52c41a', fontWeight: 'bold' }}>
                  ✅ {t('options.ollamaSetup.running')}
                </div>
                {result.version && (
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                    {t('options.ollamaSetup.version')}: {result.version}
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ color: '#ff4d4f', fontWeight: 'bold' }}>
                  ❌ {t('options.ollamaSetup.notRunning')}
                </div>
                {error && (
                  <div
                    style={{
                      fontSize: '12px',
                      color: '#666',
                      marginTop: '4px',
                      whiteSpace: 'pre-line',
                    }}
                  >
                    {error}
                  </div>
                )}
                <div
                  style={{
                    fontSize: '12px',
                    color: '#666',
                    marginTop: '8px',
                  }}
                >
                  {t('options.ollamaSetup.installHint')}
                </div>

                <StartOllamaBlock t={t} />
                {result.cors && <CorsFixBlock t={t} />}
              </>
            )}
          </div>

          {result.ok && (
            <>
              <p
                style={{
                  marginTop: '12px',
                  fontWeight: 'bold',
                }}
              >
                {t('options.ollamaSetup.modelsTitle')} ({result.models.length})
              </p>
              {result.models.length === 0 ? (
                <p style={{ fontSize: '12px', color: '#999' }}>
                  {t('options.ollamaSetup.noModels')}
                </p>
              ) : (
                <ul style={{ paddingLeft: '20px' }}>
                  {result.models.map((m: OllamaModel) => (
                    <li
                      key={m.name}
                      style={{
                        marginBottom: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <code style={{ flex: 1 }}>{m.name}</code>
                      {m.details?.parameter_size && (
                        <span style={{ fontSize: '11px', color: '#999' }}>
                          {m.details.parameter_size}
                        </span>
                      )}
                      <Button
                        size="small"
                        onClick={() => onUseModel(m.name)}
                      >
                        {t('options.ollamaSetup.useModel')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      <div style={{ marginTop: '16px' }}>
        <p style={{ fontWeight: 'bold' }}>{t('options.ollamaSetup.pullTitle')}</p>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Input
            value={pullModel}
            onChange={(e) => setPullModel(e.target.value)}
            placeholder={t('options.ollamaSetup.pullPlaceholder')}
            style={{ flex: 1 }}
            disabled={pulling}
          />
          <Button
            type="primary"
            onClick={handlePull}
            loading={pulling}
            disabled={!pullModel.trim() || !isOllama}
          >
            {pulling
              ? t('options.ollamaSetup.pulling')
              : t('options.ollamaSetup.pullButton')}
          </Button>
          <Button
            onClick={() => {
              const m = pullModel.trim()
              if (!m || !isOllama) return
              onUseModel(m)
            }}
            disabled={!pullModel.trim() || !isOllama}
          >
            {t('options.ollamaSetup.setActive')}
          </Button>
        </div>
        {pullStatus && (
          <div
            style={{
              marginTop: '6px',
              fontSize: '12px',
              color: '#1890ff',
            }}
          >
            {t('options.ollamaSetup.pullProgress', { status: pullStatus })}
          </div>
        )}
        <p
          style={{
            marginTop: '10px',
            fontSize: '12px',
            color: '#666',
            fontWeight: 'bold',
          }}
        >
          {t('options.ollamaSetup.recommendTitle')}:
        </p>
        <div
          style={{
            display: 'flex',
            gap: '6px',
            flexWrap: 'wrap',
            maxHeight: '160px',
            overflowY: 'auto',
            padding: '4px',
            backgroundColor: '#fafafa',
            borderRadius: '4px',
            border: '1px solid #f0f0f0',
          }}
        >
          {recommendModels.map((r) => (
            <Button
              key={r.value}
              size="small"
              onClick={() => setPullModel(r.value)}
              disabled={pulling}
              title={`Click to use ${r.value} for pull`}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>
    </Card>
  )
}

function detectPlatform(): 'mac' | 'win' | 'linux' | 'unknown' {
  const ua = (navigator.userAgent || '').toLowerCase()
  const plat = (navigator.platform || '').toLowerCase()
  if (plat.includes('mac') || ua.includes('mac')) return 'mac'
  if (plat.includes('win') || ua.includes('win')) return 'win'
  if (plat.includes('linux') || ua.includes('linux')) return 'linux'
  return 'unknown'
}

interface StartOllamaBlockProps {
  t: (key: string, vars?: Record<string, string>) => string
}

const StartOllamaBlock: React.FC<StartOllamaBlockProps> = ({ t }) => {
  const [platform, setPlatform] = useState<'mac' | 'win' | 'linux' | 'unknown'>('unknown')

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
      () => message.error('Clipboard error'),
    )
  }, [command, t])

  const openUrl = useCallback((url: string) => {
    chrome.tabs.create({ url })
  }, [])

  return (
    <div
      style={{
        marginTop: '12px',
        padding: '10px',
        backgroundColor: '#fffbe6',
        border: '1px solid #ffe58f',
        borderRadius: '4px',
      }}
    >
      <p style={{ margin: 0, fontWeight: 'bold' }}>
        ▶️ {t('options.ollamaSetup.startTitle')}
      </p>
      <p
        style={{
          fontSize: '12px',
          color: '#666',
          marginTop: '4px',
          marginBottom: '8px',
        }}
      >
        {t('options.ollamaSetup.startHint')}
      </p>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
          backgroundColor: '#fff',
          padding: '6px 10px',
          borderRadius: '4px',
          border: '1px solid #d9d9d9',
        }}
      >
        <code
          style={{
            flex: '1 1 200px',
            fontFamily: 'Menlo, Monaco, monospace',
            fontSize: '13px',
          }}
        >
          {command}
        </code>
        <Button size="small" onClick={copyCommand}>
          📋 {t('options.ollamaSetup.copyCommand')}
        </Button>
      </div>

      <div
        style={{
          marginTop: '10px',
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap',
        }}
      >
        {platform === 'mac' && (
          <Button size="small" onClick={() => openUrl('ollama://')}>
            🍎 {t('options.ollamaSetup.openApp')}
          </Button>
        )}
        <Button size="small" onClick={() => openUrl('https://ollama.com/download')}>
          ⬇️ {t('options.ollamaSetup.openDownload')}
        </Button>
        <Button size="small" onClick={() => openUrl('https://github.com/ollama/ollama/blob/main/docs/api.md')}>
          📖 {t('options.ollamaSetup.openDocs')}
        </Button>
      </div>
    </div>
  )
}

interface CorsFixBlockProps {
  t: (key: string, vars?: Record<string, string>) => string
}

const CorsFixBlock: React.FC<CorsFixBlockProps> = ({ t }) => {
  const [platform, setPlatform] = useState<'mac' | 'win' | 'linux' | 'unknown'>('unknown')
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
        () => message.error('Clipboard error'),
      )
    },
    [t],
  )

  const CodeRow: React.FC<{ value: string }> = ({ value }) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        backgroundColor: '#fff',
        padding: '6px 10px',
        borderRadius: '4px',
        border: '1px solid #d9d9d9',
        marginTop: '6px',
      }}
    >
      <code
        style={{
          flex: '1 1 200px',
          fontFamily: 'Menlo, Monaco, monospace',
          fontSize: '12px',
          wordBreak: 'break-all',
        }}
      >
        {value}
      </code>
      <Button size="small" onClick={() => copyText(value)}>
        📋 {t('options.ollamaSetup.copyCommand')}
      </Button>
    </div>
  )

  return (
    <div
      style={{
        marginTop: '12px',
        padding: '10px',
        backgroundColor: '#fff1f0',
        border: '1px solid #ffccc7',
        borderRadius: '4px',
      }}
    >
      <p style={{ margin: 0, fontWeight: 'bold', color: '#cf1322' }}>
        ⚠️ {t('options.ollamaSetup.corsFixTitle')}
      </p>
      <p
        style={{
          fontSize: '12px',
          color: '#666',
          marginTop: '4px',
          marginBottom: '8px',
        }}
      >
        {t('options.ollamaSetup.corsFixHint')}
      </p>

      <CodeRow value={strict} />
      <p style={{ fontSize: '11px', color: '#999', marginTop: '8px' }}>
        {t('options.ollamaSetup.corsAltTitle')}:
      </p>
      <CodeRow value={perm} />

      <div
        style={{
          marginTop: '10px',
          fontSize: '11px',
          color: '#666',
          lineHeight: 1.5,
        }}
      >
        <strong>{t('options.ollamaSetup.corsAltHint')}</strong>
        <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
          <li>Restart the Ollama service after setting the env var.</li>
          <li>
            On Windows, run <code>setx</code> in an admin terminal, then open a new
            shell.
          </li>
          <li>
            If you previously ran Ollama as a system service, edit its environment
            via <code>systemctl edit ollama</code>.
          </li>
        </ul>
      </div>
    </div>
  )
}

interface DiagnosticsCardProps {
  t: (key: string, vars?: Record<string, string>) => string
  selectedProvider: ProviderType
  baseURL: string
  apiKey: string
  modelName: string
  onResetConfig: () => void
}

const STATUS_META: Record<
  string,
  { color: string; bg: string; border: string; icon: string }
> = {
  connected: { color: '#52c41a', bg: '#f6ffed', border: '#b7eb8f', icon: '✅' },
  cors_blocked: { color: '#faad14', bg: '#fffbe6', border: '#ffe58f', icon: '⚠️' },
  unreachable: { color: '#ff4d4f', bg: '#fff2f0', border: '#ffccc7', icon: '❌' },
  auth_error: { color: '#ff4d4f', bg: '#fff2f0', border: '#ffccc7', icon: '🔑' },
  not_found: { color: '#ff4d4f', bg: '#fff2f0', border: '#ffccc7', icon: '🔍' },
  timeout: { color: '#faad14', bg: '#fffbe6', border: '#ffe58f', icon: '⏱' },
  unknown: { color: '#666', bg: '#fafafa', border: '#d9d9d9', icon: '❔' },
}

const DiagnosticsCard: React.FC<DiagnosticsCardProps> = ({
  t,
  selectedProvider,
  baseURL,
  apiKey,
  modelName,
  onResetConfig,
}) => {
  const [testing, setTesting] = useState(false)
  const [lastResult, setLastResult] = useState<DiagnosticResult | null>(null)
  const [history, setHistory] = useState<DiagnosticResult[]>([])

  useEffect(() => {
    chrome.storage.local.get(['lastDiagnostic', 'diagnosticHistory'], (r) => {
      if (r?.lastDiagnostic) setLastResult(r.lastDiagnostic as DiagnosticResult)
      if (Array.isArray(r?.diagnosticHistory)) {
        setHistory(r.diagnosticHistory.slice(0, 5))
      }
    })
  }, [])

  const handleTest = useCallback(async () => {
    setTesting(true)
    try {
      const result = await runDiagnostic(selectedProvider, {
        baseURL,
        apiKey,
        modelName,
      })
      setLastResult(result)
      setHistory((prev) => [result, ...prev].slice(0, 5))
      chrome.storage.local.set({
        lastDiagnostic: result,
        diagnosticHistory: [result, ...history].slice(0, 5),
      })
      if (result.status === 'connected') {
        message.success(
          `${t(`options.diagnostics.status.${result.status}`)} (${result.latencyMs}ms)`,
          3,
        )
      } else if (
        result.status === 'cors_blocked' ||
        result.status === 'auth_error'
      ) {
        message.warning(t(`options.diagnostics.status.${result.status}`), 4)
      } else {
        message.error(t(`options.diagnostics.status.${result.status}`), 4)
      }
    } catch (e: any) {
      message.error(e?.message || String(e))
    } finally {
      setTesting(false)
    }
  }, [selectedProvider, baseURL, apiKey, modelName, history, t])

  const copyUrl = useCallback(() => {
    navigator.clipboard.writeText(baseURL || '').then(
      () => message.success('Copied'),
      () => message.error('Clipboard error'),
    )
  }, [baseURL])

  const status = lastResult?.status
  const meta = status ? STATUS_META[status] : null

  return (
    <Card
      className="Card"
      title={t('options.diagnostics.title')}
      bordered={false}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '12px',
        }}
      >
        <div>
          <div style={{ fontSize: '12px', color: '#666' }}>
            {t('options.diagnostics.provider')}:
          </div>
          <div style={{ fontWeight: 'bold', fontSize: '14px' }}>
            {selectedProvider}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '12px', color: '#666' }}>
            {t('options.diagnostics.url')}:
          </div>
          <code
            style={{
              fontSize: '12px',
              backgroundColor: '#f5f5f5',
              padding: '2px 6px',
              borderRadius: '3px',
            }}
          >
            {baseURL || '(empty)'}
          </code>
        </div>
      </div>

      {lastResult ? (
        <div
          style={{
            padding: '10px',
            backgroundColor: meta?.bg,
            border: `1px solid ${meta?.border}`,
            borderRadius: '4px',
            marginBottom: '12px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: '16px' }}>{meta?.icon}</span>
            <span
              style={{
                fontWeight: 'bold',
                color: meta?.color,
              }}
            >
              {t(`options.diagnostics.status.${lastResult.status}`)}
            </span>
            {lastResult.latencyMs !== null && (
              <span style={{ fontSize: '12px', color: '#666' }}>
                · {t('options.diagnostics.latency')}: {lastResult.latencyMs}ms
              </span>
            )}
            <span style={{ fontSize: '11px', color: '#999', marginLeft: 'auto' }}>
              {new Date(lastResult.checkedAt).toLocaleTimeString()}
            </span>
          </div>
          <div
            style={{
              fontSize: '12px',
              color: '#666',
              marginTop: '6px',
              lineHeight: 1.5,
            }}
          >
            {t(`options.diagnostics.hint.${lastResult.status}`)}
          </div>
          {lastResult.detail && (
            <details style={{ marginTop: '6px' }}>
              <summary
                style={{
                  fontSize: '11px',
                  color: '#999',
                  cursor: 'pointer',
                }}
              >
                {t('options.diagnostics.lastError')}
              </summary>
              <pre
                style={{
                  fontSize: '11px',
                  color: '#666',
                  backgroundColor: '#fff',
                  padding: '6px',
                  borderRadius: '3px',
                  marginTop: '4px',
                  overflow: 'auto',
                  maxHeight: '120px',
                }}
              >
                {lastResult.message}
                {lastResult.detail ? `\n${lastResult.detail}` : ''}
              </pre>
            </details>
          )}
        </div>
      ) : (
        <div
          style={{
            padding: '10px',
            backgroundColor: '#fafafa',
            border: '1px solid #d9d9d9',
            borderRadius: '4px',
            marginBottom: '12px',
            fontSize: '12px',
            color: '#999',
            textAlign: 'center',
          }}
        >
          ❔ {t('options.diagnostics.never')}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <Button type="primary" onClick={handleTest} loading={testing}>
          🩺 {t('options.diagnostics.test')}
        </Button>
        <Button onClick={copyUrl}>📋 {t('options.diagnostics.copyUrl')}</Button>
        {selectedProvider === 'ollama' && (
          <Button onClick={() => chrome.tabs.create({ url: 'ollama://' })}>
            🍎 {t('options.diagnostics.openApp')}
          </Button>
        )}
        <Button onClick={onResetConfig} danger>
          ↺ {t('options.diagnostics.reset')}
        </Button>
      </div>

      {history.length > 1 && (
        <details style={{ marginTop: '12px' }}>
          <summary
            style={{
              fontSize: '12px',
              color: '#666',
              cursor: 'pointer',
            }}
          >
            {t('options.diagnostics.recentResults')} ({history.length})
          </summary>
          <ul
            style={{
              marginTop: '6px',
              paddingLeft: '20px',
              fontSize: '11px',
              color: '#666',
            }}
          >
            {history.map((h, i) => (
              <li key={i} style={{ marginBottom: '2px' }}>
                {STATUS_META[h.status]?.icon} {new Date(h.checkedAt).toLocaleTimeString()}{' '}
                — {h.message}
                {h.latencyMs !== null ? ` (${h.latencyMs}ms)` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  )
}

export default Options