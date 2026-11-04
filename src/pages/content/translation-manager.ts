import {
  SubtitleLifecycle,
  LifecycleTiming,
  VisiblePair,
} from './subtitle-lifecycle'
import {
  DetectionStatus,
  SourceRef,
  SubtitleDetector,
  SubtitleSample,
} from '../../types/detection'
import { DetectionEngine } from './detection/detection-engine'
import {
  isFullscreenLayoutExcluded,
  isPresentationAnchorAvailable,
  isUsablePresentationMount,
  PresentationAwareDetector,
  samePresentation,
  SubtitlePresentation,
} from './detection/presentation'
import { readVisibleText } from './detection/text'
import {
  isExpectedBfcachePortClose,
  readRuntimeLastError,
} from '../../utils/port-errors'
import {
  setContentPageSuspended,
} from './page-lifecycle'
import {
  resolveProviderAndConfig,
  resolveProviderSelection,
} from '../../utils/settings-utils'
import { detectLang, isLang, makeT } from '../../utils/i18n'
import { getDeepLApiKey, resolveDeepLPlan } from '../../utils/deepl'

export interface StorageData {
  status: boolean
  apiKey: string
  baseURL: string
  prompt: string
  domConfigs: DomConfig[]
  enableStreaming?: boolean
  backgroundColor?: string
  backgroundOpacity?: string
  originFontColor?: string
  originFontWeight?: string
  originFontSize?: string
  translatedFontColor?: string
  translatedFontWeight?: string
  translatedFontSize?: string
  subtitlePosition?: 'bottom' | 'top' | 'center' | 'custom'
  subtitleX?: number
  subtitleY?: number
  subtitleWidth?: number
  subtitleHeight?: number
  isDraggable?: boolean
  selectedProvider?: string
  selectedModel?: string
  providerConfig?: any
  showOriginalSubtitle?: boolean
  openaiConfig?: any
  ollamaConfig?: any
  ctranslate2Config?: any
  sourceLanguage?: string
  [key: string]: any
}

export interface DomConfig {
  domain: string
  selector: string
  selectors?: string[]
}

const CONFIG = {
  DEFAULT_BACKGROUND_COLOR: 'rgba(0, 0, 0, 0.75)',
  DEFAULT_OPACITY: '0.8',
  DEFAULT_ORIGIN_FONT_COLOR: 'white',
  DEFAULT_TRANSLATED_FONT_COLOR: 'yellow',
  DEFAULT_FONT_WEIGHT: 'normal',
  DEFAULT_FONT_SIZE: '16',
  DEFAULT_SUBTITLE_POSITION: 'bottom' as const,
  DEFAULT_SUBTITLE_WIDTH: 600,
  DEFAULT_SUBTITLE_HEIGHT: 120,
  DEFAULT_DRAGGABLE: true,
  ERROR_THROTTLE_MS: 30000,
  DETECTION_DISABLED_REASON: 'stopped',
}

const CONTAINER_ID = 'udemy-translate-floating-subtitle'
const CONTAINER_CLASS = 'udemy-translate-floating-subtitle'

/** Çeviri üretimini etkileyen ayarlar: değişince aktif iş geçersizleşir. */
const TRANSLATION_KEYS = [
  'selectedProvider',
  'providerConfig',
  'selectedModel',
  'openaiConfig',
  'ollamaConfig',
  'ctranslate2Config',
  'deeplConfig',
  'prompt',
  'enableStreaming',
  'targetLanguage',
  'sourceLanguage',
  'apiKey',
  'baseURL',
]

/** Yalnızca görünümü etkileyen ayarlar: yeni çeviri üretmez. */
const VISUAL_KEYS = [
  'showOriginalSubtitle',
  'backgroundColor',
  'backgroundOpacity',
  'originFontColor',
  'originFontWeight',
  'originFontSize',
  'translatedFontColor',
  'translatedFontWeight',
  'translatedFontSize',
  'subtitleWidth',
  'subtitleHeight',
  'subtitleX',
  'subtitleY',
  'subtitlePosition',
  'isDraggable',
]

const CANCELLATION_HINTS = /(abort|cancel|disconnect|port closed|message port closed)/i

/** Host re-render döngüsünde sonsuz yeniden eklemeyi engelleyen sınırlar. */
const MAX_BELOW_REBINDS_PER_WINDOW = 5
const BELOW_REBIND_WINDOW_MS = 1000
/** Hedef değişse bile pencere başına mutlak yeniden bağlama tavanı. */
const MAX_BELOW_REBINDS_TOTAL_PER_WINDOW =
  MAX_BELOW_REBINDS_PER_WINDOW * 3
/** Beklenmedik stream kopmasında sınırlı yeniden deneme. */
const MAX_STREAM_RETRIES = 2
const STREAM_RETRY_WINDOW_MS = 10000

export interface TranslationManagerOptions {
  timing?: Partial<LifecycleTiming>
  detector?: SubtitleDetector
  detectorFactory?: () => SubtitleDetector
}

export class TranslationManager {
  public readonly lifecycle: SubtitleLifecycle

  private enabled = false
  private disposed = false
  private pageSuspended = false
  private pageRestoring = false
  private latestStorage: StorageData | null = null

  private detector: SubtitleDetector | null = null
  private detectorFactory: () => SubtitleDetector
  private unsubscribeDetector: (() => void) | null = null
  private unsubscribePresentation: (() => void) | null = null
  private presentation: SubtitlePresentation | null = null
  private pendingPresentation: SubtitlePresentation | null = null
  /** Fullscreen handler engine'i yeniden çözerken ara apply'ları bastırır. */
  private suppressPresentationApply = false
  private layoutMode: 'floating' | 'below-caption' = 'floating'
  private lastDetectionStatus: DetectionStatus = {
    phase: 'disabled',
    reason: CONFIG.DETECTION_DISABLED_REASON,
  }
  private activeSourceRef: SourceRef | null = null
  private activeAuthorityToken = ''
  private lastDetectorSample: SubtitleSample | null = null

  private runtimeMessageHandler: ((message: any) => void) | null = null
  private storageChangeHandler:
    | ((
        changes: { [key: string]: chrome.storage.StorageChange },
        namespace: string,
      ) => void)
    | null = null

  private floatingSubtitle: HTMLElement | null = null
  private originalEl: HTMLElement | null = null
  private translatedEl: HTMLElement | null = null
  private errorEl: HTMLElement | null = null
  private overlayShown = false
  private dragging = false
  private dragRegistrationCleanup: (() => void) | null = null
  private dragSessionCleanup: (() => void) | null = null
  private contextMenuCleanup: (() => void) | null = null
  private visibilityHandler: (() => void) | null = null
  private fullscreenHandler: (() => void) | null = null
  private pageHideHandler: ((event: PageTransitionEvent) => void) | null = null
  private pageShowHandler: ((event: PageTransitionEvent) => void) | null = null
  private belowAnchor: HTMLElement | null = null
  /** Gerçek ekleme noktası: dış satır veya legacy anchor. */
  private belowMountAfter: HTMLElement | null = null
  /** Bağlı anchor en az bir kez görünür özgün metin taşıdı mı? */
  private belowAnchorHadText = false
  private belowSource: SourceRef | null = null
  private belowObserver: MutationObserver | null = null
  private belowObserverTarget: HTMLElement | null = null
  private belowReconcileTimer: number | null = null
  private belowRebindAttempts = 0
  private belowRebindTotalAttempts = 0
  private belowRebindWindowAt = 0
  private floatingGeometryKey = ''

  private activePort: chrome.runtime.Port | null = null
  private translationCache: Map<string, string> = new Map()
  private streamRetrySource = ''
  private streamRetryCount = 0
  private streamRetryAt = 0

  private lastErrorKey = ''
  private lastErrorTime = 0
  private lastRenderedPair: VisiblePair | null = null

  constructor(
    options: TranslationManagerOptions | Partial<LifecycleTiming> = {},
  ) {
    const normalized: TranslationManagerOptions =
      options && ('timing' in options || 'detector' in options || 'detectorFactory' in options)
        ? (options as TranslationManagerOptions)
        : { timing: options as Partial<LifecycleTiming> }

    this.detector = normalized.detector ?? null
    this.detectorFactory =
      normalized.detectorFactory ?? (() => new DetectionEngine())

    this.lifecycle = new SubtitleLifecycle(
      {
        onTranslate: (source, epoch) => {
          void this.runTranslation(source, epoch)
        },
        onHide: () => {
          this.closeActivePort()
          this.hideOverlay()
        },
      },
      normalized.timing ?? {},
    )
  }

  // ---------------------------------------------------------------- yaşam döngüsü

