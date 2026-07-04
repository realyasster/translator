import { translateText } from '../../utils/request'
import { streamTranslate, ModelConfig, ProviderType } from '../../utils/stream-translator'

console.log('Background script initialized')

const DEFAULT_SETTINGS = {
  status: false,
  backgroundColor: 'rgba(0, 0, 0, 0.75)',
  backgroundOpacity: '0.8',
  originFontColor: '#ffffff',
  originFontSize: '16',
  originFontWeight: 'normal',
  translatedFontSize: '16',
  translatedFontColor: '#ffff00',
  translatedFontWeight: 'normal',
  domConfigs: [
    {
      domain: 'https://www.netflix.com',
      selector: '.player-timedtext-text-container',
    },
    {
      domain: 'https://www.udemy.com',
      selector: '[data-purpose="captions-cue"]',
      selectors: [
        '[data-purpose="captions-cue"]',
        '[data-purpose="captions-cue-text"]',
        '[class*="cue-text"]',
        '.transcript--cue-text--3osqK',
        'div[class*="captions"] span',
      ],
    },
    {
      domain: 'https://www.youtube.com',
      selector: '.ytp-caption-segment',
    },
    { domain: '', selector: '' },
  ],
  prompt:
    'Translate the following English text into Chinese and separate the translations with @@@',
  // 新增浮动字幕默认配置
  subtitlePosition: 'bottom',
  subtitleWidth: 600,
  subtitleHeight: 120,
  isDraggable: true,
  // 添加模型配置
  selectedModel: 'openai',
  openaiConfig: {
    apiKey: '',
    baseURL: 'https://api.openai.com/v1',
    modelName: 'gpt-3.5-turbo',
  },
  ollamaConfig: {
    apiKey: 'ollama',
    baseURL: 'http://localhost:11434/v1',
    modelName: 'qwen2:0.5b',
  },
}

chrome.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
  if (reason === 'install') {
    console.log('First install')
    chrome.storage.local.set(DEFAULT_SETTINGS)
  } else if (reason === 'update') {
    const currentVersion = chrome.runtime.getManifest().version
    console.log(`Updated from ${previousVersion} to ${currentVersion}`)
  }
})

const getStorageData = (): Promise<any> =>
  new Promise((resolve) => chrome.storage.local.get(null, resolve))

const broadcastStatusChange = async (status: boolean): Promise<void> => {
  try {
    const tabs = await chrome.tabs.query({})
    const promises = tabs.map(async (tab) => {
      if (tab.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: 'STATUS_CHANGED',
            status,
          })
        } catch (error) {
          // 忽略无法连接的标签页（如 chrome:// 页面）
          console.log(`Could not send message to tab ${tab.id}:`, error)
        }
      }
    })
    await Promise.allSettled(promises)
  } catch (error) {
    console.error('Error in broadcastStatusChange:', error)
  }
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.status) {
    broadcastStatusChange(changes.status.newValue)
  }
})

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'TRANSLATE_TEXT') {
    handleTranslationRequest(request, sendResponse)
    return true // Indicates an asynchronous response
  }
})

// Streaming translation via persistent port
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'translate-stream') return
  port.onMessage.addListener((request) => {
    if (request.type === 'TRANSLATE_STREAM') {
      handleStreamRequest(request, port)
    }
  })
})

const handleStreamRequest = async (request: any, port: chrome.runtime.Port) => {
  const { text, requestId } = request
  const abortController = new AbortController()

  // Listen for client disconnect to abort
  port.onDisconnect.addListener(() => {
    abortController.abort()
  })

  try {
    const storageData = await getStorageData()
    if (!storageData.status) {
      port.postMessage({ type: 'STREAM_ERROR', requestId, error: 'Translation disabled' })
      return
    }

    const info = resolveProviderAndConfig(storageData)
    if (!info) {
      port.postMessage({ type: 'STREAM_ERROR', requestId, error: 'No valid configuration' })
      return
    }

    await streamTranslate(
      info.provider,
      info.config,
      text,
      storageData.prompt || '',
      {
        onChunk: (chunk: string) => {
          try {
            port.postMessage({ type: 'STREAM_CHUNK', requestId, chunk })
          } catch {
            // port closed
          }
        },
        onDone: (full: string) => {
          try {
            port.postMessage({ type: 'STREAM_DONE', requestId, fullText: full })
          } catch {
            // port closed
          }
        },
        onError: (err: Error) => {
          try {
            port.postMessage({ type: 'STREAM_ERROR', requestId, error: err.message })
          } catch {
            // port closed
          }
        },
      },
      abortController.signal,
    )
  } catch (err: any) {
    try {
      port.postMessage({
        type: 'STREAM_ERROR',
        requestId,
        error: err?.message || String(err),
      })
    } catch {
      // port closed
    }
  }
}

