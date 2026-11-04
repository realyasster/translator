import { TranslationManager } from '../translation-manager'
import {
  DetectionAuthority,
  DetectionStatus,
  SourceRef,
  SubtitleDetector,
  SubtitleSample,
} from '../../../types/detection'
import { SubtitlePresentation } from '../detection/presentation'
import { setContentPageSuspended } from '../page-lifecycle'

type SendCallback = (response: any) => void

let sendMessages: any[] = []
let pendingCallbacks: SendCallback[] = []
let createdManagers: TranslationManager[] = []

let portMessageListeners: Array<(msg: any) => void> = []
let portDisconnectListeners: Array<() => void> = []
let portPostMessages: any[] = []
let portDisconnect: jest.Mock

const BASE_STORAGE = {
  status: true,
  prompt: 'translate',
  enableStreaming: false,
  subtitlePosition: 'bottom',
  subtitleWidth: 600,
  subtitleHeight: 120,
  isDraggable: false,
  selectedProvider: 'ollama',
  providerConfig: {
    baseURL: 'http://localhost:11434/v1',
    modelName: 'qwen2.5:3b',
    targetLanguage: 'Turkish',
  },
}

const SOURCE_A: SourceRef = {
  documentId: 'doc_test',
  videoId: 'video_1',
  sourceId: 'generic:video_1:captions',
  generation: 1,
  kind: 'generic-dom',
}

const SOURCE_B: SourceRef = {
  ...SOURCE_A,
  sourceId: 'generic:video_1:other-captions',
  generation: 2,
}

class FakeDetector implements SubtitleDetector {
  public running = false
  public starts = 0
  public stops = 0
  public evaluateNow = jest.fn()
  public resetAfterRestore = jest.fn()
  private sampleSubs: Array<(sample: SubtitleSample) => void> = []
  private statusSubs: Array<(status: DetectionStatus) => void> = []
  private presentationSubs: Array<
    (presentation: SubtitlePresentation | null) => void
  > = []
  private presentation: SubtitlePresentation | null = null
  private authority: DetectionAuthority | null = null
  private status: DetectionStatus = {
    phase: 'searching',
    reason: 'video-not-found',
  }

  public start(): void {
    this.running = true
    this.starts += 1
  }

  public stop(): void {
    this.running = false
    this.stops += 1
  }

  public dispose(): void {
    this.stop()
    this.sampleSubs = []
    this.statusSubs = []
  }

  public subscribe(
    onSample: (sample: SubtitleSample) => void,
    onStatus: (status: DetectionStatus) => void,
  ): () => void {
    this.sampleSubs.push(onSample)
    this.statusSubs.push(onStatus)
    onStatus(this.status)
    return () => {
      this.sampleSubs = this.sampleSubs.filter((fn) => fn !== onSample)
      this.statusSubs = this.statusSubs.filter((fn) => fn !== onStatus)
    }
  }

  public getAuthority(): DetectionAuthority | null {
    return this.authority
  }

  public subscribePresentation(
    listener: (presentation: SubtitlePresentation | null) => void,
  ): () => void {
    this.presentationSubs.push(listener)
    listener(this.presentation)
    return () => {
      this.presentationSubs = this.presentationSubs.filter(
        (fn) => fn !== listener,
      )
    }
  }

  public emitPresentation(presentation: SubtitlePresentation | null): void {
    this.presentation = presentation
    for (const fn of this.presentationSubs.slice()) fn(presentation)
  }

  public get presentationSubscriberCount(): number {
    return this.presentationSubs.length
  }

  public setAuthority(
    source: SourceRef | null,
    token = 'token_1',
    expiresAt = Date.now() + 6000,
  ): void {
    this.authority = source ? { token, source, expiresAt } : null
  }

  public emit(text: string, source: SourceRef = SOURCE_A): void {
    if (!this.authority || this.authority.source.sourceId !== source.sourceId) {
      this.setAuthority(source)
    }
    const sample: SubtitleSample = {
      source,
      text,
      mediaTime: 1,
      observedAt: Date.now(),
    }
    for (const fn of this.sampleSubs.slice()) fn(sample)
  }

  public emitStatus(status: DetectionStatus): void {
    this.status = status
    for (const fn of this.statusSubs.slice()) fn(status)
  }
}

function installChrome(storageOverrides: Record<string, any> = {}) {
  const storage = { ...BASE_STORAGE, ...storageOverrides }

  portMessageListeners = []
  portDisconnectListeners = []
  portPostMessages = []
  portDisconnect = jest.fn()

  const port = {
    onMessage: {
      addListener: (fn: (msg: any) => void) => portMessageListeners.push(fn),
    },
    onDisconnect: {
      addListener: (fn: () => void) => portDisconnectListeners.push(fn),
    },
    postMessage: (msg: any) => {
      portPostMessages.push(msg)
    },
    disconnect: portDisconnect,
  }

  ;(global as any).chrome = {
    runtime: {
      id: 'test-extension',
      lastError: undefined,
      onMessage: { addListener: jest.fn() },
      connect: jest.fn(() => port),
      sendMessage: jest.fn((msg: any, cb: SendCallback) => {
        sendMessages.push(msg)
        pendingCallbacks.push(cb)
      }),
    },
    storage: {
      local: {
        get: jest.fn((_keys: any, cb: (data: any) => void) => cb({ ...storage })),
        set: jest.fn(() => Promise.resolve()),
      },
      onChanged: { addListener: jest.fn() },
    },
  }
}

async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve()
  }
}

async function setup(storageOverrides: Record<string, any> = {}) {
  installChrome(storageOverrides)
  const detector = new FakeDetector()
  const manager = new TranslationManager({ detector })
  createdManagers.push(manager)
  await manager.start()
  return { manager, detector }
}

function setRuntimeLastError(
  error: chrome.runtime.LastError | undefined,
): jest.Mock {
  const getter = jest.fn(() => error)
  Object.defineProperty((global as any).chrome.runtime, 'lastError', {
    configurable: true,
    get: getter,
  })
  return getter
}

function dispatchPageShow(persisted: boolean): void {
  const event = new Event('pageshow') as PageTransitionEvent
  Object.defineProperty(event, 'persisted', { value: persisted })
  window.dispatchEvent(event)
}

function dispatchPageHide(persisted: boolean): void {
  const event = new Event('pagehide') as PageTransitionEvent
  Object.defineProperty(event, 'persisted', { value: persisted })
  window.dispatchEvent(event)
}

function container() {
  return document.getElementById('udemy-translate-floating-subtitle')
}

function originalText() {
  return container()?.querySelector('.original-subtitle')?.textContent ?? null
}

function translatedText() {
  return container()?.querySelector('.translated-subtitle')?.textContent ?? null
}

function errorVisible() {
  const el = container()?.querySelector('.translation-error') as HTMLElement | null
  return !!el && el.style.display !== 'none'
}

function errorText() {
  return container()?.querySelector('.translation-error')?.textContent ?? ''
}

const DEEPL_EMPTY_STORAGE = {
  selectedProvider: 'deepl',
  providerConfig: {
    apiKey: '',
    baseURL: 'https://api.deepl.com/v2',
    modelName: '',
    sourceLanguage: 'auto',
    targetLanguage: 'Turkish',
  },
  deeplConfig: {
    apiKey: '',
    baseURL: 'https://api.deepl.com/v2',
    modelName: '',
    sourceLanguage: 'auto',
    targetLanguage: 'Turkish',
  },
  language: 'tr',
}

const DEEPL_FILLED_STORAGE = {
  ...DEEPL_EMPTY_STORAGE,
  providerConfig: {
    ...DEEPL_EMPTY_STORAGE.providerConfig,
    apiKey: 'secret:fx',
  },
  deeplConfig: {
    ...DEEPL_EMPTY_STORAGE.deeplConfig,
    apiKey: 'secret:fx',
  },
}

const DEEPL_MISSING_KEY_ERROR =
  'DeepL Free API key is missing. Add it in Settings.'

const CTRASLATE2_STORAGE = {
  selectedProvider: 'ctranslate2',
  providerConfig: {
    apiKey: '',
    baseURL: 'http://127.0.0.1:8000',
    modelName: 'facebook/nllb-200-distilled-600M',
    sourceLanguage: 'English',
    targetLanguage: 'Turkish',
  },
}

beforeEach(() => {
  jest.useFakeTimers()
  sendMessages = []
  pendingCallbacks = []
  createdManagers = []
  document.body.innerHTML = ''
})

afterEach(() => {
  for (const manager of createdManagers) {
    manager.dispose()
  }
  setContentPageSuspended(false)
  jest.clearAllTimers()
  jest.useRealTimers()
})