  public async start(): Promise<void> {
    if (this.disposed) return
    this.cleanupOrphanContainers()
    this.removeLegacyHideStyle()
    this.registerEventListeners()
    await this.syncFromStorage()
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.pageSuspended = false
    setContentPageSuspended(false)
    this.enabled = false
    this.resetStreamRetry()
    this.stopDetection()
    this.lifecycle.dispose()
    this.removeOverlay()
    this.unregisterEventListeners()
  }

  public async syncFromStorage(): Promise<void> {
    try {
      const storage = await this.readStorage()
      this.applyStorage(storage)
    } catch (error) {
      if (!this.disposed) console.error('Initial setup error:', error)
    }
  }

  private applyStorage(storage: StorageData): void {
    this.latestStorage = storage
    this.enabled = !!storage.status
    // Askıda veya dispose edilmiş manager geç storage yanıtıyla canlanmaz.
    if (this.disposed || this.pageSuspended) return

    if (this.enabled) {
      this.startDetection()
    } else {
      this.stopTranslation()
    }
  }

  private startDetection(): void {
    if (this.disposed || this.pageSuspended || !this.enabled) return
    this.registerLayoutListeners()
    if (!this.detector) {
      this.detector = this.detectorFactory()
    }
    if (!this.unsubscribeDetector) {
      this.unsubscribeDetector = this.detector.subscribe(
        (sample) => this.handleDetectorSample(sample),
        (status) => this.handleDetectorStatus(status),
      )
    }
    if (!this.unsubscribePresentation) {
      const presentationDetector = this.detector as PresentationAwareDetector
      if (typeof presentationDetector.subscribePresentation === 'function') {
        this.unsubscribePresentation =
          presentationDetector.subscribePresentation((presentation) => {
            this.handlePresentation(presentation)
          })
      }
    }
    this.lifecycle.activate()
    this.detector.start()
  }

  private stopDetection(): void {
    if (this.unsubscribeDetector) {
      this.unsubscribeDetector()
      this.unsubscribeDetector = null
    }
    if (this.unsubscribePresentation) {
      this.unsubscribePresentation()
      this.unsubscribePresentation = null
    }
    if (this.detector) {
      this.detector.stop()
    }
    this.lifecycle.deactivate()
    this.closeActivePort()
    this.activeSourceRef = null
    this.activeAuthorityToken = ''
    this.lastDetectorSample = null
    this.presentation = null
    this.pendingPresentation = null
    this.lastDetectionStatus = {
      phase: 'disabled',
      reason: CONFIG.DETECTION_DISABLED_REASON,
    }
    // Yerleşim dinleyicileri yalnızca algılama açıkken gerekir.
    this.unregisterLayoutListeners()
  }

  private registerEventListeners(): void {
    if (!this.runtimeMessageHandler && chrome?.runtime?.onMessage?.addListener) {
      this.runtimeMessageHandler = (message: any) => {
        if (message?.type === 'STATUS_CHANGED') {
          this.handleStatusChange(message.status)
        }
      }
      chrome.runtime.onMessage.addListener(this.runtimeMessageHandler)
    }

    if (
      !this.storageChangeHandler &&
      chrome?.storage?.onChanged?.addListener
    ) {
      this.storageChangeHandler = (changes, namespace) => {
        if (namespace === 'local') {
          this.handleStorageChange(changes)
        }
      }
      chrome.storage.onChanged.addListener(this.storageChangeHandler)
    }

    this.registerPageShowListener()
    this.registerLayoutListeners()
  }

  private registerPageShowListener(): void {
    if (this.pageShowHandler) return
    this.pageShowHandler = (event: PageTransitionEvent) => {
      if (event.persisted) void this.handlePageRestore()
    }
    window.addEventListener('pageshow', this.pageShowHandler)
  }

  private handlePageHide(event: PageTransitionEvent): void {
    // Yalnız BFCache'e gerçekten girişte askıya al. İptal edilen gezinme
    // veya normal unload'da eklenti canlı kalır.
    if (!event.persisted) return
    if (this.disposed || this.pageSuspended) return
    this.pageSuspended = true
    setContentPageSuspended(true)
    // Portlar, timer'lar ve algılama; ardından epoch/görünür çift ve
    // eklenti DOM'u temizlenir. Kullanıcının açık tercihi storage'a yazılmaz.
    this.stopDetection()
    this.lifecycle.hideNow()
    this.removeOverlay()
    this.resetStreamRetry()
  }

  private async handlePageRestore(): Promise<void> {
    if (this.disposed || !this.pageSuspended || this.pageRestoring) return
    this.pageRestoring = true
    this.pageSuspended = false
    setContentPageSuspended(false)
    try {
      // Önceki oturumdan kalan port/token/DOM hedefi kullanılmaz.
      this.stopDetection()
      this.lifecycle.hideNow()
      this.removeOverlay()
      this.resetStreamRetry()
      await this.syncFromStorage()
      const detector = this.detector as
        | { resetAfterRestore?: () => void }
        | null
      detector?.resetAfterRestore?.()
    } finally {
      this.pageRestoring = false
    }
  }

  private registerLayoutListeners(): void {
    if (!this.visibilityHandler) {
      this.visibilityHandler = () => this.handleVisibilityChange()
      document.addEventListener('visibilitychange', this.visibilityHandler)
    }

    if (!this.pageHideHandler) {
      this.pageHideHandler = (event: PageTransitionEvent) =>
        this.handlePageHide(event)
      window.addEventListener(
        'pagehide',
        this.pageHideHandler as EventListener,
      )
    }

    if (!this.fullscreenHandler) {
      // Tek fullscreen dinleyicisi burada. Önce engine varsa yerleşimi
      // yeniden çözdürür, sonra görünümü tek kez uygular.
      this.fullscreenHandler = () => {
        const detector = this.detector as
          | { evaluateNow?: () => void }
          | null
        this.suppressPresentationApply = true
        try {
          detector?.evaluateNow?.()
        } finally {
          this.suppressPresentationApply = false
        }
        this.applyPresentation()
      }
      document.addEventListener(
        'fullscreenchange',
        this.fullscreenHandler,
        true,
      )
      document.addEventListener(
        'webkitfullscreenchange',
        this.fullscreenHandler,
        true,
      )
    }
  }

  private unregisterLayoutListeners(): void {
    if (this.visibilityHandler) {
      document.removeEventListener(
        'visibilitychange',
        this.visibilityHandler,
      )
      this.visibilityHandler = null
    }
    if (this.fullscreenHandler) {
      document.removeEventListener(
        'fullscreenchange',
        this.fullscreenHandler,
        true,
      )
      document.removeEventListener(
        'webkitfullscreenchange',
        this.fullscreenHandler,
        true,
      )
      this.fullscreenHandler = null
    }
    if (this.pageHideHandler) {
      window.removeEventListener(
        'pagehide',
        this.pageHideHandler as EventListener,
      )
      this.pageHideHandler = null
    }
  }

  private unregisterEventListeners(): void {
    this.unregisterLayoutListeners()

    if (this.runtimeMessageHandler) {
      if (typeof chrome?.runtime?.onMessage?.removeListener === 'function') {
        chrome.runtime.onMessage.removeListener(this.runtimeMessageHandler)
      }
      this.runtimeMessageHandler = null
    }
    if (this.storageChangeHandler) {
      if (typeof chrome?.storage?.onChanged?.removeListener === 'function') {
        chrome.storage.onChanged.removeListener(this.storageChangeHandler)
      }
      this.storageChangeHandler = null
    }
    if (this.pageShowHandler) {
      window.removeEventListener('pageshow', this.pageShowHandler)
      this.pageShowHandler = null
    }
  }

  private stopTranslation(): void {
    this.stopDetection()
    this.removeOverlay()
    this.removeLegacyHideStyle()
  }

  public handleStatusChange(status: boolean): void {
    if (this.disposed || this.pageSuspended) return
    if (status) {
      void this.syncFromStorage()
    } else {
      this.enabled = false
      this.stopTranslation()
    }
  }

  public handleStorageChange(changes: {
    [key: string]: chrome.storage.StorageChange
  }): void {
    if (this.disposed || this.pageSuspended) return
    const keys = Object.keys(changes || {})
    if (!keys.length) return

    // Eski domConfigs kayıtları depoda kalır ama algılamayı zorlamaz.
    if (keys.includes('status')) {
      void this.syncFromStorage()
      return
    }

    if (keys.some((key) => TRANSLATION_KEYS.includes(key))) {
      // Sağlayıcı/model/hedef dil/prompt/streaming değişti:
      // aktif işi geçersizleştir, cache'i temizle, güncel kaynağı yeniden değerlendir.
      this.lifecycle.invalidate()
      this.translationCache.clear()
      this.closeActivePort()
      this.clearError()
      if (this.enabled) {
        this.startDetection()
        void this.syncFromStorage()
        // Ayar değişiminden sonra aynı satır yeniden istenmeli.
        if (
          this.activeSourceRef &&
          this.lastDetectorSample &&
          this.lastDetectorSample.text
        ) {
          this.lifecycle.observe(this.lastDetectorSample.text)
        }
      }
      return
    }

    if (keys.some((key) => VISUAL_KEYS.includes(key))) {
      void this.readStorage().then((storage) => {
        this.latestStorage = storage
        // Görsel ayar değişikliği yerleşimi bozmaz; moda göre yeniden uygular.
        this.applyPresentation(storage, true)
      })
    }
  }