function resolveProviderAndConfig(storageData: any): { provider: ProviderType; config: ModelConfig } | null {
  let provider: ProviderType
  let config: ModelConfig

  if (storageData.selectedProvider && storageData.providerConfig) {
    let raw = storageData.selectedProvider as string
    if (raw === 'openai' || raw === 'zhipu') provider = 'openai-compatible'
    else provider = raw as ProviderType
    config = storageData.providerConfig
  } else {
    const selectedModel = storageData.selectedModel || 'openai'
    if (selectedModel === 'openai' || selectedModel === 'zhipu') provider = 'openai-compatible'
    else provider = selectedModel as ProviderType
    if (selectedModel === 'ollama' && storageData.ollamaConfig) {
      config = storageData.ollamaConfig
    } else if (storageData.openaiConfig) {
      config = storageData.openaiConfig
    } else {
      return null
    }
  }
  return { provider, config }
}

const handleTranslationRequest = async (
  request: any,
  sendResponse: (response: any) => void,
) => {
  const { text, targetLanguage } = request

  try {
    const storageData = await getStorageData()
    const {
      status,
      prompt,
      selectedProvider,
      providerConfig,
      selectedModel,
      ollamaConfig,
      openaiConfig,
    } = storageData

    if (!status) {
      throw new Error('Translation is currently disabled')
    }

    if (
      !isConfigValid(
        selectedProvider,
        providerConfig,
        selectedModel,
        ollamaConfig,
        openaiConfig,
      )
    ) {
      throw new Error(
        'API 配置不完整。请检查 API Key、Base URL 和模型名称是否正确设置。',
      )
    }

    const response = await translateText(text, targetLanguage, prompt)
    console.log('Translation response:', response)
    sendResponse({ type: 'TRANSLATED_TEXT', translatedText: response })
  } catch (error: any) {
    sendResponse({ type: 'TRANSLATION_ERROR', error: error.message })
  }
}

const isConfigValid = (
  selectedProvider: string | undefined,
  providerConfig: any,
  selectedModel: string | undefined,
  ollamaConfig: any,
  openaiConfig: any,
): boolean => {
  if (selectedProvider && providerConfig) {
    let provider = selectedProvider
    if (provider === 'openai' || provider === 'zhipu') {
      provider = 'openai-compatible'
    }

    if (provider === 'openai-compatible') {
      return !!(
        providerConfig?.apiKey &&
        providerConfig?.baseURL &&
        providerConfig?.modelName &&
        providerConfig.apiKey.trim() !== '' &&
        providerConfig.baseURL.trim() !== '' &&
        providerConfig.modelName.trim() !== ''
      )
    } else if (provider === 'ollama') {
      return !!(
        providerConfig?.baseURL &&
        providerConfig?.modelName &&
        providerConfig.baseURL.trim() !== '' &&
        providerConfig.modelName.trim() !== ''
      )
    } else if (provider === 'google-translate') {
      return !!providerConfig?.baseURL && providerConfig.baseURL.trim() !== ''
    }
  }

  if (selectedModel === 'openai') {
    return !!(
      openaiConfig?.apiKey &&
      openaiConfig?.baseURL &&
      openaiConfig?.modelName &&
      openaiConfig.apiKey.trim() !== '' &&
      openaiConfig.baseURL.trim() !== '' &&
      openaiConfig.modelName.trim() !== ''
    )
  } else if (selectedModel === 'ollama') {
    return !!(
      ollamaConfig?.baseURL &&
      ollamaConfig?.modelName &&
      ollamaConfig.baseURL.trim() !== '' &&
      ollamaConfig.modelName.trim() !== ''
    )
  }

  return false
}
