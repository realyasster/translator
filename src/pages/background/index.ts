import { translateText } from '../../utils/request'
import { streamTranslate } from '../../utils/stream-translator'
import {
  DEFAULT_CTRANSLATE2_BASE_URL,
  DEFAULT_CTRANSLATE2_MODEL,
  DEFAULT_SOURCE_LANGUAGE,
  DEFAULT_TARGET_LANGUAGE,
  isModelConfigComplete,
  resolveProviderAndConfig,
} from '../../utils/settings-utils'
import {
  DETECTION_PORT_NAME,
  DetectionCommand,
  DetectionRequest,
  SourceRef,
} from '../../types/detection'
import { SourceCoordinator } from './source-coordinator'
import {
  deliverRevokeOrRelease,
  detectionStatusFailure,
  handleDetectionMessage,
  handleDetectionPortDisconnect,
  setCurrentDetectionPort,
} from './detection-ports'
import {
  isExpectedBfcachePortClose,
  readRuntimeLastError,
} from '../../utils/port-errors'
import { getDeepLApiKey, resolveDeepLPlan } from '../../utils/deepl'

console.log('Background script initialized')

/** Sekme/frame başına açık algılama portları. */
const detectionPorts = new Map<string, chrome.runtime.Port>()

function framePortKey(tabId: number, frameId: number): string {
  return `${tabId}:${frameId}`
}

function postToFrame(
  tabId: number,
  frameId: number,
  message: DetectionCommand,
): boolean {
  const port = detectionPorts.get(framePortKey(tabId, frameId))
  if (!port) return false
  try {
    port.postMessage(message)
    return true
  } catch {
    return false
  }
}

const sourceCoordinator = new SourceCoordinator({
  hooks: {
    grant: ({ tabId, frameId, token, source, expiresAt }) => {
      postToFrame(tabId, frameId, {
        type: 'SOURCE_GRANT',
        token,
        source,
        expiresAt,
      })
    },
    revoke: ({ tabId, frameId, token, reason }) => {
      deliverRevokeOrRelease(
        () =>
          postToFrame(tabId, frameId, {
            type: 'SOURCE_REVOKE',
            token,
            reason,
          }),
        () => sourceCoordinator.release(tabId, frameId, token),
      )
    },
  },
})

// MV3 service worker uyuyabilir; bu zamanlayıcı yalnızca uyanıkken çalışır.
// Uyku sırasında gelen heartbeat/güncelleme çalışanı uyandırır ve süre
// denetimini tetikler. Yeniden başlamada bellek durumu kaybolur; frame'ler
// yeniden kayıt olur ve eski token'larla çeviri yapılamaz. Bu kısa aralıkta
// popup "searching" gösterebilir; bu beklenen durumdur.
setInterval(() => sourceCoordinator.expire(), 1000)

const DEFAULT_SETTINGS = {
  status: false,
  showOriginalSubtitle: true,
  backgroundColor: 'rgba(0, 0, 0, 0.75)',
  backgroundOpacity: '0.8',
  originFontColor: '#ffffff',
  originFontSize: '16',
  originFontWeight: 'normal',
  translatedFontSize: '16',
  translatedFontColor: '#ffff00',
  translatedFontWeight: 'normal',
  // Yeni kurulumda site seçici yok; eski kullanıcı verileri silinmez.
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
  ctranslate2Config: {
    apiKey: '',
    baseURL: DEFAULT_CTRANSLATE2_BASE_URL,
    modelName: DEFAULT_CTRANSLATE2_MODEL,
    sourceLanguage: DEFAULT_SOURCE_LANGUAGE,
    targetLanguage: DEFAULT_TARGET_LANGUAGE,
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

// Service worker yeniden başladığında koordinatörün enabled durumunu depodan
// yükle; kapalıyken hiçbir frame'e yetki verilmemeli.
void getStorageData()
  .then((data) => {
    sourceCoordinator.setEnabled(!!data?.status)
  })
  .catch(() => {
    // Depo okunamazsa koordinatör fail-closed kalır.
  })

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
    sourceCoordinator.setEnabled(!!changes.status.newValue)
    broadcastStatusChange(changes.status.newValue)
  }
})

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'TRANSLATE_TEXT') {
    if (!validateTranslationRequest(request, sender)) {
      sendResponse({
        type: 'TRANSLATION_ERROR',
        error: 'Not authorized for the active subtitle source',
      })
      return true
    }
    handleTranslationRequest(request, sendResponse)
    return true // Indicates an asynchronous response
  }
  if (request.type === 'GET_DETECTION_STATUS') {
    handleDetectionStatusRequest(sendResponse)
    return true
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  sourceCoordinator.removeTab(tabId)
})