  public handleVisibilityChange(): void {
    // Görünürlük yaşam döngüsü dedektör tarafından yönetilir (suspended).
    if (document.hidden) {
      this.closeActivePort()
    }
  }

  // ---------------------------------------------------------------- algılama

  /**
   * Yerleşim akışı yalnızca görünümü etkiler: yaşam döngüsünü geçersizleştirmez,
   * cache temizlemez ve yeni çeviri isteği üretmez.
   */
  private handlePresentation(
    presentation: SubtitlePresentation | null,
  ): void {
    if (!presentation) {
      // Yetki başka kaynağa geçtiyse eski videonun anchor'ı kullanılmaz.
      if (
        this.belowSource &&
        this.activeSourceRef &&
        !sameSource(this.activeSourceRef, this.belowSource)
      ) {
        this.clearBelowTarget()
      }
      this.pendingPresentation = null
      this.presentation = null
      // Floating modda container bağlıysa tam relayout/etkileşim kurulumu
      // yeniden çalıştırılmaz; yalnızca görünürlük güncellenir.
      if (this.layoutMode === 'floating') {
        this.updateOverlayVisibility()
        return
      }
      // Below hedefi korunur; hedef kopmuşsa kutu gizlenir.
      this.applyPresentation()
      return
    }

    if (
      this.activeSourceRef &&
      !sameSource(this.activeSourceRef, presentation.source)
    ) {
      // Yeni yetkilinin yerleşimi ilk metninden önce gelebilir; eski kaynağın
      // görüntüsüne uygulanmaz, yeni kaynak örneği gelince kullanılır.
      this.pendingPresentation = presentation
      return
    }

    if (!this.activeSourceRef) {
      // Yerleşim, ilk metin örneğinden önce gelebilir. Waiting fazında kutu
      // zaten varsa yerleşim hemen uygulanır; engine aynı değeri tekrar
      // yayınlamaz.
      this.pendingPresentation = presentation
      this.presentation = presentation
      if (this.floatingSubtitle) this.applyPresentation()
      return
    }

    const containerDetached =
      !this.floatingSubtitle || !this.floatingSubtitle.isConnected
    const changed =
      !samePresentation(this.presentation, presentation) || containerDetached
    this.pendingPresentation = null
    this.presentation = presentation
    if (changed) this.applyPresentation()
  }

  private handleDetectorSample(sample: SubtitleSample): void {
    if (!this.enabled || !this.lifecycle.isActive) return
    const authority = this.detector?.getAuthority?.()
    if (!authority) return
    if (!sameSource(authority.source, sample.source)) return

    this.ensureActiveSource(sample.source)
    let layoutChanged = false
    if (this.pendingPresentation) {
      if (sameSource(this.pendingPresentation.source, sample.source)) {
        this.presentation = this.pendingPresentation
        layoutChanged = true
      }
      // Başka kaynağa ait bayat yerleşim ilk örnekte düşer.
      this.pendingPresentation = null
    }
    if (
      this.presentation &&
      !sameSource(this.presentation.source, sample.source)
    ) {
      this.presentation = null
      layoutChanged = true
    }
    if (layoutChanged) this.applyPresentation()
    this.activeAuthorityToken = authority.token
    this.lastDetectorSample = sample
    this.lifecycle.observe(sample.text)
  }

  private handleDetectorStatus(status: DetectionStatus): void {
    this.lastDetectionStatus = status
    if (!this.enabled) return

    if (status.phase === 'connected' || status.phase === 'waiting') {
      return
    }

    // Yetki yok veya kaynak değişiyor: eski çeviri görüntüsü temizlenir.
    this.closeActivePort()
    if (this.activeSourceRef) {
      this.activeSourceRef = null
      this.activeAuthorityToken = ''
      this.lastDetectorSample = null
      // Yerleşim durumu korunur: engine aynı presentation'ı samePresentation
      // nedeniyle yeniden yayınlamaz. Geçici verifying/searching sırasında
      // silmek, kaynak dönünce kutuyu floating'de bırakırdı.
      this.lifecycle.invalidate()
      this.lifecycle.hideNow()
    }
  }

  private ensureActiveSource(source: SourceRef): void {
    if (this.activeSourceRef && sameSource(this.activeSourceRef, source)) {
      return
    }
    if (this.activeSourceRef) {
      // Kaynak değişimi: eski yanıtları geçersizleştir, görüntüyü temizle.
      this.closeActivePort()
      this.lifecycle.invalidate()
      this.lifecycle.hideNow()
    }
    if (this.belowSource && !sameSource(this.belowSource, source)) {
      // Yeni kaynağın ilk örneği eski/gizli videonun anchor'ına yazılmaz.
      this.clearBelowTarget()
    }
    this.activeSourceRef = { ...source }
    this.activeAuthorityToken = ''
  }

  private isAuthorityCurrent(
    token: string,
    source: SourceRef,
  ): boolean {
    if (!this.activeSourceRef || !sameSource(this.activeSourceRef, source)) {
      return false
    }
    const authority = this.detector?.getAuthority?.()
    if (!authority) {
      // getAuthority sunmayan test dedektörlerinde yaşam döngüsü sürümü yeter.
      return typeof (this.detector as any)?.getAuthority !== 'function'
    }
    return (
      authority.token === token && sameSource(authority.source, source)
    )
  }

  // ----------------------------------------------------------------- çeviri

  private async runTranslation(source: string, epoch: number): Promise<void> {
    if (!this.lifecycle.isEpochCurrent(epoch)) return
    const sourceRef = this.activeSourceRef
    const token = this.activeAuthorityToken
    if (!sourceRef || !token) return

    let storage: StorageData
    try {
      storage = await this.readStorage()
    } catch {
      return
    }

    // Geç storage okuması: sürüm bu arada değiştiyse hiçbir şey yapma.
    if (!this.lifecycle.isEpochCurrent(epoch)) return
    if (!this.isAuthorityCurrent(token, sourceRef)) return

    this.latestStorage = storage
    this.clearError()

    const cached = this.translationCache.get(source)
    if (cached !== undefined) {
      this.applyResult(source, cached, epoch, storage, sourceRef, token)
      return
    }

    const targetLanguage = this.resolveTargetLanguage(storage)
    if (!this.lifecycle.beginRequest(source, epoch)) return

    if (storage.enableStreaming !== false) {
      this.requestStreaming(
        source,
        epoch,
        targetLanguage,
        storage,
        sourceRef,
        token,
      )
    } else {
      this.requestBlocking(
        source,
        epoch,
        targetLanguage,
        storage,
        sourceRef,
        token,
      )
    }
  }

  private resolveTargetLanguage(storage: StorageData): string {
    return (
      storage?.providerConfig?.targetLanguage ||
      storage?.ctranslate2Config?.targetLanguage ||
      storage?.openaiConfig?.targetLanguage ||
      storage?.ollamaConfig?.targetLanguage ||
      storage?.targetLanguage ||
      'Turkish'
    )
  }

  /**
   * Sonuç gelmeden kopan stream'i aynı kaynak için sınırlı kez yeniden
   * dener. Sınırsız otomatik retry yoktur.
   */
  private retryStreamRequest(source: string, epoch: number): boolean {
    if (!this.shouldRetryStream(source)) return false
    if (!this.lifecycle.isEpochCurrent(epoch)) return false
    this.lifecycle.releaseRequest(epoch)
    this.lifecycle.invalidate()
    this.lifecycle.observe(source)
    return true
  }

  private shouldRetryStream(source: string): boolean {
    const now = Date.now()
    if (
      this.streamRetrySource !== source ||
      now - this.streamRetryAt > STREAM_RETRY_WINDOW_MS
    ) {
      this.streamRetrySource = source
      this.streamRetryCount = 0
      this.streamRetryAt = now
    }
    if (this.streamRetryCount >= MAX_STREAM_RETRIES) return false
    this.streamRetryCount += 1
    this.streamRetryAt = now
    return true
  }

  private resetStreamRetry(source?: string): void {
    if (source !== undefined && source !== this.streamRetrySource) return
    this.streamRetrySource = ''
    this.streamRetryCount = 0
    this.streamRetryAt = 0
  }