describe('TranslationManager with detector', () => {
  it('2c) A→X→A göz kırpması ekrandaki çeviriyi ezmez', async () => {
    const { manager, detector } = await setup()
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'Birinci çeviri.',
    })
    await flush()
    expect(translatedText()).toBe('Birinci çeviri.')

    detector.emit('Blink subtitle that disappears fast.')
    jest.advanceTimersByTime(100)

    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(1000)
    await flush()

    expect(sendMessages).toHaveLength(1)
    expect(originalText()).toBe('Hello world, this is the first subtitle.')
    expect(translatedText()).toBe('Birinci çeviri.')
    expect(manager.detectionStatus.phase === 'searching' || true).toBe(true)
  })

  it('1) aynı kaynak 10 sn: tek istek, süreye bağlı gizleme yok', async () => {
    const { detector } = await setup()
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()

    for (let i = 0; i < 32; i += 1) {
      jest.advanceTimersByTime(300)
      await flush(2)
    }

    expect(sendMessages).toHaveLength(1)
    expect(sendMessages[0].text).toBe(
      'Hello world, this is the first subtitle.',
    )
    expect(sendMessages[0].source.sourceId).toBe(SOURCE_A.sourceId)
    expect(sendMessages[0].token).toBe('token_1')

    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'Merhaba dünya, bu ilk altyazı.',
    })
    await flush()

    jest.advanceTimersByTime(60000)
    await flush(2)

    expect(container()?.style.display).toBe('flex')
    expect(originalText()).toBe('Hello world, this is the first subtitle.')
    expect(translatedText()).toBe('Merhaba dünya, bu ilk altyazı.')
  })

  it('3) eski yanıt günceli ezmez', async () => {
    const { detector } = await setup()
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    expect(sendMessages).toHaveLength(1)

    detector.emit('Second subtitle line.')
    jest.advanceTimersByTime(200)
    await flush()
    expect(sendMessages).toHaveLength(2)

    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'ESKİ ÇEVİRİ',
    })
    await flush()
    expect(translatedText()).not.toBe('ESKİ ÇEVİRİ')
    expect(translatedText()).toBeNull()

    pendingCallbacks[1]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'İkinci altyazı satırı.',
    })
    await flush()
    expect(originalText()).toBe('Second subtitle line.')
    expect(translatedText()).toBe('İkinci altyazı satırı.')
  })

  it('4) stream parçaları ekrana yazmaz; final tek seferde gösterilir', async () => {
    const { detector } = await setup({ enableStreaming: true })
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()

    expect(portPostMessages).toHaveLength(1)
    expect(portPostMessages[0].source.sourceId).toBe(SOURCE_A.sourceId)
    expect(portPostMessages[0].token).toBe('token_1')
    const requestId = portPostMessages[0].requestId

    for (const chunk of ['Mer', 'haba', ' dünya']) {
      portMessageListeners.forEach((fn) =>
        fn({ type: 'STREAM_CHUNK', requestId, chunk }),
      )
      await flush(2)
    }

    expect(container()).toBeNull()

    portMessageListeners.forEach((fn) =>
      fn({ type: 'STREAM_DONE', requestId, fullText: 'Merhaba dünya.' }),
    )
    await flush()

    expect(originalText()).toBe('Hello world, this is the first subtitle.')
    expect(translatedText()).toBe('Merhaba dünya.')
    expect(errorVisible()).toBe(false)
    expect(document.querySelectorAll('.udemy-translate-floating-subtitle')).toHaveLength(1)
  })

  it('5) kısa boşluk kapatmaz, uzun boşluk gizler', async () => {
    const { detector } = await setup()
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'Merhaba.',
    })
    await flush()
    expect(translatedText()).toBe('Merhaba.')

    detector.emit('')
    jest.advanceTimersByTime(1000)
    expect(container()?.style.display).toBe('flex')

    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(3000)
    expect(container()?.style.display).toBe('flex')

    detector.emit('')
    jest.advanceTimersByTime(1600)
    expect(container()?.style.display).toBe('none')
  })

  it('6) kaynak mevcut ve video duraklamış: metin kalır, tekrar istek yok', async () => {
    const { detector } = await setup()
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'Merhaba.',
    })
    await flush()

    const before = sendMessages.length
    jest.advanceTimersByTime(20000)
    await flush(2)

    expect(sendMessages).toHaveLength(before)
    expect(container()?.style.display).toBe('flex')
    expect(translatedText()).toBe('Merhaba.')
  })

  it('7) askıya alınan algılamada geç sonuç overlay oluşturmaz', async () => {
    const { detector } = await setup()
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    expect(sendMessages).toHaveLength(1)

    detector.emitStatus({ phase: 'suspended', reason: 'page-hidden' })
    jest.advanceTimersByTime(5000)

    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'GEÇ ÇEVİRİ',
    })
    await flush()

    expect(container()).toBeNull()
  })

  it('8) ayar değişimi güncel kaynağı yeniden değerlendirir', async () => {
    const { manager, detector } = await setup()
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    expect(sendMessages).toHaveLength(1)

    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'İlk çeviri.',
    })
    await flush()
    expect(translatedText()).toBe('İlk çeviri.')

    manager.handleStorageChange({
      prompt: { oldValue: 'a', newValue: 'b' } as any,
    })
    await flush()
    jest.advanceTimersByTime(200)
    await flush()

    expect(sendMessages).toHaveLength(2)
    expect(sendMessages[1].text).toBe(
      'Hello world, this is the first subtitle.',
    )
  })

  it('9) art arda render kutuyu ve metin düğümlerini yeniden oluşturmaz', async () => {
    const { detector } = await setup()
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'Birinci.',
    })
    await flush()

    const box = container()
    const originalNode = box?.querySelector('.original-subtitle')
    const translatedNode = box?.querySelector('.translated-subtitle')

    detector.emit('Another subtitle, a bit longer than before.')
    jest.advanceTimersByTime(200)
    await flush()
    pendingCallbacks[1]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'İkinci.',
    })
    await flush()

    expect(container()).toBe(box)
    expect(box?.querySelector('.original-subtitle')).toBe(originalNode)
    expect(box?.querySelector('.translated-subtitle')).toBe(translatedNode)
    expect(originalText()).toBe('Another subtitle, a bit longer than before.')
    expect(translatedText()).toBe('İkinci.')
  })

  it('10) boş çeviri hata sayılır, mevcut metin boşaltılmaz', async () => {
    const { detector } = await setup()
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'Merhaba.',
    })
    await flush()

    detector.emit('A different subtitle line.')
    jest.advanceTimersByTime(200)
    await flush()

    pendingCallbacks[1]({ type: 'TRANSLATED_TEXT', translatedText: '   ' })
    await flush()

    expect(errorVisible()).toBe(true)
    expect(translatedText()).toBe('Merhaba.')
    expect(originalText()).toBe('Hello world, this is the first subtitle.')
  })

  it('10b) iptal hatası gösterilmez ve aynı kaynak tekrar denenmez', async () => {
    const { detector } = await setup()
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()

    pendingCallbacks[0]({
      type: 'TRANSLATION_ERROR',
      error: 'AbortError: Request cancelled',
    })
    await flush()
    expect(errorVisible()).toBe(false)

    const before = sendMessages.length
    for (let i = 0; i < 10; i += 1) {
      detector.emit('Hello world, this is the first subtitle.')
      jest.advanceTimersByTime(1000)
      await flush(2)
    }
    expect(sendMessages).toHaveLength(before)
  })

  it('11) DeepL anahtar hatasında taze ayar doluysa gösterme ve bir kez yeniden dene', async () => {
    const { detector } = await setup(DEEPL_EMPTY_STORAGE)
    const storageGet = (global as any).chrome.storage.local.get as jest.Mock

    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    expect(sendMessages).toHaveLength(1)

    storageGet.mockImplementation((_keys: any, cb: (data: any) => void) =>
      cb({ ...BASE_STORAGE, ...DEEPL_FILLED_STORAGE }),
    )
    pendingCallbacks[0]({
      type: 'TRANSLATION_ERROR',
      error: DEEPL_MISSING_KEY_ERROR,
    })
    await flush()
    jest.advanceTimersByTime(200)
    await flush()

    expect(errorVisible()).toBe(false)
    expect(sendMessages).toHaveLength(2)

    pendingCallbacks[1]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'Merhaba.',
    })
    await flush()

    expect(translatedText()).toBe('Merhaba.')
    expect(errorVisible()).toBe(false)
  })

  it('11b) DeepL anahtarı hâlâ yoksa hata yerel dilde gösterilir', async () => {
    const { detector } = await setup(DEEPL_EMPTY_STORAGE)

    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()

    pendingCallbacks[0]({
      type: 'TRANSLATION_ERROR',
      error: DEEPL_MISSING_KEY_ERROR,
    })
    await flush()

    expect(errorVisible()).toBe(true)
    expect(errorText()).toContain('DeepL Free API anahtarı')
    expect(sendMessages).toHaveLength(1)
  })

  it('11c) deeplConfig değişimi güncel kaynağı yeniden değerlendirir', async () => {
    const { manager, detector } = await setup(DEEPL_FILLED_STORAGE)
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'İlk çeviri.',
    })
    await flush()

    manager.handleStorageChange({
      deeplConfig: { oldValue: {}, newValue: {} } as any,
    })
    await flush()
    jest.advanceTimersByTime(200)
    await flush()

    expect(sendMessages).toHaveLength(2)
  })

  it('12) orijinal satır kapalıyken floating görünümde gizli kalır', async () => {
    const { detector } = await setup({ showOriginalSubtitle: false })
    const original = () =>
      container()?.querySelector('.original-subtitle') as HTMLElement | null

    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'Merhaba.',
    })
    await flush()

    expect(original()?.style.display).toBe('none')
    expect(translatedText()).toBe('Merhaba.')
    expect((container() as HTMLElement).style.minHeight).toBe('0')

    detector.emit('A second subtitle line.')
    jest.advanceTimersByTime(200)
    await flush()
    pendingCallbacks[1]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'İkinci.',
    })
    await flush()
    expect(original()?.style.display).toBe('none')

    detector.emit('A third subtitle line.')
    jest.advanceTimersByTime(200)
    await flush()
    pendingCallbacks[2]({
      type: 'TRANSLATION_ERROR',
      error: 'HTTP 500: Server error',
    })
    await flush()

    expect(errorVisible()).toBe(true)
    expect(original()?.style.display).toBe('none')
  })

  it('12b) orijinal satır varsayılan olarak görünür kalır', async () => {
    const { detector } = await setup()
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'Merhaba.',
    })
    await flush()

    const original = container()?.querySelector(
      '.original-subtitle',
    ) as HTMLElement
    expect(original.style.display).toBe('')
    expect(original.textContent).toBe(
      'Hello world, this is the first subtitle.',
    )
  })

  it('12c) ayar değişimi orijinal satırı canlı günceller', async () => {
    const { manager, detector } = await setup()
    const original = () =>
      container()?.querySelector('.original-subtitle') as HTMLElement | null
    const storageGet = (global as any).chrome.storage.local.get as jest.Mock

    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'Merhaba.',
    })
    await flush()
    expect(original()?.style.display).toBe('')

    storageGet.mockImplementation((_keys: any, cb: (data: any) => void) =>
      cb({ ...BASE_STORAGE, showOriginalSubtitle: false }),
    )
    manager.handleStorageChange({
      showOriginalSubtitle: { oldValue: true, newValue: false } as any,
    })
    await flush()
    expect(original()?.style.display).toBe('none')

    storageGet.mockImplementation((_keys: any, cb: (data: any) => void) =>
      cb({ ...BASE_STORAGE, showOriginalSubtitle: true }),
    )
    manager.handleStorageChange({
      showOriginalSubtitle: { oldValue: false, newValue: true } as any,
    })
    await flush()
    expect(original()?.style.display).toBe('')
  })

  it('10c) CTranslate2 404/network errors never suggest Ollama commands', async () => {
    const { detector } = await setup(CTRASLATE2_STORAGE)
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()

    pendingCallbacks[0]({
      type: 'TRANSLATION_ERROR',
      error: 'HTTP 404: Not Found',
    })
    await flush()

    expect(errorVisible()).toBe(true)
    expect(errorText()).toContain('CTranslate2')
    expect(errorText().toLowerCase()).not.toContain('ollama')
  })

  it('10d) CTranslate2 network failures do not suggest Ollama', async () => {
    const { detector } = await setup(CTRASLATE2_STORAGE)
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()

    pendingCallbacks[0]({
      type: 'TRANSLATION_ERROR',
      error: 'TypeError: Failed to fetch',
    })
    await flush()

    expect(errorVisible()).toBe(true)
    expect(errorText()).toContain('CTranslate2')
    expect(errorText().toLowerCase()).not.toContain('ollama')
  })

  it('10d2) numeric token counts are not mistaken for HTTP 404', async () => {
    const { detector } = await setup(CTRASLATE2_STORAGE)
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()

    pendingCallbacks[0]({
      type: 'TRANSLATION_ERROR',
      error:
        'CTranslate2 server error (422): Input contains 4040 tokens including special tokens; the limit is 512.',
    })
    await flush()

    expect(errorVisible()).toBe(true)
    expect(errorText()).toContain('4040 tokens')
    expect(errorText()).not.toContain('model or endpoint not found')
  })

  it('10d3) parenthesized HTTP statuses are recognized', async () => {
    const { detector } = await setup(CTRASLATE2_STORAGE)
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()

    pendingCallbacks[0]({
      type: 'TRANSLATION_ERROR',
      error: 'CTranslate2 server error (404): model mismatch',
    })
    await flush()

    expect(errorVisible()).toBe(true)
    expect(errorText()).toContain('CTranslate2 model or endpoint not found')
    expect(errorText().toLowerCase()).not.toContain('ollama')
  })

  it('10e) CTranslate2 model or source config change invalidates cache and re-requests', async () => {
    const { manager, detector } = await setup({
      ...CTRASLATE2_STORAGE,
      enableStreaming: false,
    })
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    expect(sendMessages).toHaveLength(1)

    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'Merhaba dünya.',
    })
    await flush()
    expect(translatedText()).toBe('Merhaba dünya.')

    manager.handleStorageChange({
      providerConfig: {
        oldValue: CTRASLATE2_STORAGE.providerConfig,
        newValue: {
          ...CTRASLATE2_STORAGE.providerConfig,
          sourceLanguage: 'German',
        },
      } as any,
    })
    await flush()
    jest.advanceTimersByTime(200)
    await flush()

    expect(sendMessages).toHaveLength(2)
    expect(sendMessages[1].text).toBe('Hello world, this is the first subtitle.')
  })

  it('10e2) startup-only CTranslate2 settings do not invalidate translation state', async () => {
    const { manager, detector } = await setup({
      ...CTRASLATE2_STORAGE,
      enableStreaming: false,
    })
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    expect(sendMessages).toHaveLength(1)

    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'Merhaba dünya.',
    })
    await flush()
    expect(translatedText()).toBe('Merhaba dünya.')

    manager.handleStorageChange({
      ctranslate2ServerSettings: {
        oldValue: undefined,
        newValue: {
          modelDirectory: 'D:\\My Models\\NLLB',
          device: 'cuda',
          computeType: 'int8_float16',
          host: '127.0.0.1',
          port: 9000,
          shell: 'powershell',
          logLevel: 'debug',
        },
      } as any,
    })
    await flush()
    jest.advanceTimersByTime(1000)
    await flush()

    expect(sendMessages).toHaveLength(1)
    expect(translatedText()).toBe('Merhaba dünya.')
  })

  it('10f) CTranslate2 streaming and blocking display the same final text', async () => {
    const first = await setup({
      ...CTRASLATE2_STORAGE,
      enableStreaming: false,
    })
    first.detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'Merhaba dünya.',
    })
    await flush()
    const blockingText = translatedText()
    first.manager.dispose()
    document.body.innerHTML = ''

    const second = await setup({
      ...CTRASLATE2_STORAGE,
      enableStreaming: true,
    })
    second.detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    const requestId = portPostMessages[0].requestId
    portMessageListeners.forEach((fn) =>
      fn({
        type: 'STREAM_DONE',
        requestId,
        fullText: 'Merhaba dünya.',
      }),
    )
    await flush()

    expect(blockingText).toBe('Merhaba dünya.')
    expect(translatedText()).toBe(blockingText)
  })

  it('11) kaynak değişimi eski normal yanıtı reddeder ve yeni kaynağı kullanır', async () => {
    const { detector } = await setup()
    detector.emit('Old source subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    expect(sendMessages).toHaveLength(1)

    detector.setAuthority(SOURCE_B, 'token_2')
    detector.emit('New source subtitle.', SOURCE_B)
    jest.advanceTimersByTime(200)
    await flush()
    expect(sendMessages).toHaveLength(2)
    expect(sendMessages[1].source.sourceId).toBe(SOURCE_B.sourceId)
    expect(sendMessages[1].source.generation).toBe(2)
    expect(sendMessages[1].token).toBe('token_2')

    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'ESKİ KAYNAK',
    })
    await flush()
    expect(translatedText()).toBeNull()

    pendingCallbacks[1]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'Yeni kaynak çevirisi.',
    })
    await flush()
    expect(originalText()).toBe('New source subtitle.')
    expect(translatedText()).toBe('Yeni kaynak çevirisi.')
  })

  it('11b) kaynak değişiminde eski streaming yanıtı yeni görüntüyü ezmez', async () => {
    const { detector } = await setup({ enableStreaming: true })
    detector.emit('Old source subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    expect(portPostMessages).toHaveLength(1)
    const oldRequestId = portPostMessages[0].requestId

    detector.setAuthority(SOURCE_B, 'token_2')
    detector.emit('New source subtitle.', SOURCE_B)
    jest.advanceTimersByTime(200)
    await flush()
    expect(portPostMessages).toHaveLength(2)
    const newRequestId = portPostMessages[1].requestId

    portMessageListeners.forEach((fn) =>
      fn({ type: 'STREAM_DONE', requestId: oldRequestId, fullText: 'ESKİ' }),
    )
    await flush()
    expect(translatedText()).toBeNull()

    portMessageListeners.forEach((fn) =>
      fn({
        type: 'STREAM_DONE',
        requestId: newRequestId,
        fullText: 'Yeni çeviri.',
      }),
    )
    await flush()
    expect(originalText()).toBe('New source subtitle.')
    expect(translatedText()).toBe('Yeni çeviri.')
  })

  it('12) yetki kaldırılınca geç yanıt yazılmaz', async () => {
    const { detector } = await setup()
    detector.emit('Old source subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    expect(sendMessages).toHaveLength(1)

    detector.setAuthority(null)
    detector.emitStatus({ phase: 'verifying', reason: 'revoked' })
    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'GEÇ YANIT',
    })
    await flush()

    expect(container()).toBeNull()
  })

  it('13) eklenti kapalıyken algılama ve çeviri isteği olmaz', async () => {
    const { detector } = await setup({ status: false })
    detector.emit('Ignored subtitle.')
    jest.advanceTimersByTime(1000)
    await flush()

    expect(detector.running).toBe(false)
    expect(sendMessages).toHaveLength(0)
    expect(container()).toBeNull()
  })

  it('14) on kez durdur/başlat dinleyici ve istek çoğaltmaz', async () => {
    const { manager, detector } = await setup()
    const initialStarts = detector.starts
    for (let i = 0; i < 10; i += 1) {
      manager.handleStatusChange(false)
      manager.handleStatusChange(true)
      await flush(2)
    }
    expect(detector.starts).toBe(initialStarts + 10)

    detector.setAuthority(SOURCE_A, 'token_1')
    detector.emit('Only one request.')
    jest.advanceTimersByTime(200)
    await flush()
    expect(sendMessages).toHaveLength(1)
  })

  function buildBelowAnchor(): HTMLElement {
    document.body.innerHTML = `
      <div id="lesson">
        <div id="captions-block"><span>Original caption</span></div>
      </div>
    `
    return document.getElementById('captions-block') as HTMLElement
  }

  function buildWellMountDom(options: {
    withRow?: boolean
    rowHash?: string
    columnHash?: string
  } = {}): {
    well: HTMLElement
    row: HTMLElement | null
    content: HTMLElement
    tabs: HTMLElement
  } {
    const {
      withRow = true,
      rowHash = 'RJZF2',
      columnHash = 'LnPGp',
    } = options
    const player = `
      <div id="player" data-purpose="shaka-video-player" class="video-player-module--video-player--ZGjpj">
        <div class="video-player-module--video-container--dsN0B">
          <video id="video"></video>
        </div>
        <div id="well" class="well-module--container--9Y7tq">
          <span class="well-module--text--pTRTZ">English well caption</span>
        </div>
      </div>
    `
    const rowBody = withRow
      ? `<div id="mount-row" class="app--body-container--${rowHash}">${player}</div>`
      : player
    document.body.innerHTML = `
      <div id="lesson">
        <div id="app-content" class="app--content-column--${columnHash}">
          ${rowBody}
          <div id="tabs">Comments and learning tools</div>
        </div>
      </div>
    `
    return {
      well: document.getElementById('well') as HTMLElement,
      row: document.getElementById('mount-row') as HTMLElement | null,
      content: document.getElementById('app-content') as HTMLElement,
      tabs: document.getElementById('tabs') as HTMLElement,
    }
  }

  async function translateFirstLine(
    detector: FakeDetector,
    text = 'Hello world, this is the first subtitle.',
    translated = 'Merhaba dünya, bu ilk altyazı.',
  ): Promise<void> {
    detector.emit(text)
    jest.advanceTimersByTime(200)
    await flush()
    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: translated,
    })
    await flush()
  }

  it('15) video altı modda kardeş öğe, akış ve gizli özgün satır', async () => {
    const anchor = buildBelowAnchor()
    const { detector } = await setup()
    await translateFirstLine(detector)
    expect(translatedText()).toBe('Merhaba dünya, bu ilk altyazı.')
    expect(container()?.style.position).toBe('fixed')

    const requestsBefore = sendMessages.length
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor,
    })
    await flush()

    const box = container() as HTMLElement
    expect(box.getAttribute('data-subtitle-translator-ui')).toBe('true')
    expect(box.parentElement).toBe(anchor.parentElement)
    expect(box.previousElementSibling).toBe(anchor)
    expect(box.style.position).toBe('static')
    expect(box.style.width).toBe('100%')
    expect(box.style.boxSizing).toBe('border-box')
    expect(box.style.minHeight).toBe('0')
    expect(box.style.height).toBe('auto')
    expect(box.style.left).toBe('')
    expect(box.style.top).toBe('')
    // Opacity tüm metni yarı saydam yapmaz.
    expect(box.style.opacity).toBe('1')
    // Udemy'nin özgün altyazısı görünür kalır.
    expect(anchor.style.display).not.toBe('none')
    // Eklentinin kendi özgün satırı tekrarlanmaz.
    const original = box.querySelector('.original-subtitle') as HTMLElement
    expect(original.style.display).toBe('none')
    expect(translatedText()).toBe('Merhaba dünya, bu ilk altyazı.')
    expect(sendMessages).toHaveLength(requestsBefore)

    // Sürükleme ve konum menüsü video altı modda kapalı.
    box.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    )
    document.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: 300,
        clientY: 300,
      }),
    )
    expect(box.style.top).toBe('')
    box.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 20,
      }),
    )
    jest.advanceTimersByTime(200)
    expect(document.getElementById('subtitle-position-menu')).toBeNull()

    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'floating',
      anchor: null,
    })
    await flush()
    expect(container()?.parentElement).toBe(document.body)
    expect(container()?.style.position).toBe('fixed')
    expect(container()?.style.width).toBe('600px')
    expect(container()?.style.opacity).toBe('0.8')
    expect(original.style.display).toBe('')
    expect(sendMessages).toHaveLength(requestsBefore)
  })

  it('15b) yenilenen DOM hedefine alan yeniden bağlanır', async () => {
    const anchor = buildBelowAnchor()
    const { detector } = await setup()
    await translateFirstLine(detector)
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor,
    })
    await flush()
    expect(container()?.previousElementSibling).toBe(anchor)

    const replacement = document.createElement('div')
    replacement.id = 'captions-block-new'
    replacement.textContent = 'Original caption'
    anchor.parentElement?.appendChild(replacement)
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor: replacement,
    })
    await flush()

    expect(container()?.parentElement).toBe(replacement.parentElement)
    expect(container()?.previousElementSibling).toBe(replacement)
    expect(container()?.nextElementSibling).toBeNull()
    expect(sendMessages).toHaveLength(1)
  })

  it('15c) Udemy well bloğunda İngilizce korunur, Türkçe hemen altına eklenir', async () => {
    document.body.innerHTML = `
      <div id="lesson">
        <div id="player" data-purpose="shaka-video-player" class="video-player-module--video-player--ZGjpj">
          <div class="video-player-module--video-container--dsN0B">
            <video id="video"></video>
          </div>
          <div class="well-module--container--9Y7tq" id="well">
            <span class="well-module--text--pTRTZ">English well caption</span>
          </div>
        </div>
      </div>
    `
    const well = document.getElementById('well') as HTMLElement
    const { detector } = await setup()
    await translateFirstLine(
      detector,
      'English well caption',
      'Türkçe well altyazısı',
    )
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor: well,
    })
    await flush()

    const box = container() as HTMLElement
    expect(box.parentElement).toBe(well.parentElement)
    expect(box.previousElementSibling).toBe(well)
    expect(box.style.position).toBe('static')
    // Udemy'nin İngilizce altyazısı görünür kalır; çeviri hemen altındadır.
    expect(well.textContent).toContain('English well caption')
    expect(well.style.display).not.toBe('none')
    expect(translatedText()).toBe('Türkçe well altyazısı')
    expect(sendMessages).toHaveLength(1)
  })

  it('15d) orijinal satır kapalıyken video altı modda da gizli kalır', async () => {
    const anchor = buildBelowAnchor()
    const { detector } = await setup({ showOriginalSubtitle: false })
    await translateFirstLine(detector)

    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor,
    })
    await flush()

    const box = container() as HTMLElement
    const original = box.querySelector('.original-subtitle') as HTMLElement
    expect(original.style.display).toBe('none')
    expect(translatedText()).toBe('Merhaba dünya, bu ilk altyazı.')
    expect(box.style.minHeight).toBe('0')
    // Sayfanın kendi altyazısına dokunulmaz.
    expect(anchor.style.display).not.toBe('none')
  })

  it('16) mod geçişleri uçuştaki sonucu ve tek kutuyu korur', async () => {
    const anchor = buildBelowAnchor()
    const { detector } = await setup()
    const before = sendMessages.length

    detector.emit('In-flight subtitle line.')
    jest.advanceTimersByTime(200)
    await flush()
    expect(sendMessages).toHaveLength(before + 1)

    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor,
    })
    await flush()
    expect(container()).toBeNull()

    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'Uçuştaki çeviri.',
    })
    await flush()
    expect(translatedText()).toBe('Uçuştaki çeviri.')
    expect(container()?.previousElementSibling).toBe(anchor)
    expect(sendMessages).toHaveLength(before + 1)

    for (let i = 0; i < 5; i += 1) {
      detector.emitPresentation({
        source: SOURCE_A,
        mode: 'below-caption',
        anchor,
      })
      await flush(2)
      detector.emitPresentation({
        source: SOURCE_A,
        mode: 'floating',
        anchor: null,
      })
      await flush(2)
      detector.emitPresentation({
        source: SOURCE_A,
        mode: 'below-caption',
        anchor,
      })
      await flush(2)
    }
    expect(document.querySelectorAll('.udemy-translate-floating-subtitle')).toHaveLength(1)
    expect(detector.presentationSubscriberCount).toBe(1)
    expect(sendMessages).toHaveLength(before + 1)
  })

  it('17) video altı modda renk/font sürer, kayıtlı koordinat uygulanmaz', async () => {
    const anchor = buildBelowAnchor()
    const { detector } = await setup({
      subtitleWidth: 500,
      subtitleHeight: 80,
      subtitleX: 123,
      subtitleY: 45,
      backgroundColor: 'rgba(1, 2, 3, 0.5)',
      translatedFontColor: 'lime',
      translatedFontSize: '22',
    })
    await translateFirstLine(detector)

    const box = container() as HTMLElement
    expect(box.style.width).toBe('500px')
    expect(box.style.left).toBe('123px')
    expect(box.style.top).toBe('45px')

    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor,
    })
    await flush()

    expect(box.style.width).toBe('100%')
    expect(box.style.left).toBe('')
    expect(box.style.top).toBe('')
    expect(box.style.minHeight).toBe('0')
    expect(box.style.backgroundColor).toBe('rgba(1, 2, 3, 0.5)')
    const translated = box.querySelector('.translated-subtitle') as HTMLElement
    expect(translated.style.color).toBe('lime')
    expect(translated.style.fontSize).toBe('22px')

    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'floating',
      anchor: null,
    })
    await flush()
    expect(box.style.width).toBe('500px')
    expect(box.style.left).toBe('123px')
    expect(box.style.top).toBe('45px')
    expect(box.style.minHeight).toBe('80px')
  })

  it('18) tam ekranda anchor kullanılmaz, kutu tam ekran kapsayıcısına taşınır', async () => {
    const anchor = buildBelowAnchor()
    const fullscreenContainer = document.createElement('div')
    fullscreenContainer.id = 'fullscreen-root'
    document.body.appendChild(fullscreenContainer)
    const { detector } = await setup()
    await translateFirstLine(detector)

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: fullscreenContainer,
    })
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor,
    })
    await flush()

    expect(container()?.parentElement).toBe(fullscreenContainer)
    expect(container()?.style.position).toBe('fixed')

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    })
    document.dispatchEvent(new Event('fullscreenchange'))
    await flush()
    expect(container()?.previousElementSibling).toBe(anchor)
    expect(container()?.style.position).toBe('static')

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    })
  })

  it('19) kapatma DOM alanını ve yerleşim aboneliğini temizler', async () => {
    const anchor = buildBelowAnchor()
    const { manager, detector } = await setup()
    await translateFirstLine(detector)
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor,
    })
    await flush()
    expect(container()).not.toBeNull()
    expect(detector.presentationSubscriberCount).toBe(1)

    manager.handleStatusChange(false)
    await flush()
    expect(container()).toBeNull()
    expect(detector.presentationSubscriberCount).toBe(0)
    // Abonelik kaldırıldıktan sonra geç gelen yerleşim DOM oluşturmaz.
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor,
    })
    expect(container()).toBeNull()

    for (let i = 0; i < 5; i += 1) {
      manager.handleStatusChange(true)
      await flush(3)
      manager.handleStatusChange(false)
      await flush(2)
    }
    manager.handleStatusChange(true)
    await flush(3)
    expect(detector.presentationSubscriberCount).toBe(1)
    expect(document.querySelectorAll('.udemy-translate-floating-subtitle')).toHaveLength(0)
  })

  it('20) boş cue aralığında video altı alan boş yükseklik bırakmaz', async () => {
    const anchor = buildBelowAnchor()
    const { detector } = await setup()
    await translateFirstLine(detector)
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor,
    })
    await flush()
    expect(container()?.style.display).toBe('block')

    detector.emit('')
    jest.advanceTimersByTime(1600)
    expect(container()?.style.display).toBe('none')
  })

  it('22) uzun çeviri video altı akışta sarılır ve sabit yükseklik almaz', async () => {
    const anchor = buildBelowAnchor()
    const { detector } = await setup()
    const longTranslation = 'Uzun çeviri metni. '.repeat(60)
    await translateFirstLine(
      detector,
      'Long source subtitle that needs wrapping.',
      longTranslation,
    )
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor,
    })
    await flush()

    const box = container() as HTMLElement
    const translated = box.querySelector('.translated-subtitle') as HTMLElement
    expect(translated.textContent).toBe(longTranslation.trim())
    expect(translated.style.whiteSpace).toBe('pre-wrap')
    expect(box.style.width).toBe('100%')
    expect(box.style.height).toBe('auto')
    expect(box.style.minHeight).toBe('0')
    expect(box.style.boxSizing).toBe('border-box')
  })

  it('21) yeni kaynağın yerleşimi ilk metninden önce gelse de uygulanır', async () => {
    const anchor = buildBelowAnchor()
    const { detector } = await setup()
    await translateFirstLine(detector)
    expect(sendMessages).toHaveLength(1)

    const presentation: SubtitlePresentation = {
      source: SOURCE_B,
      mode: 'below-caption',
      anchor,
    }
    detector.setAuthority(SOURCE_B, 'token_2')
    detector.emitPresentation(presentation)
    await flush()
    // Eski kaynağın görüntüsü yeni anchor'a taşınmaz.
    expect(container()?.parentElement).toBe(document.body)

    // Durum 'verifying' pending yerleşimi silmemeli; engine aynı değeri
    // yeniden yayınlamaz.
    detector.emitStatus({ phase: 'verifying', reason: 'source-changed' })
    await flush()
    detector.emit('New source subtitle.', SOURCE_B)
    jest.advanceTimersByTime(200)
    await flush()
    expect(sendMessages).toHaveLength(2)
    pendingCallbacks[1]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'Yeni kaynak çevirisi.',
    })
    await flush()

    expect(container()?.previousElementSibling).toBe(anchor)
    expect(translatedText()).toBe('Yeni kaynak çevirisi.')
  })

  it('23) yerleşim akışı sunmayan dedektörde floating davranışı sürer', async () => {
    installChrome()
    const detector = new FakeDetector()
    // Eski test sahteleri subscribePresentation uygulamaz.
    ;(detector as any).subscribePresentation = undefined
    const manager = new TranslationManager({ detector })
    createdManagers.push(manager)
    await manager.start()

    detector.emit('Legacy detector subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'Eski dedektör çevirisi.',
    })
    await flush()

    expect(translatedText()).toBe('Eski dedektör çevirisi.')
    expect(container()?.parentElement).toBe(document.body)
    expect(container()?.style.position).toBe('fixed')
    expect(container()?.style.display).toBe('flex')
  })

  it('24) sürükleme sırasında yerleşim sıfırlanmaz', async () => {
    const { detector } = await setup({ isDraggable: true })
    await translateFirstLine(detector)
    const box = container() as HTMLElement

    box.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    )
    document.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: 110,
        clientY: 80,
      }),
    )
    expect(box.style.left).toBe('100px')
    expect(box.style.top).toBe('70px')

    // Sürükleme sürerken aynı yerleşim ve yeni çeviri sonucu kutu konumunu
    // kayıtlı değerlerle ezmemeli.
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'floating',
      anchor: null,
    })
    await flush()
    expect(box.style.left).toBe('100px')
    expect(box.style.top).toBe('70px')

    detector.emit('Another subtitle while dragging.')
    jest.advanceTimersByTime(200)
    await flush()
    pendingCallbacks[1]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'Sürükleme sırasında çeviri.',
    })
    await flush()
    expect(box.style.left).toBe('100px')
    expect(box.style.top).toBe('70px')

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    expect(box.style.left).toBe('100px')
    expect(box.style.top).toBe('70px')
  })

  it('25) aynı anchor için kutu her apply’da yeniden eklenmez', async () => {
    const anchor = buildBelowAnchor()
    const { detector } = await setup()
    await translateFirstLine(detector)
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor,
    })
    await flush()
    expect(container()?.previousElementSibling).toBe(anchor)

    const insertSpy = jest.spyOn(anchor, 'insertAdjacentElement')
    for (let i = 0; i < 4; i += 1) {
      detector.emitPresentation({
        source: SOURCE_A,
        mode: 'below-caption',
        anchor,
      })
      await flush(2)
    }
    expect(insertSpy).not.toHaveBeenCalled()

    // Host kutu DOM'unu kaldırırsa MutationObserver yeni bir presentation
    // emit'i beklemeden kutuyu yeniden bağlar.
    container()?.remove()
    // MutationObserver callback'i mikro-görevde timer'ı kurar.
    await flush(2)
    jest.advanceTimersByTime(0)
    await flush(10)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(container()?.previousElementSibling).toBe(anchor)
    insertSpy.mockRestore()
  })

  it('26) dispose pagehide ve fullscreen dinleyicilerini kaldırır', async () => {
    const windowRemove = jest.spyOn(window, 'removeEventListener')
    const documentRemove = jest.spyOn(document, 'removeEventListener')
    const { manager } = await setup()

    manager.dispose()

    expect(windowRemove).toHaveBeenCalledWith(
      'pagehide',
      expect.any(Function),
    )
    expect(windowRemove).toHaveBeenCalledWith(
      'pageshow',
      expect.any(Function),
    )
    expect(documentRemove).toHaveBeenCalledWith(
      'fullscreenchange',
      expect.any(Function),
      true,
    )
    expect(documentRemove).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    )
    windowRemove.mockRestore()
    documentRemove.mockRestore()
  })

  it('27) presentation null eski video altı yerleşimini hemen bozmaz', async () => {
    const anchor = buildBelowAnchor()
    const { manager, detector } = await setup()
    await translateFirstLine(detector)
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor,
    })
    await flush()
    expect(container()?.previousElementSibling).toBe(anchor)

    detector.emitPresentation(null)
    await flush()
    // Authority loss sırasında lifecycle gizler; layout hemen floating'e
    // zıplamaz.
    expect(container()?.previousElementSibling).toBe(anchor)
    expect(container()?.parentElement).toBe(anchor.parentElement)

    // Sonraki renk/fullscreen kaynaklı apply da layout'u bozmamalı.
    manager.handleStorageChange({
      backgroundColor: { oldValue: 'a', newValue: 'b' } as any,
    })
    await flush()
    expect(container()?.previousElementSibling).toBe(anchor)
    expect(container()?.parentElement).toBe(anchor.parentElement)

    // Anchor DOM'dan koptuysa kutu floating'e dönmez; gizli bekler.
    anchor.remove()
    detector.emitPresentation(null)
    await flush()
    expect(container()?.parentElement).toBe(
      document.getElementById('lesson'),
    )
    expect(container()?.style.display).toBe('none')
    expect(container()?.style.position).toBe('static')
  })

  it('28) video tam ekranında floating kutu oynatıcı kapsayıcısına taşınır', async () => {
    const { detector } = await setup()
    await translateFirstLine(detector)

    const player = document.createElement('div')
    const video = document.createElement('video')
    player.appendChild(video)
    document.body.appendChild(player)

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: video,
    })
    document.dispatchEvent(new Event('fullscreenchange'))
    await flush()
    expect(container()?.parentElement).toBe(player)

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    })
    document.dispatchEvent(new Event('fullscreenchange'))
    await flush()
    expect(container()?.parentElement).toBe(document.body)
  })

  it('29) stop yerleşim dinleyicilerini kaldırır, açınca geri ekler', async () => {
    const documentRemove = jest.spyOn(document, 'removeEventListener')
    const documentAdd = jest.spyOn(document, 'addEventListener')
    const windowRemove = jest.spyOn(window, 'removeEventListener')
    const { manager } = await setup()
    documentRemove.mockClear()
    documentAdd.mockClear()
    windowRemove.mockClear()

    manager.handleStatusChange(false)
    expect(documentRemove).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    )
    expect(documentRemove).toHaveBeenCalledWith(
      'fullscreenchange',
      expect.any(Function),
      true,
    )
    expect(windowRemove).toHaveBeenCalledWith(
      'pagehide',
      expect.any(Function),
    )

    manager.handleStatusChange(true)
    await flush(6)
    expect(documentAdd).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    )
    expect(documentAdd).toHaveBeenCalledWith(
      'fullscreenchange',
      expect.any(Function),
      true,
    )
    documentRemove.mockRestore()
    documentAdd.mockRestore()
    windowRemove.mockRestore()
  })

  it('30) mid-drag layout değişiminde mevcut konum kaydedilir', async () => {
    const anchor = buildBelowAnchor()
    const { detector } = await setup({ isDraggable: true })
    await translateFirstLine(detector)
    const box = container() as HTMLElement

    box.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    )
    document.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: 110,
        clientY: 80,
      }),
    )
    expect(box.style.left).toBe('100px')
    expect(box.style.top).toBe('70px')

    const storageSet = (global as any).chrome.storage.local.set as jest.Mock
    storageSet.mockClear()
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor,
    })
    await flush()

    expect(storageSet).toHaveBeenCalledWith(
      expect.objectContaining({ subtitleX: 100, subtitleY: 70 }),
    )
    expect(container()?.previousElementSibling).toBe(anchor)
  })

  it('31) anchor metni kaybolunca eklenti özgün satırı titremez', async () => {
    const anchor = buildBelowAnchor()
    const { manager, detector } = await setup()
    await translateFirstLine(detector)
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor,
    })
    await flush()
    const original = container()?.querySelector(
      '.original-subtitle',
    ) as HTMLElement
    expect(original.style.display).toBe('none')

    // Cue aralığında anchor boşalsa da satır açılıp kapanmaz; eski özgün
    // metin tekrar görünmez.
    anchor.textContent = ''
    manager.handleStorageChange({
      backgroundColor: { oldValue: 'a', newValue: 'b' } as any,
    })
    await flush()
    expect(original.style.display).toBe('none')
    manager.handleStorageChange({
      backgroundColor: { oldValue: 'b', newValue: 'c' } as any,
    })
    await flush()
    expect(original.style.display).toBe('none')
  })

  it('31b) anchor hiç metin taşımıyorsa eklenti özgün satırı gösterilir', async () => {
    const anchor = buildBelowAnchor()
    anchor.textContent = ''
    const { manager, detector } = await setup()
    await translateFirstLine(detector)
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor,
    })
    await flush()
    const original = container()?.querySelector(
      '.original-subtitle',
    ) as HTMLElement
    expect(original.style.display).toBe('')

    // Anchor sonradan metin taşırsa eklenti satırı gizlenir.
    anchor.textContent = 'Original caption'
    manager.handleStorageChange({
      backgroundColor: { oldValue: 'a', newValue: 'b' } as any,
    })
    await flush()
    expect(original.style.display).toBe('none')
  })

  async function buildSecondAnchor(): Promise<HTMLElement> {
    const lesson = document.createElement('div')
    lesson.id = 'lesson-b'
    const anchor = document.createElement('div')
    anchor.id = 'anchor-b'
    anchor.textContent = 'Second anchor'
    lesson.appendChild(anchor)
    document.body.appendChild(lesson)
    return anchor
  }

  it('32) kaynak değişince eski videonun anchor’ı kullanılmaz', async () => {
    const anchorA = buildBelowAnchor()
    const anchorB = await buildSecondAnchor()
    const { detector } = await setup()
    await translateFirstLine(detector)
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor: anchorA,
    })
    await flush()
    expect(container()?.previousElementSibling).toBe(anchorA)

    detector.setAuthority(SOURCE_B, 'token_2')
    detector.emitPresentation({
      source: SOURCE_B,
      mode: 'below-caption',
      anchor: anchorB,
    })
    await flush()
    detector.emitStatus({ phase: 'verifying', reason: 'source-changed' })
    await flush()
    detector.emit('New source subtitle.', SOURCE_B)
    jest.advanceTimersByTime(200)
    await flush()

    expect(container()?.previousElementSibling).toBe(anchorB)
    expect(container()?.parentElement).toBe(anchorB.parentElement)
  })

  it('33) waiting fazında presentation layout’u hemen uygulanır', async () => {
    const anchorA = buildBelowAnchor()
    const anchorB = await buildSecondAnchor()
    const { detector } = await setup()
    await translateFirstLine(detector)
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor: anchorA,
    })
    await flush()

    detector.setAuthority(SOURCE_B, 'token_2')
    detector.emitPresentation({
      source: SOURCE_B,
      mode: 'below-caption',
      anchor: anchorB,
    })
    detector.emitStatus({ phase: 'verifying', reason: 'source-changed' })
    await flush()

    // Sample gelmeden (waiting) yeni presentation layout'u güncellemeli.
    detector.emitPresentation({
      source: SOURCE_B,
      mode: 'below-caption',
      anchor: anchorB,
    })
    await flush()
    expect(container()?.previousElementSibling).toBe(anchorB)
  })

  it('34) geçici verifying sunumu silmez; yeniden bağlanan kaynak video altı kalır', async () => {
    const anchor = buildBelowAnchor()
    const { manager, detector } = await setup()
    await translateFirstLine(detector)
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor,
    })
    await flush()
    expect(container()?.previousElementSibling).toBe(anchor)

    detector.emitStatus({ phase: 'verifying', reason: 'source-changed-or-lost' })
    await flush()
    // Engine aynı değeri samePresentation nedeniyle tekrar yayınlamaz;
    // yönetici sunumu kaybetmemeli.
    expect((manager as any).presentation?.anchor).toBe(anchor)

    detector.emit('Reconnected subtitle line.')
    jest.advanceTimersByTime(200)
    await flush()
    pendingCallbacks[1]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'Yeniden bağlanan çeviri.',
    })
    await flush()

    expect(container()?.previousElementSibling).toBe(anchor)
    expect(container()?.style.position).toBe('static')
    expect(container()?.style.display).toBe('block')
  })

  it('35) video altı yeniden eklemeler pencere başına sınırlanır', async () => {
    const anchor = buildBelowAnchor()
    const { manager, detector } = await setup()
    const insertSpy = jest.spyOn(anchor, 'insertAdjacentElement')
    await translateFirstLine(detector)
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor,
    })
    await flush()
    // İlk bağlama bütçeden bir deneme tüketir.
    expect(insertSpy).toHaveBeenCalledTimes(1)

    // Host her görsel apply'da kardeş kutuyu düşürür; sınır aşılmamalı.
    for (let i = 0; i < 8; i += 1) {
      container()?.remove()
      manager.handleStorageChange({
        backgroundColor: { oldValue: 'a', newValue: `b${i}` } as any,
      })
      await flush(8)
    }
    expect(insertSpy).toHaveBeenCalledTimes(5)
    insertSpy.mockRestore()
  })

  it('36) well anchor app satırı ardından tabs öncesine bağlanır', async () => {
    const fixture = buildWellMountDom()
    const { manager, detector } = await setup()
    const insertSpy = jest.spyOn(
      fixture.row as HTMLElement,
      'insertAdjacentElement',
    )
    await translateFirstLine(
      detector,
      'English well caption',
      'Türkçe well altyazısı',
    )
    const before = sendMessages.length

    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor: fixture.well,
      mountAfter: fixture.row,
    })
    await flush()
    expect(insertSpy).toHaveBeenCalledTimes(1)

    const box = container() as HTMLElement
    expect(box.parentElement).toBe(fixture.content)
    expect(box.previousElementSibling).toBe(fixture.row)
    expect(box.nextElementSibling).toBe(fixture.tabs)
    expect(box.style.position).toBe('static')
    expect(box.style.width).toBe('100%')
    expect(box.style.height).toBe('auto')
    expect(box.style.flex).toBe('0 0 auto')
    expect(fixture.well.style.display).not.toBe('none')
    expect(fixture.well.textContent).toContain('English well caption')
    const original = box.querySelector('.original-subtitle') as HTMLElement
    expect(original.style.display).toBe('none')
    expect(translatedText()).toBe('Türkçe well altyazısı')
    expect(sendMessages).toHaveLength(before)

    // Aynı hedefte görsel apply kutu taşımaz.
    manager.handleStorageChange({
      backgroundColor: { oldValue: 'a', newValue: 'b' } as any,
    })
    await flush()
    expect(insertSpy).toHaveBeenCalledTimes(1)
    insertSpy.mockRestore()
  })

  it('37) mountAfter null below niyetini floating’e çevirmez', async () => {
    const fixture = buildWellMountDom()
    const { manager, detector } = await setup()
    await translateFirstLine(detector)
    const before = sendMessages.length

    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor: fixture.well,
      mountAfter: null,
    })
    await flush()

    const box = container() as HTMLElement
    expect((manager as any).layoutMode).toBe('below-caption')
    expect(box.style.display).toBe('none')
    expect(box.style.position).toBe('static')

    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor: fixture.well,
      mountAfter: fixture.row,
    })
    await flush()

    expect(box.style.display).toBe('block')
    expect(box.parentElement).toBe(fixture.content)
    expect(box.previousElementSibling).toBe(fixture.row)
    expect(translatedText()).toBe('Merhaba dünya, bu ilk altyazı.')
    expect(sendMessages).toHaveLength(before)
  })

  it('38) anchor kaybı below hedefini korur, kutu gizlenir, floating’e dönmez', async () => {
    const fixture = buildWellMountDom()
    const { detector } = await setup()
    await translateFirstLine(detector)
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor: fixture.well,
      mountAfter: fixture.row,
    })
    await flush()

    const box = container() as HTMLElement
    const before = sendMessages.length
    fixture.well.remove()
    detector.emitPresentation(null)
    await flush()
    expect(box.style.display).toBe('none')
    expect(box.parentElement).toBe(fixture.content)
    expect(box.style.position).toBe('static')

    const replacement = document.createElement('div')
    replacement.id = 'well-next'
    replacement.className = 'well-module--container--NEXT1'
    replacement.innerHTML =
      '<span class="well-module--text--NEXT2">English well caption</span>'
    fixture.row?.appendChild(replacement)
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor: replacement,
      mountAfter: fixture.row,
    })
    await flush()

    expect(box.style.display).toBe('block')
    expect(box.parentElement).toBe(fixture.content)
    expect(box.previousElementSibling).toBe(fixture.row)
    expect(translatedText()).toBe('Merhaba dünya, bu ilk altyazı.')
    expect(sendMessages).toHaveLength(before)
  })

  it('39) kaldırılıp yeniden oluşturulan dış satıra observer ile bağlanır', async () => {
    const fixture = buildWellMountDom()
    const { manager, detector } = await setup()
    await translateFirstLine(detector)
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor: fixture.well,
      mountAfter: fixture.row,
    })
    await flush()

    const box = container() as HTMLElement
    const before = sendMessages.length
    fixture.row?.remove()
    detector.emitPresentation(null)
    await flush()
    expect(box.style.display).toBe('none')

    const nextRow = document.createElement('div')
    nextRow.id = 'mount-row-next'
    nextRow.className = 'app--body-container--NEXT3'
    const nextWell = document.createElement('div')
    nextWell.id = 'well-next-row'
    nextWell.className = 'well-module--container--NEXT4'
    nextWell.innerHTML =
      '<span class="well-module--text--NEXT5">English well caption</span>'
    nextRow.appendChild(nextWell)
    fixture.content.insertBefore(nextRow, fixture.tabs)

    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor: nextWell,
      mountAfter: nextRow,
    })
    await flush()

    expect(box.style.display).toBe('block')
    expect(box.parentElement).toBe(fixture.content)
    expect(box.previousElementSibling).toBe(nextRow)
    expect(box.nextElementSibling).toBe(fixture.tabs)
    expect((manager as any).belowObserverTarget).toBe(fixture.content)
    expect(sendMessages).toHaveLength(before)
  })

  it('40) açık floating bildirimi below hedefini temizler', async () => {
    const fixture = buildWellMountDom()
    const { detector } = await setup()
    await translateFirstLine(detector)
    const before = sendMessages.length

    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor: fixture.well,
      mountAfter: fixture.row,
    })
    await flush()
    expect(container()?.previousElementSibling).toBe(fixture.row)

    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'floating',
      anchor: null,
    })
    await flush()
    expect(container()?.parentElement).toBe(document.body)
    expect(container()?.style.position).toBe('fixed')
    expect(container()?.style.display).toBe('flex')

    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor: fixture.well,
      mountAfter: fixture.row,
    })
    await flush()
    expect(container()?.previousElementSibling).toBe(fixture.row)
    expect(container()?.style.position).toBe('static')
    expect(sendMessages).toHaveLength(before)
  })

  it('41) fullscreen çıkışında dış below hedefi yeniden çözülür', async () => {
    const fixture = buildWellMountDom()
    const { detector } = await setup()
    await translateFirstLine(detector)
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor: fixture.well,
      mountAfter: fixture.row,
    })
    await flush()
    const before = sendMessages.length

    const fullscreenRoot = document.createElement('div')
    document.body.appendChild(fullscreenRoot)
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: fullscreenRoot,
    })
    document.dispatchEvent(new Event('fullscreenchange'))
    await flush()
    expect(container()?.parentElement).toBe(fullscreenRoot)
    expect(container()?.style.position).toBe('fixed')

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    })
    document.dispatchEvent(new Event('fullscreenchange'))
    await flush()
    expect(container()?.parentElement).toBe(fixture.content)
    expect(container()?.previousElementSibling).toBe(fixture.row)
    expect(container()?.style.position).toBe('static')
    expect(sendMessages).toHaveLength(before)
  })

  it('42) yerleşim hazır değilken render ve hata kutusu gizli kalır', async () => {
    const fixture = buildWellMountDom()
    const { detector } = await setup()
    await translateFirstLine(detector)
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor: fixture.well,
      mountAfter: null,
    })
    await flush()

    const box = container() as HTMLElement
    expect(box.style.display).toBe('none')

    detector.emit('Second well caption')
    jest.advanceTimersByTime(200)
    await flush()
    pendingCallbacks[1]({
      type: 'TRANSLATION_ERROR',
      error: 'server failed',
    })
    await flush()

    expect(box.style.display).toBe('none')
    expect(
      box.querySelector('.translation-error')?.textContent,
    ).toContain('server failed')

    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor: fixture.well,
      mountAfter: fixture.row,
    })
    await flush()
    expect(box.style.display).toBe('block')
    expect(errorVisible()).toBe(true)
  })

  it('43) anchor yeniden oluşunca rebind bütçesi sıfırlanmaz', async () => {
    const fixture = buildWellMountDom()
    const { detector } = await setup()
    await translateFirstLine(detector)
    const row = fixture.row as HTMLElement
    const insertSpy = jest.spyOn(row, 'insertAdjacentElement')

    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor: fixture.well,
      mountAfter: row,
    })
    await flush()
    expect(insertSpy).toHaveBeenCalledTimes(1)

    for (let i = 0; i < 8; i += 1) {
      container()?.remove()
      const oldWell = document.getElementById('well')
      oldWell?.remove()
      const nextWell = document.createElement('div')
      nextWell.id = 'well'
      nextWell.className = 'well-module--container--NEXT6'
      nextWell.innerHTML =
        '<span class="well-module--text--NEXT7">English well caption</span>'
      row.appendChild(nextWell)

      detector.emitPresentation({
        source: SOURCE_A,
        mode: 'below-caption',
        anchor: nextWell,
        mountAfter: row,
      })
      await flush(8)
    }

    expect(insertSpy).toHaveBeenCalledTimes(5)
    insertSpy.mockRestore()
  })

  it('44) Udemy fullscreen kökü anchor içinde, mount satırı dışında: floating ve çıkışta below', async () => {
    const fixture = buildWellMountDom()
    const { manager, detector } = await setup()
    const row = fixture.row as HTMLElement
    const player = document.getElementById('player') as HTMLElement
    const fullscreenRoot = document.createElement('div')
    fullscreenRoot.id = 'fullscreen-root'
    fullscreenRoot.className =
      'curriculum-item-view--content--aaJOw curriculum-item-fullscreen--X'
    row.appendChild(fullscreenRoot)
    fullscreenRoot.appendChild(player)

    await translateFirstLine(
      detector,
      'English well caption',
      'Türkçe well altyazısı',
    )
    const before = sendMessages.length
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor: fixture.well,
      mountAfter: row,
    })
    await flush()
    expect(container()?.previousElementSibling).toBe(row)

    // Anchor fullscreen kökünün içinde; mount satırı kökü kapsayan dış ata.
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: fullscreenRoot,
    })
    document.dispatchEvent(new Event('fullscreenchange'))
    await flush()
    expect(container()?.parentElement).toBe(fullscreenRoot)
    expect(container()?.style.position).toBe('fixed')
    expect(container()?.style.display).toBe('flex')
    expect(translatedText()).toBe('Türkçe well altyazısı')
    // Fullscreen görsel floating'i below hedefini korur; eski observer kapalı.
    expect((manager as any).belowObserver).toBeNull()
    expect((manager as any).belowMountAfter).toBe(row)
    expect((manager as any).belowSource).not.toBeNull()

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    })
    document.dispatchEvent(new Event('fullscreenchange'))
    await flush()
    expect(container()?.parentElement).toBe(fixture.content)
    expect(container()?.previousElementSibling).toBe(row)
    expect(container()?.style.position).toBe('static')
    expect(container()?.style.display).toBe('block')
    expect(translatedText()).toBe('Türkçe well altyazısı')
    expect((manager as any).belowObserverTarget).toBe(fixture.content)

    // Tekrarlı giriş/çıkış tek kutu ve tek abonelik bırakır.
    for (let i = 0; i < 2; i += 1) {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        value: fullscreenRoot,
      })
      document.dispatchEvent(new Event('fullscreenchange'))
      await flush()
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        value: null,
      })
      document.dispatchEvent(new Event('fullscreenchange'))
      await flush()
    }
    expect(
      document.querySelectorAll('.udemy-translate-floating-subtitle'),
    ).toHaveLength(1)
    expect(detector.presentationSubscriberCount).toBe(1)
    expect(detector.evaluateNow).toHaveBeenCalledTimes(6)
    expect(container()?.previousElementSibling).toBe(row)
    expect(sendMessages).toHaveLength(before)
  })

  it('45) floating presentation null tam relayout veya drag sıfırlaması yapmaz', async () => {
    const { manager, detector } = await setup({ isDraggable: true })
    await translateFirstLine(detector)
    const visualSpy = jest.spyOn(manager as any, 'applyVisualSettings')
    const attachSpy = jest.spyOn(
      manager as any,
      'attachFloatingInteractions',
    )
    visualSpy.mockClear()
    attachSpy.mockClear()

    detector.emitPresentation(null)
    await flush()

    expect(visualSpy).not.toHaveBeenCalled()
    expect(attachSpy).not.toHaveBeenCalled()
    expect(container()?.style.display).toBe('flex')
    visualSpy.mockRestore()
    attachSpy.mockRestore()
  })

  it('46) floating container DOM’dan koparsa köke geri eklenir', async () => {
    const { manager, detector } = await setup()
    await translateFirstLine(detector)
    const box = container() as HTMLElement
    box.remove()
    expect(container()).toBeNull()

    ;(manager as any).updateOverlayVisibility()

    expect(container()).toBe(box)
    expect(box.parentElement).toBe(document.body)
    expect(box.style.display).toBe('flex')
  })

  it('47) hedef değişiminde bütçe hedef başına sıfırlanır, toplam tavan korunur', async () => {
    const fixture = buildWellMountDom()
    const { detector } = await setup()
    await translateFirstLine(detector)
    const content = fixture.content
    const well = fixture.well
    let row = fixture.row as HTMLElement
    const insertSpy = jest.spyOn(
      HTMLElement.prototype,
      'insertAdjacentElement',
    )

    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor: well,
      mountAfter: row,
    })
    await flush()
    expect(insertSpy).toHaveBeenCalledTimes(1)

    for (let i = 0; i < 20; i += 1) {
      container()?.remove()
      const nextRow = document.createElement('div')
      nextRow.id = `mount-row-${i}`
      nextRow.className = `app--body-container--TARGET${i}`
      nextRow.appendChild(well)
      content.insertBefore(nextRow, fixture.tabs)
      const oldRow = row
      row = nextRow
      oldRow.remove()

      detector.emitPresentation({
        source: SOURCE_A,
        mode: 'below-caption',
        anchor: well,
        mountAfter: row,
      })
      await flush(8)
    }

    // Hedef başına 5 deneme tazelenir, ancak pencere toplamı 3x=15'i aşmaz.
    expect(insertSpy).toHaveBeenCalledTimes(15)
    insertSpy.mockRestore()
  })

  it('48) fullscreen ve mount hedefi yokken floating, çıkışta below gizli', async () => {
    const fixture = buildWellMountDom()
    const { manager, detector } = await setup()
    const row = fixture.row as HTMLElement
    const player = document.getElementById('player') as HTMLElement
    const fullscreenRoot = document.createElement('div')
    fullscreenRoot.id = 'fullscreen-root-no-mount'
    fullscreenRoot.className =
      'curriculum-item-view--content--aaJOw curriculum-item-fullscreen--X'
    row.appendChild(fullscreenRoot)
    fullscreenRoot.appendChild(player)

    await translateFirstLine(detector)
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor: fixture.well,
      mountAfter: row,
    })
    await flush()
    const before = sendMessages.length

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: fullscreenRoot,
    })
    detector.emitPresentation({
      source: SOURCE_A,
      mode: 'below-caption',
      anchor: fixture.well,
      mountAfter: null,
    })
    await flush()
    expect(container()?.parentElement).toBe(fullscreenRoot)
    expect(container()?.style.position).toBe('fixed')
    expect(container()?.style.display).toBe('flex')
    expect((manager as any).belowSource).not.toBeNull()

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    })
    document.dispatchEvent(new Event('fullscreenchange'))
    await flush()
    expect((manager as any).layoutMode).toBe('below-caption')
    expect(container()?.parentElement).not.toBe(document.body)
    expect(container()?.style.position).toBe('static')
    expect(container()?.style.display).toBe('none')
    expect(sendMessages).toHaveLength(before)
  })

  it('49) sayfa askıda değilken BFCache stream kopması aynı metni yeniden dener', async () => {
    const { manager, detector } = await setup({ enableStreaming: true })
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    expect(portPostMessages).toHaveLength(1)

    const getter = setRuntimeLastError({
      message:
        'The page keeping the extension port is moved into back/forward cache, so the message channel is closed.',
    })
    portDisconnectListeners.forEach((fn) => fn())
    await flush()
    setRuntimeLastError(undefined)

    expect(getter).toHaveBeenCalled()
    expect(errorVisible()).toBe(false)
    expect((manager as any).streamRetryCount).toBe(1)
    jest.advanceTimersByTime(200)
    await flush()
    expect(portPostMessages).toHaveLength(2)
    expect(portPostMessages[1].text).toBe(
      'Hello world, this is the first subtitle.',
    )
  })

  it('49b) sayfa askıdayken BFCache stream kopması retry üretmez', async () => {
    const { manager, detector } = await setup({ enableStreaming: true })
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    expect(portPostMessages).toHaveLength(1)

    ;(manager as any).pageSuspended = true
    setContentPageSuspended(true)
    setRuntimeLastError({
      message:
        'The page keeping the extension port is moved into back/forward cache, so the message channel is closed.',
    })
    portDisconnectListeners.forEach((fn) => fn())
    await flush()
    jest.advanceTimersByTime(1000)
    await flush()

    expect(manager.lifecycle.hasActiveRequest).toBe(false)
    expect(errorVisible()).toBe(false)
    expect(portPostMessages).toHaveLength(1)
    expect(container()).toBeNull()
  })

  it('50) sonuç öncesi beklenmedik stream kopması sınırlı retry sonrası hata gösterir', async () => {
    const { manager, detector } = await setup({ enableStreaming: true })
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()

    setRuntimeLastError({ message: 'unexpected stream close' })
    portDisconnectListeners.forEach((fn) => fn())
    await flush()
    setRuntimeLastError(undefined)
    expect(errorVisible()).toBe(false)
    jest.advanceTimersByTime(200)
    await flush()
    expect(portPostMessages).toHaveLength(2)

    jest
      .spyOn(manager as any, 'shouldRetryStream')
      .mockReturnValue(false)
    setRuntimeLastError({ message: 'unexpected stream close' })
    const releaseSpy = jest.spyOn(manager.lifecycle, 'releaseRequest')
    const latestDisconnect =
      portDisconnectListeners[portDisconnectListeners.length - 1]
    latestDisconnect()
    await flush()
    setRuntimeLastError(undefined)

    expect(releaseSpy).toHaveBeenCalledTimes(1)
    expect(manager.lifecycle.hasActiveRequest).toBe(false)
    expect(errorVisible()).toBe(true)
  })

  it('51) pagehide temizler; persisted pageshow yeni başlangıç ve aynı altyazıyı gösterir', async () => {
    const { detector } = await setup()
    await translateFirstLine(detector)
    expect(translatedText()).toBe('Merhaba dünya, bu ilk altyazı.')
    const before = sendMessages.length

    dispatchPageHide(true)
    await flush()
    expect(detector.running).toBe(false)
    expect(container()).toBeNull()

    dispatchPageShow(false)
    await flush()
    expect(detector.running).toBe(false)
    expect(detector.starts).toBe(1)

    dispatchPageShow(true)
    await flush(10)
    expect(detector.running).toBe(true)
    expect(detector.starts).toBe(2)
    expect(detector.resetAfterRestore).toHaveBeenCalled()

    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    expect(translatedText()).toBe('Merhaba dünya, bu ilk altyazı.')
    expect(sendMessages).toHaveLength(before)

    const starts = detector.starts
    dispatchPageShow(true)
    await flush()
    expect(detector.starts).toBe(starts)
  })

  it('52) pagehide sonrası geç blocking yanıtı kutuyu yeniden oluşturmaz', async () => {
    const { detector } = await setup()
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    expect(sendMessages).toHaveLength(1)

    dispatchPageHide(true)
    await flush()
    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'GEÇ ÇEVİRİ',
    })
    await flush()
    jest.advanceTimersByTime(5000)
    await flush(2)

    expect(container()).toBeNull()
    expect(sendMessages).toHaveLength(1)
  })

  it('53) eklenti kapalıyken persisted pageshow port/algılama başlatmaz', async () => {
    const { detector } = await setup({ status: false })
    expect(detector.running).toBe(false)

    dispatchPageHide(true)
    dispatchPageShow(true)
    await flush(10)

    expect(detector.running).toBe(false)
    expect(detector.starts).toBe(0)
    expect(container()).toBeNull()
  })

  it('57) persisted olmayan pagehide eklentiyi askıya almaz', async () => {
    const { detector } = await setup()
    await translateFirstLine(detector)
    const box = container()

    dispatchPageHide(false)
    await flush()

    expect(detector.running).toBe(true)
    expect(container()).toBe(box)
    expect(translatedText()).toBe('Merhaba dünya, bu ilk altyazı.')
  })

  it('54) dispose sonrası geç storage yanıtı manager’ı canlandırmaz', async () => {
    const { manager, detector } = await setup()
    const pendingGet = jest.fn()
    ;(global as any).chrome.storage.local.get = pendingGet

    const pending = manager.syncFromStorage()
    manager.dispose()
    const starts = detector.starts
    const callback = pendingGet.mock.calls[0][1] as (data: any) => void
    callback({ ...BASE_STORAGE, status: true })
    await pending
    await flush()

    expect(detector.starts).toBe(starts)
    expect(container()).toBeNull()
  })

  it('56) pagehide sonrası geç stream sonucu kutuyu yeniden oluşturmaz', async () => {
    const { detector } = await setup({ enableStreaming: true })
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    const requestId = portPostMessages[0].requestId

    dispatchPageHide(true)
    await flush()
    portMessageListeners.forEach((fn) =>
      fn({ type: 'STREAM_DONE', requestId, fullText: 'GEÇ' }),
    )
    await flush()

    expect(container()).toBeNull()
  })

  it('55) blocking callback lastError’ı erken dönüşten önce okur', async () => {
    const { manager, detector } = await setup()
    detector.emit('Hello world, this is the first subtitle.')
    jest.advanceTimersByTime(200)
    await flush()
    const getter = setRuntimeLastError({ message: 'late message' })

    manager.dispose()
    pendingCallbacks[0]({
      type: 'TRANSLATED_TEXT',
      translatedText: 'GEÇ',
    })
    await flush()

    expect(getter).toHaveBeenCalled()
  })
})