// Otomatik altyazı algılama portu: frame -> background.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== DETECTION_PORT_NAME) return
  const tabId = port.sender?.tab?.id
  const frameId = port.sender?.frameId ?? 0
  if (tabId === undefined) {
    port.disconnect()
    return
  }
  const key = framePortKey(tabId, frameId)
  const previous = setCurrentDetectionPort(detectionPorts, key, port)
  if (previous) {
    // Eski portun dinleyicileri kapatılana kadar canlı kalabilir; mesaj
    // guard'ı onları zaten yok sayar. Yine de kaynağı bırak.
    try {
      previous.disconnect()
    } catch {
      // zaten kapanmış
    }
  }

  port.onMessage.addListener((message: DetectionRequest) => {
    // Geç gelen eski port mesajı yeni oturumun documentId'sini ezmesin.
    handleDetectionMessage(detectionPorts, key, port, () => {
      if (!message || typeof message !== 'object') return
      if (message.type === 'DETECTION_REGISTER') {
        sourceCoordinator.register(
          tabId,
          frameId,
          message.documentId,
          message.url,
        )
        return
      }
      if (message.type === 'DETECTION_UPDATE') {
        sourceCoordinator.update(tabId, frameId, {
          documentId: message.documentId,
          url: message.url,
          phase: message.phase,
          reason: message.reason,
          candidates: message.candidates,
          documentVisible: message.documentVisible,
          frameVisible: message.frameVisible,
          videoCount: message.videoCount,
          fullscreen: message.fullscreen,
          observedAt: message.observedAt,
        })
        return
      }
      if (message.type === 'SOURCE_HEARTBEAT') {
        const result = sourceCoordinator.heartbeat(
          tabId,
          frameId,
          message.token,
        )
        if (!result.renewed) {
          postToFrame(tabId, frameId, {
            type: 'SOURCE_REVOKE',
            token: message.token,
            reason: 'heartbeat-rejected',
          })
        }
        return
      }
      if (message.type === 'SOURCE_RELEASED') {
        sourceCoordinator.release(tabId, frameId, message.token)
      }
    })
  })

  port.onDisconnect.addListener(() => {
    const lastError = readRuntimeLastError()
    if (lastError && !isExpectedBfcachePortClose(lastError, false)) {
      console.debug('Detection port closed:', lastError.message)
    }
    // Yalnızca hâlâ güncel olan port kapanınca oturumu sil. Aynı frame için
    // yeni port açıldıysa eski portun geç kapanması yeni oturumu etkilemez.
    handleDetectionPortDisconnect(detectionPorts, key, port, () => {
      sourceCoordinator.unregister(tabId, frameId)
    })
  })
})

// Streaming translation via persistent port
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'translate-stream') return
  port.onMessage.addListener((request) => {
    if (request.type === 'TRANSLATE_STREAM') {
      if (!validateTranslationRequest(request, port.sender)) {
        try {
          port.postMessage({
            type: 'STREAM_ERROR',
            requestId: request.requestId,
            error: 'Not authorized for the active subtitle source',
          })
        } catch {
          // port closed
        }
        return
      }
      handleStreamRequest(request, port)
    }
  })
})

type ResolvedTranslationConfig = ReturnType<
  typeof resolveProviderAndConfig
>

/**
 * Temporary DeepL diagnostics: never log the key itself, only whether the two
 * storage records carry one.
 */
const logDeepLRequestContext = (
  scope: 'stream' | 'translate',
  requestId: unknown,
  resolved: ResolvedTranslationConfig,
  storageData: any,
  error?: string,
): void => {
  if (!resolved || resolved.provider !== 'deepl') return
  const key = getDeepLApiKey(resolved.config)
  const context = {
    requestId,
    provider: resolved.provider,
    plan: resolveDeepLPlan(resolved.config),
    hasKey: key !== '',
    keyLength: key.length,
    fromProviderConfig: !!storageData?.providerConfig,
    hasDeeplConfigKey: !!getDeepLApiKey(storageData?.deeplConfig || {}),
  }
  if (error === undefined) {
    console.debug('[deepl] request', scope, context)
  } else {
    console.debug('[deepl] error', scope, { ...context, error })
  }
}