  private requestStreaming(
    source: string,
    epoch: number,
    targetLanguage: string,
    storage: StorageData,
    sourceRef: SourceRef,
    token: string,
  ): void {
    this.closeActivePort()

    const requestId = `req_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`

    let port: chrome.runtime.Port
    try {
      port = chrome.runtime.connect({ name: 'translate-stream' })
    } catch (error: any) {
      this.handleError(source, error?.message || String(error), epoch)
      return
    }

    this.activePort = port

    port.onDisconnect.addListener(() => {
      // lastError callback başında, sahiplik erken dönüşünden önce okunur.
      const lastError = readRuntimeLastError()
      const wasActive = this.activePort === port
      if (wasActive) this.activePort = null
      if (!wasActive) return
      if (this.disposed) return
      if (!this.lifecycle.isEpochCurrent(epoch)) return

      const bfcache = isExpectedBfcachePortClose(
        lastError,
        this.pageSuspended,
      )
      if (this.pageSuspended && bfcache) {
        // Askıdaki sayfa restore'da yeni istek üretir; pending kalmaz.
        this.lifecycle.releaseRequest(epoch)
        return
      }

      if (!this.isAuthorityCurrent(token, sourceRef)) {
        this.lifecycle.releaseRequest(epoch)
        return
      }

      // Geçici kopmada önce sınırlı retry; kalıcıysa mevcut hata akışı.
      if (this.retryStreamRequest(source, epoch)) return
      this.handleError(
        source,
        lastError?.message || 'Stream connection closed',
        epoch,
      )
    })

    port.onMessage.addListener((msg: any) => {
      if (!msg || msg.requestId !== requestId) return

      if (
        !this.lifecycle.isEpochCurrent(epoch) ||
        !this.isAuthorityCurrent(token, sourceRef)
      ) {
        this.closePort(port)
        return
      }

      if (msg.type === 'STREAM_CHUNK') {
        // Kısmi parça ekrana yazılmaz: kart tek seferde güncellenir.
        return
      }

      if (msg.type === 'STREAM_DONE') {
        this.resetStreamRetry(source)
        this.closePort(port)
        this.applyResult(
          source,
          msg.fullText || '',
          epoch,
          storage,
          sourceRef,
          token,
        )
      } else if (msg.type === 'STREAM_ERROR') {
        this.resetStreamRetry(source)
        this.closePort(port)
        this.handleError(source, msg.error || 'Unknown error', epoch)
      }
    })

    try {
      port.postMessage({
        type: 'TRANSLATE_STREAM',
        text: source,
        targetLanguage,
        requestId,
        source: sourceRef,
        token,
      })
    } catch (error: any) {
      this.closePort(port)
      this.handleError(source, error?.message || String(error), epoch)
    }
  }

  private requestBlocking(
    source: string,
    epoch: number,
    targetLanguage: string,
    storage: StorageData,
    sourceRef: SourceRef,
    token: string,
  ): void {
    try {
      chrome.runtime.sendMessage(
        {
          type: 'TRANSLATE_TEXT',
          text: source,
          targetLanguage,
          source: sourceRef,
          token,
        },
        (response: any) => {
          // lastError her erken dönüşten önce okunur.
          const lastError = readRuntimeLastError()
          // Fiziksel iptal yok: mantıksal olarak geçersizleştir.
          if (
            !this.lifecycle.isEpochCurrent(epoch) ||
            !this.isAuthorityCurrent(token, sourceRef)
          ) {
            return
          }

          if (lastError) {
            if (
              this.disposed ||
              isExpectedBfcachePortClose(lastError, this.pageSuspended)
            ) {
              return
            }
            this.handleError(
              source,
              lastError.message || 'Message failed',
              epoch,
            )
            return
          }

          if (response?.type === 'TRANSLATED_TEXT') {
            this.applyResult(
              source,
              response.translatedText || '',
              epoch,
              storage,
              sourceRef,
              token,
            )
          } else if (response?.type === 'TRANSLATION_ERROR') {
            this.handleError(source, response.error || 'Unknown error', epoch)
          } else {
            this.handleError(source, 'Empty response', epoch)
          }
        },
      )
    } catch (error: any) {
      this.handleError(source, error?.message || String(error), epoch)
    }
  }

  /** Sonucu (cache veya API) sürüm denetiminden geçirerek uygular. */
  private applyResult(
    source: string,
    raw: string,
    epoch: number,
    storage: StorageData,
    sourceRef: SourceRef,
    token: string,
  ): void {
    if (!this.lifecycle.isEpochCurrent(epoch)) return
    if (!this.isAuthorityCurrent(token, sourceRef)) return

    const translation = this.postProcess(raw)

    if (!translation) {
      // Boş final çeviri hata sayılır; mevcut metin boşaltılmaz.
      this.handleError(source, 'Empty translation returned', epoch)
      return
    }

    if (!this.lifecycle.completeRequest(epoch, { source, translation })) {
      return
    }

    this.translationCache.set(source, translation)
    this.renderPair(source, translation, storage)
  }

  private handleError(source: string, rawError: string, epoch: number): void {
    // Eski/iptal edilmiş işlem hata görünümüne yazamaz.
    if (!this.lifecycle.isEpochCurrent(epoch)) return

    if (this.isDeepLMissingKeyError(rawError)) {
      void this.retryAfterFreshKeyCheck(source, rawError, epoch)
      return
    }
    this.finalizeError(source, rawError, epoch)
  }

  private isDeepLMissingKeyError(rawError: string): boolean {
    const provider = resolveProviderSelection(
      this.latestStorage?.selectedProvider,
      this.latestStorage?.selectedModel,
    )
    if (provider !== 'deepl') return false
    return /api key is missing|anahtar[ıi] girilmemi[şs]/i.test(
      rawError || '',
    )
  }

  /**
   * The request may have read a stale `providerConfig` before a fresh key
   * write landed. Re-read storage once; retry only when the key is now
   * present, otherwise show the error. `retryStreamRequest` keeps the retry
   * count bounded.
   */
  private async retryAfterFreshKeyCheck(
    source: string,
    rawError: string,
    epoch: number,
  ): Promise<void> {
    let hasKey = false
    try {
      const fresh = await this.readStorage()
      if (!this.lifecycle.isEpochCurrent(epoch)) return
      this.latestStorage = fresh
      const resolved = resolveProviderAndConfig(fresh)
      hasKey =
        resolved?.provider === 'deepl' &&
        getDeepLApiKey(resolved.config) !== ''
    } catch {
      hasKey = false
    }

    if (!this.lifecycle.isEpochCurrent(epoch)) return
    const retried = hasKey && this.retryStreamRequest(source, epoch)
    if (retried) return
    this.finalizeError(source, rawError, epoch)
  }

  private finalizeError(
    source: string,
    rawError: string,
    epoch: number,
  ): void {
    this.lifecycle.releaseRequest(epoch)
    this.resetStreamRetry(source)

    // İptal kaynaklı hatalar kullanıcıya gösterilmez.
    if (CANCELLATION_HINTS.test(rawError || '')) return

    const errorKey = `${source.slice(0, 60)}::${(rawError || '').slice(0, 100)}`
    const now = Date.now()
    if (
      this.lastErrorKey === errorKey &&
      now - this.lastErrorTime < CONFIG.ERROR_THROTTLE_MS
    ) {
      return
    }
    this.lastErrorKey = errorKey
    this.lastErrorTime = now

    this.showError(this.friendlyErrorMessage(rawError))
  }

  private postProcess(raw: string): string {
    return (raw || '')
      .split('@@@')[0]
      .trim()
      .replace(/\n/g, ' ')
      .replace(/@/g, ' ')
      .trim()
  }

  private friendlyErrorMessage(raw: string): string {
    const lower = (raw || '').toLowerCase()
    const hasHttpStatus = (status: number) =>
      new RegExp(`(?:\\bHTTP\\s*|\\()${status}(?![0-9])`).test(lower)
    const provider = resolveProviderSelection(
      this.latestStorage?.selectedProvider,
      this.latestStorage?.selectedModel,
    )
    const isOllama = provider === 'ollama'
    const isCTranslate2 = provider === 'ctranslate2'
    const isDeepL = provider === 'deepl'

    if (
      isDeepL &&
      /api key is missing|anahtar[ıi] girilmemi[şs]/i.test(lower)
    ) {
      const storedLanguage = this.latestStorage?.language
      const lang = isLang(storedLanguage) ? storedLanguage : detectLang()
      const resolved = resolveProviderAndConfig(this.latestStorage)
      const plan = resolveDeepLPlan(resolved?.config || {})
      return makeT(lang)(
        plan === 'free'
          ? 'options.deepl.error.freeKeyMissing'
          : 'options.deepl.error.proKeyMissing',
      )
    }
    if (isDeepL && hasHttpStatus(456)) {
      return (
        '📊 The DeepL monthly quota is exhausted. ' +
        'Upgrade the plan or wait for the quota to reset.'
      )
    }
    if (isDeepL && hasHttpStatus(429)) {
      return '⏳ DeepL rate limit reached. Wait a moment and try again.'
    }

    if (
      hasHttpStatus(403) ||
      lower.includes('forbidden') ||
      lower.includes('cors')
    ) {
      if (isOllama) {
        return (
          '🚫 Ollama rejected the request (CORS). ' +
          'Restart Ollama with: OLLAMA_ORIGINS="chrome-extension://*" ollama serve'
        )
      }
      if (isCTranslate2) {
        return (
          '🚫 The local CTranslate2 server rejected the request. ' +
          'Check the server URL and restart the server.'
        )
      }
      if (isDeepL) {
        return '🔑 DeepL rejected the API key. Check the key in Settings.'
      }
      return '🚫 The translation service rejected the request (HTTP 403). Check credentials and permissions.'
    }
    if (hasHttpStatus(404) || lower.includes('not found')) {
      if (isCTranslate2) {
        return (
          '🔍 CTranslate2 model or endpoint not found. ' +
          'Check the server URL and make sure the loaded model name matches Settings.'
        )
      }
      if (isOllama) {
        const modelMatch = raw.match(/model ["']?([^"'\s]+)["']?/i)
        const model = modelMatch?.[1]
        if (model) return `🔍 Model "${model}" not found. Run: ollama pull ${model}`
        return '🔍 Resource not found. Check Base URL and Model Name.'
      }
      return '🔍 Resource not found. Check Base URL and Model Name.'
    }
    if (hasHttpStatus(401) || lower.includes('unauthorized')) {
      return '🔑 Invalid API key. Check provider credentials.'
    }
    if (
      lower.includes('failed to fetch') ||
      lower.includes('connection refused') ||
      lower.includes('network')
    ) {
      if (isOllama) {
        return '🔌 Cannot reach server. Check if Ollama is running and Base URL is correct.'
      }
      if (isCTranslate2) {
        return (
          '🔌 Cannot reach the local CTranslate2 server. ' +
          'Start it with ct2-nllb-server serve and check the server URL.'
        )
      }
      return '🔌 Cannot reach the translation server. Check the Base URL and network connection.'
    }
    if (
      lower.includes('timeout') ||
      lower.includes('timed out') ||
      lower.includes('deadline')
    ) {
      if (isCTranslate2) {
        return (
          '⏱ CTranslate2 request timed out after 30 seconds. ' +
          'The local model may still be finishing the request.'
        )
      }
      return '⏱ Request timed out. Server may be slow or unreachable.'
    }
    if (isCTranslate2 && lower.includes('inference failed')) {
      return '❌ CTranslate2 inference failed. Check the server console for details.'
    }
    return raw
  }

  // -------------------------------------------------------------------- DOM

  private ensureOverlay(storage: StorageData): void {
    if (this.floatingSubtitle) return

    const existing = document.getElementById(CONTAINER_ID) as HTMLElement | null
    if (existing) {
      this.floatingSubtitle = existing
      existing.setAttribute('data-subtitle-translator-ui', 'true')
      this.originalEl = existing.querySelector(
        '.original-subtitle',
      ) as HTMLElement | null
      this.translatedEl = existing.querySelector(
        '.translated-subtitle',
      ) as HTMLElement | null
      this.errorEl = existing.querySelector(
        '.translation-error',
      ) as HTMLElement | null
    }

    if (!this.floatingSubtitle) {
      this.buildOverlay(storage)
      return
    }

    if (!this.originalEl || !this.translatedEl) {
      this.buildChildren(this.floatingSubtitle, storage)
    }
    this.applyPresentation(storage, true)
  }

  private buildOverlay(storage: StorageData): void {
    const container = document.createElement('div')
    container.className = CONTAINER_CLASS
    container.id = CONTAINER_ID
    // Dedektörün kendi arayüz metnini altyazı sanmaması için işaret.
    container.setAttribute('data-subtitle-translator-ui', 'true')

    container.style.cssText = `
      position: fixed;
      left: 0;
      top: 0;
      width: ${storage.subtitleWidth || CONFIG.DEFAULT_SUBTITLE_WIDTH}px;
      min-height: ${storage.subtitleHeight || CONFIG.DEFAULT_SUBTITLE_HEIGHT}px;
      border-radius: 8px;
      padding: 12px;
      z-index: 2147483647;
      font-family: Arial, sans-serif;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      border: 2px solid rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(5px);
      transition: all 0.2s ease;
      cursor: default;
      user-select: none;
      display: none;
      flex-direction: column;
      justify-content: center;
      text-align: center;
    `

    this.buildChildren(container, storage)
    this.floatingSubtitle = container
    this.layoutMode = 'floating'
    document.body.appendChild(container)
    this.applyPresentation(storage, true)
  }

  /**
   * Yerleşimi yetkili kaynağın yayınladığı presentation'a göre uygular.
   * Yalnızca DOM konumunu ve görünür satırları değiştirir; metne, isteğe ve
   * yaşam döngüsüne dokunmaz.
   */
  private applyPresentation(
    storage: StorageData | null = null,
    forceGeometry = false,
  ): void {
    if (this.suppressPresentationApply) return
    const container = this.floatingSubtitle
    if (!container) return
    const currentStorage = storage ?? this.latestStorage
    if (!currentStorage) return

    const presentation = this.presentation
    if (presentation) {
      if (
        this.activeSourceRef &&
        !sameSource(this.activeSourceRef, presentation.source)
      ) {
        return
      }
      if (presentation.mode === 'floating') {
        // Video içi kaynağın açık floating bildirimi normal floating'e döner.
        this.applyFloatingLayout(currentStorage, forceGeometry)
        return
      }
      this.applyBelowPresentation(presentation, currentStorage)
      return
    }

    // presentation=null: geçici kayıp. Below niyeti (açık mod veya fullscreen
    // için korunmuş hedef) asla floating'e çevrilmez; yalnızca görünürlük
    // güncellenir. Anchor kopsa bile kutu gizli kalır.
    if (this.layoutMode === 'below-caption' || this.belowSource) {
      this.updateOverlayVisibility()
      return
    }
    this.applyFloatingLayout(currentStorage, forceGeometry)
  }

  /**
   * Below-caption niyetini uygular. Güvenli hedef yokluğu veya bağlama
   * başarısızlığı asla floating'e dönüşmez.
   */
  private applyBelowPresentation(
    presentation: SubtitlePresentation,
    storage: StorageData,
  ): void {
    const doc = document
    const win = document.defaultView
    const anchor = presentation.anchor

    const sameBelowSource = !!(
      this.belowSource &&
      sameSource(this.belowSource, presentation.source)
    )
    const anchorUsable = !!(
      anchor && isPresentationAnchorAvailable(anchor, doc, win)
    )

    // Fullscreen kararı anchor'ın yanında gerçek ekleme ebeveynine de bakar.
    // Anchor içeride olsa bile mount satırı dışarıdaysa kardeş kutu dışarıda
    // kalır; bu durumda görsel floating uygulanır.
    const decisionAnchor = anchorUsable
      ? anchor
      : sameBelowSource
        ? this.belowAnchor
        : null
    const decisionMountAfter = anchorUsable
      ? presentation.mountAfter
      : sameBelowSource
        ? this.belowMountAfter
        : null
    if (
      isFullscreenLayoutExcluded(
        decisionAnchor,
        decisionMountAfter,
        doc,
      )
    ) {
      // Fullscreen kaynaklı görsel floating below durumunu silmez; çıkışta
      // aynı presentation ile dış hedefe geri bağlanır.
      this.applyFloatingLayout(storage, false, true)
      return
    }

    if (!anchorUsable) {
      if (!sameBelowSource) {
        this.clearBelowTarget()
        this.belowSource = { ...presentation.source }
      }
      this.layoutMode = 'below-caption'
      this.applyBelowCaptionLayout(
        this.belowAnchor,
        this.belowMountAfter,
        storage,
      )
      return
    }

    if (!sameBelowSource) this.clearBelowTarget()
    this.belowSource = { ...presentation.source }
    if (this.belowAnchor !== anchor) {
      this.belowAnchor = anchor
      this.belowAnchorHadText = false
    }

    let target: HTMLElement | null = null
    if (presentation.mountAfter === undefined) {
      // Legacy adaptör: anchor'ın hemen ardına ekle.
      target = anchor
    } else if (
      presentation.mountAfter !== null &&
      isUsablePresentationMount(
        presentation.mountAfter,
        anchor,
        doc,
        win,
      )
    ) {
      target = presentation.mountAfter
    }

    this.applyBelowCaptionLayout(anchor, target, storage)
  }