const handleStreamRequest = async (request: any, port: chrome.runtime.Port) => {
  const { text, requestId } = request
  const abortController = new AbortController()
  let resolved: ResolvedTranslationConfig = null
  let storageData: any = null

  // Listen for client disconnect to abort
  port.onDisconnect.addListener(() => {
    const lastError = readRuntimeLastError()
    if (lastError && !isExpectedBfcachePortClose(lastError, false)) {
      console.debug('Stream port closed:', lastError.message)
    }
    abortController.abort()
  })

  try {
    storageData = await getStorageData()
    if (!storageData.status) {
      port.postMessage({ type: 'STREAM_ERROR', requestId, error: 'Translation disabled' })
      return
    }

    const info = resolveProviderAndConfig(storageData)
    if (!info) {
      port.postMessage({ type: 'STREAM_ERROR', requestId, error: 'No valid configuration' })
      return
    }
    resolved = info
    logDeepLRequestContext('stream', requestId, info, storageData)

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
          logDeepLRequestContext(
            'stream',
            requestId,
            resolved,
            storageData,
            err.message,
          )
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
    logDeepLRequestContext(
      'stream',
      requestId,
      resolved,
      storageData,
      err?.message || String(err),
    )
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

/**
 * Normal ve streaming isteklerinde kaynak kimliği ve sahiplik token'ı
 * doğrulanır. Token'sız veya eski token'lı istek çeviri üretmez.
 */
function validateTranslationRequest(
  request: any,
  sender?: chrome.runtime.MessageSender,
): boolean {
  const tabId = sender?.tab?.id
  if (tabId === undefined) return false
  const frameId = sender?.frameId ?? 0
  const token = request?.token
  const source = request?.source as SourceRef | undefined
  if (!token || !source) return false
  const result = sourceCoordinator.validate(tabId, frameId, token, source)
  return result.valid
}

const handleDetectionStatusRequest = async (
  sendResponse: (response: any) => void,
): Promise<void> => {
  // Storage okunamazsa çevirinin kapalı olduğu iddia edilmez; enabled
  // bilinmiyorken "unavailable" dönmek tutarlıdır.
  let enabled = true
  try {
    const storageData = await getStorageData()
    enabled = !!storageData.status
    if (!enabled) {
      sendResponse({
        type: 'DETECTION_STATUS',
        enabled: false,
        status: { phase: 'disabled', reason: 'extension-disabled' },
      })
      return
    }
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    })
    const tabId = tabs[0]?.id
    if (tabId === undefined) {
      sendResponse({
        type: 'DETECTION_STATUS',
        enabled: true,
        status: { phase: 'searching', reason: 'no-frame' },
      })
      return
    }
    const status = sourceCoordinator.status(tabId, Date.now())
    sendResponse({ type: 'DETECTION_STATUS', enabled: true, status })
  } catch {
    sendResponse(detectionStatusFailure(enabled))
  }
}

const handleTranslationRequest = async (
  request: any,
  sendResponse: (response: any) => void,
) => {
  const { text, targetLanguage } = request
  let resolved: ResolvedTranslationConfig = null
  let storageData: any = null

  try {
    storageData = await getStorageData()
    const { status, prompt } = storageData

    if (!status) {
      throw new Error('Translation is currently disabled')
    }

    resolved = resolveProviderAndConfig(storageData)
    logDeepLRequestContext(
      'translate',
      request.requestId,
      resolved,
      storageData,
    )
    if (
      !resolved ||
      !isModelConfigComplete(resolved.provider, resolved.config)
    ) {
      throw new Error(
        'API 配置不完整。请检查 API Key、Base URL 和模型名称是否正确设置。',
      )
    }

    const response = await translateText(text, targetLanguage, prompt)
    sendResponse({ type: 'TRANSLATED_TEXT', translatedText: response })
  } catch (error: any) {
    logDeepLRequestContext(
      'translate',
      request.requestId,
      resolved,
      storageData,
      error.message,
    )
    sendResponse({ type: 'TRANSLATION_ERROR', error: error.message })
  }
}