  /** Yalnızca görünürlüğü günceller; yerleşim stillerine dokunmaz. */
  private updateOverlayVisibility(): void {
    if (this.suppressPresentationApply) return
    const container = this.floatingSubtitle
    if (!container) return
    // Floating container host tarafından düşürüldüyse doğru köke geri ekle;
    // aksi halde display:none'da kalır.
    if (this.layoutMode === 'floating' && !container.isConnected) {
      const root = this.getFloatingRoot()
      if (container.parentElement !== root) root.appendChild(container)
    }
    // Host re-render'ı kardeş kutuyu düşürmüş olabilir.
    this.reconcileBelowBinding()
    this.applyOriginalRowVisibility()
    const ready = this.isLayoutReady()
    container.style.display =
      this.overlayShown && ready
        ? this.layoutMode === 'below-caption'
          ? 'block'
          : 'flex'
        : 'none'
  }

  private isLayoutReady(): boolean {
    const container = this.floatingSubtitle
    if (!container || !container.isConnected) return false
    if (this.layoutMode === 'floating') return true
    return this.isBelowTargetReady()
  }

  private isBelowTargetReady(): boolean {
    const container = this.floatingSubtitle
    const anchor = this.belowAnchor
    const target = this.belowMountAfter
    if (!container || !anchor || !target) return false
    if (
      !isUsablePresentationMount(
        target,
        anchor,
        document,
        document.defaultView,
      )
    ) {
      return false
    }
    return (
      container.isConnected &&
      container.parentElement === target.parentElement &&
      container.previousElementSibling === target
    )
  }

  private applyOriginalRowVisibility(storage?: StorageData): void {
    if (!this.originalEl) return
    if ((storage ?? this.latestStorage)?.showOriginalSubtitle === false) {
      this.originalEl.style.display = 'none'
      return
    }
    if (this.layoutMode !== 'below-caption') {
      this.originalEl.style.display = ''
      return
    }
    const anchor = this.belowAnchor
    // Cue aralıklarında anchor metni boşalsa bile bir kez görülen özgün
    // metinden sonra eklenti satırı gizli kalır: yükseklik titremez ve eski
    // çeviri kaynağı tekrar görünmez.
    if (
      anchor &&
      anchor.isConnected &&
      readVisibleText(anchor, { win: document.defaultView }).length > 0
    ) {
      this.belowAnchorHadText = true
    }
    this.originalEl.style.display = this.belowAnchorHadText ? 'none' : ''
  }

  private applyBelowCaptionLayout(
    anchor: HTMLElement | null,
    target: HTMLElement | null,
    storage: StorageData,
  ): void {
    const container = this.floatingSubtitle
    if (!container) return

    this.detachDrag()
    this.detachContextMenu()
    this.layoutMode = 'below-caption'

    if (target && anchor) {
      // Tüm yeniden ekleme yolları aynı bütçeden geçer; host her apply'da
      // kardeş kutuyu düşürse bile hedef başına deneme sınırlıdır.
      this.bindBelowContainer(anchor, target)
    } else {
      this.clearBelowMountTarget()
    }

    // Eklenti kendi özgün satırını yalnızca anchor hiç metin taşımadıysa
    // gösterir; çift metin oluşturmaz.
    this.applyOriginalRowVisibility(storage)
    if (this.translatedEl) this.translatedEl.style.display = ''

    // Görünür yapmadan önce konum ve stiller tamamlanır.
    container.style.position = 'static'
    // Konumlandırma akışa bırakılır; kayıtlı x/y kaldırılır.
    container.style.left = ''
    container.style.top = ''
    container.style.width = '100%'
    container.style.minHeight = '0'
    container.style.height = 'auto'
    container.style.maxHeight = 'none'
    container.style.margin = '4px 0 10px'
    container.style.boxSizing = 'border-box'
    container.style.flex = 'none'
    container.style.zIndex = 'auto'
    container.style.transition = 'none'
    container.style.cursor = 'default'
    container.style.userSelect = 'text'
    container.style.flexDirection = ''
    container.style.justifyContent = ''
    container.style.overflow = 'visible'

    this.applyVisualSettings(storage)
    this.updateOverlayVisibility()
  }

  private applyFloatingLayout(
    storage: StorageData,
    forceGeometry: boolean,
    preserveBelow = false,
  ): void {
    const container = this.floatingSubtitle
    if (!container) return

    const modeChanged = this.layoutMode !== 'floating'
    this.layoutMode = 'floating'
    if (preserveBelow) {
      // Fullscreen görsel floating'i below hedefini/niyetini korur; yalnızca
      // observer kapatılır ve çıkışta yeniden bağlanabilmek için hedef başına
      // deneme sayacı tazelenir. Mutlak pencere tavanı korunur.
      this.belowRebindAttempts = 0
    } else {
      this.clearBelowTarget()
    }
    this.disconnectBelowObserver()

    const root = this.getFloatingRoot()
    if (container.parentElement !== root) root.appendChild(container)

    if (this.translatedEl) this.translatedEl.style.display = ''

    const geometry = this.floatingGeometryFor(storage)
    const isDraggable = storage.isDraggable ?? CONFIG.DEFAULT_DRAGGABLE

    // Sürükleme sırasında veya geometri değişmediyse left/top/width'i yeniden
    // yazma; aksi halde kutu eski kayıtlı konuma geri zıplar.
    const applyGeometry =
      modeChanged ||
      (!this.dragging &&
        (forceGeometry || geometry.key !== this.floatingGeometryKey))
    if (applyGeometry) {
      container.style.position = 'fixed'
      container.style.left = `${geometry.x}px`
      container.style.top = `${geometry.y}px`
      container.style.width = `${geometry.width}px`
      container.style.minHeight =
        storage.showOriginalSubtitle === false ? '0' : `${geometry.height}px`
      container.style.height = ''
      container.style.maxHeight = ''
      container.style.margin = '0'
      container.style.boxSizing = ''
      container.style.flex = ''
      container.style.zIndex = '2147483647'
      container.style.transition = 'all 0.2s ease'
      container.style.cursor = isDraggable ? 'move' : 'default'
      container.style.userSelect = 'none'
      container.style.flexDirection = 'column'
      container.style.justifyContent = 'center'
      container.style.textAlign = 'center'
      container.style.overflow = ''
      this.floatingGeometryKey = geometry.key
    } else if (container.style.position !== 'fixed') {
      container.style.position = 'fixed'
    }

    this.attachFloatingInteractions(storage)
    this.applyVisualSettings(storage)
    this.updateOverlayVisibility()
  }

  /**
   * Reinsert'i tek adımda ve sınırlı sayıda yapar. Observer reinsert sırasında
   * geçici olarak kapatılır; host tekrar düşürürse pencere başına en fazla
   * MAX_BELOW_REBINDS_PER_WINDOW deneme yapılır.
   */
  private reconcileBelowBinding(): boolean {
    if (this.layoutMode !== 'below-caption') return false
    const anchor = this.belowAnchor
    const target = this.belowMountAfter
    const container = this.floatingSubtitle
    if (!anchor || !target || !container) return false
    if (!target.isConnected || !target.parentElement) return false
    if (!anchor.isConnected) return false
    if (this.isBelowBindingReady(target)) {
      this.observeBelowMountTarget(target)
      return true
    }
    return this.bindBelowContainer(anchor, target)
  }

  /**
   * Kutuyu gerçek hedefin hemen ardına kardeş olarak bağlar. Bütçe yalnız
   * bağlama hedefi değişince sıfırlanır; anchor'ın yeniden oluşturulması
   * mevcut 5/1000 ms sınırını sıfırlamaz.
   */
  private bindBelowContainer(
    anchor: HTMLElement,
    target: HTMLElement,
  ): boolean {
    const container = this.floatingSubtitle
    if (!container || !target.parentElement) return false

    if (this.belowMountAfter !== target) {
      // Yeni hedef kendi deneme bütçesini açar; mutlak pencere tavanı
      // (MAX_BELOW_REBINDS_TOTAL_PER_WINDOW) ayrıca korunur.
      this.belowMountAfter = target
      this.belowRebindAttempts = 0
    }

    if (this.isBelowBindingReady(target)) {
      this.observeBelowMountTarget(target)
      return true
    }

    if (!this.consumeBelowRebindBudget()) {
      this.observeBelowMountTarget(target)
      return false
    }

    this.disconnectBelowObserver()
    try {
      // Özgün bloğun içine değil, güvenli hedefin hemen arkasına kardeş ekle.
      target.insertAdjacentElement('afterend', container)
    } finally {
      this.observeBelowMountTarget(target)
    }
    return this.isBelowBindingReady(target)
  }

  private isBelowBindingReady(target: HTMLElement): boolean {
    const container = this.floatingSubtitle
    return !!(
      container &&
      container.isConnected &&
      target.parentElement &&
      container.parentElement === target.parentElement &&
      container.previousElementSibling === target
    )
  }

  private consumeBelowRebindBudget(): boolean {
    const now = Date.now()
    if (now - this.belowRebindWindowAt > BELOW_REBIND_WINDOW_MS) {
      this.belowRebindAttempts = 0
      this.belowRebindTotalAttempts = 0
      this.belowRebindWindowAt = now
    }
    if (this.belowRebindAttempts >= MAX_BELOW_REBINDS_PER_WINDOW) return false
    if (
      this.belowRebindTotalAttempts >= MAX_BELOW_REBINDS_TOTAL_PER_WINDOW
    ) {
      return false
    }
    this.belowRebindAttempts += 1
    this.belowRebindTotalAttempts += 1
    return true
  }

  private scheduleBelowReconcile(): void {
    if (this.belowReconcileTimer !== null) return
    this.belowReconcileTimer = window.setTimeout(() => {
      this.belowReconcileTimer = null
      this.updateOverlayVisibility()
    }, 0)
  }

  private observeBelowMountTarget(target: HTMLElement): void {
    const parent = target.parentElement
    if (!parent) return
    if (this.belowObserver && this.belowObserverTarget === parent) return
    this.disconnectBelowObserver()
    if (typeof MutationObserver === 'undefined') return
    this.belowObserver = new MutationObserver(() => {
      this.scheduleBelowReconcile()
    })
    this.belowObserverTarget = parent
    this.belowObserver.observe(parent, { childList: true })
  }

  private disconnectBelowObserver(): void {
    if (this.belowObserver) this.belowObserver.disconnect()
    this.belowObserver = null
    this.belowObserverTarget = null
    if (this.belowReconcileTimer !== null) {
      window.clearTimeout(this.belowReconcileTimer)
      this.belowReconcileTimer = null
    }
  }

  private clearBelowMountTarget(): void {
    this.belowMountAfter = null
    // Yalnız hedef başına sayaç sıfırlanır; toplam pencere tavanı aynı
    // kaynak içindeki hedef-yok/hedef-var döngülerinde korunur.
    this.belowRebindAttempts = 0
    this.disconnectBelowObserver()
  }

  private clearBelowTarget(): void {
    this.belowAnchor = null
    this.belowAnchorHadText = false
    this.belowSource = null
    this.clearBelowMountTarget()
    this.belowRebindTotalAttempts = 0
    this.belowRebindWindowAt = 0
  }

  private floatingGeometryFor(storage: StorageData): {
    x: number
    y: number
    width: number
    height: number
    key: string
  } {
    const position = storage.subtitlePosition || CONFIG.DEFAULT_SUBTITLE_POSITION
    const width = storage.subtitleWidth || CONFIG.DEFAULT_SUBTITLE_WIDTH
    const height = storage.subtitleHeight || CONFIG.DEFAULT_SUBTITLE_HEIGHT
    const initialPosition = this.calculateInitialPosition(position, width, height)
    const x = storage.subtitleX ?? initialPosition.x
    const y = storage.subtitleY ?? initialPosition.y
    return {
      x,
      y,
      width,
      height,
      key: `${position}|${width}|${height}|${x}|${y}`,
    }
  }

  private getFloatingRoot(): HTMLElement {
    const fullscreenElement = document.fullscreenElement as HTMLElement | null
    if (fullscreenElement) {
      if (fullscreenElement.tagName?.toLowerCase() !== 'video') {
        return fullscreenElement
      }
      // Video öğesinin kendisi tam ekrandaysa çocuk eklemek geçersizdir;
      // oynatıcı kapsayıcısını kullan, yoksa body'ye dön.
      const parent = fullscreenElement.parentElement
      if (parent && parent !== document.documentElement) return parent
    }
    return document.body
  }

  private attachFloatingInteractions(storage: StorageData): void {
    const container = this.floatingSubtitle
    if (!container) return
    const isDraggable = storage.isDraggable ?? CONFIG.DEFAULT_DRAGGABLE
    if (isDraggable) {
      if (!this.dragRegistrationCleanup) this.addDragFunctionality(container)
    } else {
      this.detachDrag()
    }
    if (!this.contextMenuCleanup) this.addContextMenu(container)
  }

  /** İki metin elemanı ve hata alanı yalnızca bir kez oluşturulur. */
  private buildChildren(container: HTMLElement, storage: StorageData): void {
    const original = document.createElement('div')
    original.className = 'original-subtitle'
    original.style.cssText = `
      font-weight: ${storage.originFontWeight || CONFIG.DEFAULT_FONT_WEIGHT};
      text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
      margin-bottom: 8px;
      line-height: 1.4;
      white-space: pre-wrap;
    `

    const translated = document.createElement('div')
    translated.className = 'translated-subtitle'
    translated.style.cssText = `
      font-weight: ${storage.translatedFontWeight || CONFIG.DEFAULT_FONT_WEIGHT};
      text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
      line-height: 1.4;
      white-space: pre-wrap;
    `

    const error = document.createElement('div')
    error.className = 'translation-error'
    error.style.cssText = `
      display: none;
      color: #ff4d4f;
      font-weight: bold;
      font-size: 13px;
      text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
      margin-top: 6px;
      line-height: 1.4;
      word-break: break-word;
    `

    container.appendChild(original)
    container.appendChild(translated)
    container.appendChild(error)

    this.originalEl = original
    this.translatedEl = translated
    this.errorEl = error
  }

  /**
   * İngilizce/Türkçe çiftini tek senkron işlemde günceller.
   * Kutu, elemanlar ve innerHTML'e dokunulmaz.
   */
  private renderPair(
    source: string,
    translation: string,
    storage: StorageData,
  ): void {
    this.ensureOverlay(storage)
    const container = this.floatingSubtitle
    if (!container || !this.originalEl || !this.translatedEl) return

    this.originalEl.textContent = source
    this.translatedEl.textContent = translation
    this.clearError()
    this.overlayShown = true
    // Yerleşim zaten presentation/storage değişiminde uygulandı; render
    // yalnızca metni ve görünürlüğü günceller.
    this.updateOverlayVisibility()

    this.lastRenderedPair = { source, translation }
  }

  /** Son render edilen çift (testler ve hata ayıklama için). */
  public get renderedPair(): VisiblePair | null {
    return this.lastRenderedPair
  }

  public get isScanning(): boolean {
    return this.enabled && this.detector !== null
  }

  public get detectionStatus(): DetectionStatus {
    return this.lastDetectionStatus
  }

  private showError(message: string): void {
    const storage = this.latestStorage
    if (!storage) return
    this.ensureOverlay(storage)
    if (!this.errorEl || !this.floatingSubtitle) return

    this.errorEl.textContent = `⚠️ ${message}`
    this.errorEl.style.display = 'block'
    this.overlayShown = true
    this.updateOverlayVisibility()
  }

  private clearError(): void {
    if (this.errorEl) {
      this.errorEl.textContent = ''
      this.errorEl.style.display = 'none'
    }
  }

  private hideOverlay(): void {
    this.overlayShown = false
    this.endDrag()
    if (this.floatingSubtitle) {
      this.floatingSubtitle.style.display = 'none'
    }
  }

  private removeOverlay(): void {
    this.detachDrag()
    this.detachContextMenu()
    this.disconnectBelowObserver()
    if (this.floatingSubtitle) {
      this.floatingSubtitle.remove()
    }
    this.floatingSubtitle = null
    this.originalEl = null
    this.translatedEl = null
    this.errorEl = null
    this.overlayShown = false
    this.dragging = false
    this.layoutMode = 'floating'
    this.clearBelowTarget()
    this.floatingGeometryKey = ''
    this.lastRenderedPair = null
  }

  private applyVisualSettings(storage: StorageData): void {
    const container = this.floatingSubtitle
    if (!container) return

    const backgroundColor =
      storage.backgroundColor || CONFIG.DEFAULT_BACKGROUND_COLOR
    const opacity = storage.backgroundOpacity ?? CONFIG.DEFAULT_OPACITY

    container.style.backgroundColor = backgroundColor
    // Video altı akışta opacity tüm metni yarı saydam yapmamalı.
    container.style.opacity =
      this.layoutMode === 'below-caption' ? '1' : opacity

    if (this.originalEl) {
      this.originalEl.style.color =
        storage.originFontColor || CONFIG.DEFAULT_ORIGIN_FONT_COLOR
      this.originalEl.style.fontSize = `${storage.originFontSize || CONFIG.DEFAULT_FONT_SIZE}px`
    }
    if (this.translatedEl) {
      this.translatedEl.style.color =
        storage.translatedFontColor || CONFIG.DEFAULT_TRANSLATED_FONT_COLOR
      this.translatedEl.style.fontSize = `${storage.translatedFontSize || CONFIG.DEFAULT_FONT_SIZE}px`
    }
    this.applyOriginalRowVisibility(storage)
  }

  private calculateInitialPosition(
    position: string,
    width: number,
    height: number,
  ): { x: number; y: number } {
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    switch (position) {
      case 'top':
        return { x: (viewportWidth - width) / 2, y: 50 }
      case 'center':
        return { x: (viewportWidth - width) / 2, y: (viewportHeight - height) / 2 }
      case 'bottom':
      default:
        return {
          x: (viewportWidth - width) / 2,
          y: viewportHeight - height - 100,
        }
    }
  }

  private addDragFunctionality(container: HTMLElement): void {
    if (this.dragRegistrationCleanup) return
    let startX = 0
    let startY = 0
    let initialX = 0
    let initialY = 0

    const handleMouseDown = (e: MouseEvent) => {
      if (this.layoutMode !== 'floating' || this.dragSessionCleanup) return
      this.dragging = true
      startX = e.clientX
      startY = e.clientY
      initialX = container.offsetLeft
      initialY = container.offsetTop

      container.style.cursor = 'grabbing'
      container.style.transition = 'none'

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      this.dragSessionCleanup = () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        this.dragSessionCleanup = null
      }
      e.preventDefault()
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!this.dragging || this.layoutMode !== 'floating') return
      const deltaX = e.clientX - startX
      const deltaY = e.clientY - startY
      const maxX = window.innerWidth - container.offsetWidth
      const maxY = window.innerHeight - container.offsetHeight
      const clampedX = Math.max(0, Math.min(initialX + deltaX, maxX))
      const clampedY = Math.max(0, Math.min(initialY + deltaY, maxY))
      container.style.left = `${clampedX}px`
      container.style.top = `${clampedY}px`
    }

    const handleMouseUp = () => {
      if (!this.dragging) return
      this.commitDragPosition()
      this.dragging = false
      this.dragSessionCleanup?.()
      container.style.cursor = 'move'
      container.style.transition = 'all 0.2s ease'
    }

    container.addEventListener('mousedown', handleMouseDown)
    this.dragRegistrationCleanup = () => {
      this.dragging = false
      this.dragSessionCleanup?.()
      container.removeEventListener('mousedown', handleMouseDown)
      this.dragRegistrationCleanup = null
    }
  }

  /** Sürüklenen kutunun konumunu depoya ve geometri anahtarına işler. */
  private commitDragPosition(): void {
    const container = this.floatingSubtitle
    if (!container || this.layoutMode !== 'floating') return
    const left = Number.parseFloat(container.style.left)
    const top = Number.parseFloat(container.style.top)
    // JSDOM'da offsetLeft/offsetTop layout hesaplamaz; stil değeri önceliklidir.
    const x = Number.isFinite(left) ? left : container.offsetLeft
    const y = Number.isFinite(top) ? top : container.offsetTop
    if (this.latestStorage) {
      this.latestStorage = {
        ...this.latestStorage,
        subtitleX: x,
        subtitleY: y,
      }
      this.floatingGeometryKey = this.floatingGeometryFor(
        this.latestStorage,
      ).key
    }
    void this.saveSubtitlePosition(x, y)
  }

  /**
   * Aktif sürükleme oturumunu bitirir. Mid-drag layout değişiminde konum
   * kaybolmasın diye önce mevcut konum kaydedilir.
   */
  private endDrag(): void {
    if (this.dragging) this.commitDragPosition()
    this.dragging = false
    this.dragSessionCleanup?.()
    if (this.floatingSubtitle && this.layoutMode !== 'below-caption') {
      const draggable =
        this.latestStorage?.isDraggable ?? CONFIG.DEFAULT_DRAGGABLE
      this.floatingSubtitle.style.cursor = draggable ? 'move' : 'default'
      this.floatingSubtitle.style.transition = 'all 0.2s ease'
    }
  }

  /** Sürükleme oturumunu ve mousedown kaydını birlikte kaldırır. */
  private detachDrag(): void {
    this.endDrag()
    const cleanup = this.dragRegistrationCleanup
    if (cleanup) cleanup()
  }

  private addContextMenu(container: HTMLElement): void {
    if (this.contextMenuCleanup) return
    const handler = (e: MouseEvent) => {
      if (this.layoutMode !== 'floating') return
      e.preventDefault()
      this.showPositionMenu(e.clientX, e.clientY)
    }
    container.addEventListener('contextmenu', handler)
    this.contextMenuCleanup = () => {
      container.removeEventListener('contextmenu', handler)
      this.contextMenuCleanup = null
    }
  }

  private detachContextMenu(): void {
    const cleanup = this.contextMenuCleanup
    if (cleanup) cleanup()
  }

  private showPositionMenu(x: number, y: number): void {
    const existingMenu = document.getElementById('subtitle-position-menu')
    if (existingMenu) existingMenu.remove()

    const menu = document.createElement('div')
    menu.id = 'subtitle-position-menu'
    menu.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      background: rgba(0, 0, 0, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      padding: 8px 0;
      z-index: 2147483648;
      font-family: Arial, sans-serif;
      font-size: 14px;
      color: white;
      min-width: 150px;
    `

    const positions = [
      { label: '顶部', value: 'top' },
      { label: '中央', value: 'center' },
      { label: '底部', value: 'bottom' },
      { label: '重置位置', value: 'reset' },
    ]

    positions.forEach((pos) => {
      const item = document.createElement('div')
      item.textContent = pos.label
      item.style.cssText = 'padding: 8px 16px; cursor: pointer;'
      item.addEventListener('click', () => {
        void this.handlePositionChange(pos.value)
        menu.remove()
      })
      menu.appendChild(item)
    })

    document.body.appendChild(menu)

    setTimeout(() => {
      document.addEventListener('click', () => menu.remove(), { once: true })
    }, 100)
  }

  private async handlePositionChange(position: string): Promise<void> {
    // Video altı modda konum/boyut yönetimi kapalıdır.
    if (this.layoutMode !== 'floating') return
    if (position === 'reset') {
      await this.saveSubtitlePosition(null, null, 'bottom')
      const storage = await this.readStorage()
      this.latestStorage = storage
      if (this.floatingSubtitle) {
        const width = storage.subtitleWidth || CONFIG.DEFAULT_SUBTITLE_WIDTH
        const height = storage.subtitleHeight || CONFIG.DEFAULT_SUBTITLE_HEIGHT
        const initial = this.calculateInitialPosition('bottom', width, height)
        this.floatingSubtitle.style.left = `${initial.x}px`
        this.floatingSubtitle.style.top = `${initial.y}px`
      }
      return
    }

    await this.saveSubtitlePosition(null, null, position)
    const storage = await this.readStorage()
    this.latestStorage = storage
    if (this.floatingSubtitle) {
      const width = storage.subtitleWidth || CONFIG.DEFAULT_SUBTITLE_WIDTH
      const height = storage.subtitleHeight || CONFIG.DEFAULT_SUBTITLE_HEIGHT
      const initial = this.calculateInitialPosition(position, width, height)
      this.floatingSubtitle.style.left = `${initial.x}px`
      this.floatingSubtitle.style.top = `${initial.y}px`
    }
  }

  private async saveSubtitlePosition(
    x?: number | null,
    y?: number | null,
    position?: string,
  ): Promise<void> {
    try {
      const updateData: Partial<StorageData> = {}
      if (x !== null && x !== undefined) updateData.subtitleX = x
      if (y !== null && y !== undefined) updateData.subtitleY = y
      if (position) updateData.subtitlePosition = position as any
      await chrome.storage.local.set(updateData)
    } catch (error) {
      console.error('Error saving subtitle position:', error)
    }
  }

  // --------------------------------------------------------------- yardımcılar

  private closeActivePort(): void {
    const port = this.activePort
    this.activePort = null
    if (port) this.closePort(port)
  }

  private closePort(port: chrome.runtime.Port): void {
    if (this.activePort === port) this.activePort = null
    try {
      port.disconnect()
    } catch {
      // port zaten kapalı
    }
  }

  /**
   * Önceki sürümün geniş seçicilerle altyazıyı gizleyen stilini kaldırır.
   *
   * İlk sürümde oynatıcının kendi altyazısı görünür kalır; dedektör kaynağı
   * display:none ile gizlenmez. Çeviri kutusu oynatıcının üzerinde ayrı bir
   * katman olarak durur.
   */
  private removeLegacyHideStyle(): void {
    const styleElement = document.getElementById('hide-original-subtitle-style')
    if (styleElement) styleElement.remove()
  }

  private cleanupOrphanContainers(): void {
    const all = document.querySelectorAll(`.${CONTAINER_CLASS}`)
    all.forEach((el) => {
      if (el !== this.floatingSubtitle) el.remove()
    })
  }

  private readStorage(): Promise<StorageData> {
    return new Promise((resolve, reject) => {
      if (!chrome.runtime?.id) {
        reject(new Error('Extension context invalidated'))
        return
      }
      chrome.storage.local.get(null, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve(result as StorageData)
        }
      })
    })
  }
}

export function sameSource(a: SourceRef, b: SourceRef): boolean {
  return (
    a.documentId === b.documentId &&
    a.videoId === b.videoId &&
    a.sourceId === b.sourceId &&
    a.generation === b.generation &&
    a.kind === b.kind
  )
}
