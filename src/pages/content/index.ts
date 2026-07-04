import throttle from 'lodash/throttle'

interface StorageData {
  status: boolean
  apiKey: string
  baseURL: string
  prompt: string
  domConfigs: DomConfig[]
  backgroundColor?: string
  backgroundOpacity?: string
  originFontColor?: string
  originFontWeight?: string
  originFontSize?: string
  translatedFontColor?: string
  translatedFontWeight?: string
  translatedFontSize?: string
  // 新增字幕位置配置
  subtitlePosition?: 'bottom' | 'top' | 'center' | 'custom'
  subtitleX?: number
  subtitleY?: number
  subtitleWidth?: number
  subtitleHeight?: number
  isDraggable?: boolean
}

interface DomConfig {
  domain: string
  selector: string
  selectors?: string[]
}

const UI_NOISE_PATTERNS: RegExp[] = [
  /\b\d+\s*more\b/i,
  /\bauto\b/i,
  /\bsubtitles?\b/i,
  /\bcaptions?\b/i,
  /\blanguages?\b/i,
  /\|\s*$/,
  /^\s*\|/,
  /\|\s*\|/,
  /^[a-z]{2}\s*\[/i,
  /\]\s*$/,
]

const UI_LANGUAGE_NAMES = new Set([
  'english', 'turkish', 'türkçe', 'chinese', 'spanish', 'french',
  'german', 'portuguese', 'japanese', 'korean', 'arabic', 'hindi',
  'russian', 'italian', 'dutch', 'polish', 'auto',
])

function isLikelyUIText(text: string): boolean {
  const t = (text || '').trim()
  if (!t) return true
  if (t.length < 4) return true
  for (const re of UI_NOISE_PATTERNS) {
    if (re.test(t)) return true
  }
  const lower = t.toLowerCase()
  if (UI_LANGUAGE_NAMES.has(lower)) return true
  if (UI_LANGUAGE_NAMES.has(lower.replace(/\[.*?\]/g, '').trim())) return true
  return false
}

const CONFIG = {
  DEFAULT_BACKGROUND_COLOR: 'rgba(0, 0, 0, 0.75)',
  DEFAULT_OPACITY: '0.8',
  DEFAULT_ORIGIN_FONT_COLOR: 'white',
  DEFAULT_TRANSLATED_FONT_COLOR: 'yellow',
  DEFAULT_FONT_WEIGHT: 'normal',
  DEFAULT_FONT_SIZE: '16',
  CHECK_INTERVAL: 300, // 0.3 秒 - 更频繁的检测
  // 新增默认位置配置
  DEFAULT_SUBTITLE_POSITION: 'bottom' as const,
  DEFAULT_SUBTITLE_WIDTH: 600,
  DEFAULT_SUBTITLE_HEIGHT: 120,
  DEFAULT_DRAGGABLE: true,
}

class TranslationManager {
  private isActive: boolean = true
  private intervalId: number | null = null
  private lastSubtitleContent: string = ''
  private lastSubtitleTimestamp: number = 0
  private translationCache: Map<string, string> = new Map()
  private videoWrapper: HTMLElement | null = null
  private subtitleTimeout: number | null = null
  private translateRetryCount: number = 0
  private readonly MAX_TRANSLATE_RETRIES = 3
  private lastErrorKey: string = ''
  private lastErrorTime: number = 0
  private readonly ERROR_THROTTLE_MS = 30000
  private lastRequestTime: number = 0
  private lastRequestText: string = ''
  // 新增浮动字幕容器相关属性
  private floatingSubtitle: HTMLElement | null = null
  private isDragging: boolean = false
  private dragOffset: { x: number; y: number } = { x: 0, y: 0 }
  private mutationObserver: MutationObserver | null = null

  constructor() {}

  public async start() {
    console.log('TranslationManager starting...')
    this.cleanupAllSubtitles()
    await this.initialize()
    this.registerEventListeners()
    console.log('TranslationManager started')
  }

  private cleanupAllSubtitles() {
    const allFloatingSubtitles = document.querySelectorAll(
      '.udemy-translate-floating-subtitle',
    )
    allFloatingSubtitles.forEach((subtitle) => {
      console.log('🧹 Cleaning up old subtitle container')
      subtitle.remove()
    })
  }

  private registerEventListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'STATUS_CHANGED') {
        this.handleStatusChange(message.status)
      }
    })

    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local') {
        this.handleStorageChange(changes)
      }
    })

    document.addEventListener('visibilitychange', () => {
      this.handleVisibilityChange()
    })
  }

  private async initialize() {
    try {
      const { status, domConfigs } = await this.getStorageData()
      if (status && this.isDomainAllowed(domConfigs)) {
        console.log('Initial setup: Starting translation')
        this.startTranslation()
      } else {
        console.log(
          'Initial setup: Translation not enabled or domain not allowed',
        )
      }
    } catch (error) {
      console.error('Initial setup error:', error)
    }
  }

  private async getStorageData(): Promise<StorageData> {
    return new Promise((resolve, reject) => {
      if (!chrome.runtime?.id) {
        reject(new Error('Extension context invalidated'))
        return
      }
      chrome.storage.local.get(null, (result) => {
        chrome.runtime.lastError
          ? reject(chrome.runtime.lastError)
          : resolve(result as StorageData)
      })
    })
  }

  private isDomainAllowed(domConfigs: DomConfig[]): DomConfig | undefined {
    if (!domConfigs) return undefined
    const currentOrigin = window.location.origin
    const currentHost = window.location.hostname

    return domConfigs.find((config) => {
      if (!config?.domain) return false
      if (currentOrigin === config.domain) return true

      try {
        const cfgUrl = new URL(config.domain)
        return (
          currentHost === cfgUrl.hostname ||
          currentHost.endsWith('.' + cfgUrl.hostname)
        )
      } catch {
        return (
          currentHost === config.domain ||
          currentHost.endsWith('.' + config.domain)
        )
      }
    })
  }

  private startTranslation() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
    }
    this.getStorageData()
      .then(({ domConfigs }) => {
        const matchedConfig = this.isDomainAllowed(domConfigs)
        if (matchedConfig) {
          const sels = this.getCandidateSelectors(matchedConfig)
          this.createHideOriginalSubtitleStyle(sels)
          this.setupMutationObserver(sels)
        }
      })
      .catch((error) => {
        console.error('Error in startTranslation:', error)
      })
    this.intervalId = window.setInterval(
      () => this.checkAndTranslate(),
      CONFIG.CHECK_INTERVAL,
    )
  }

  private stopTranslation() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect()
      this.mutationObserver = null
    }
    this.cleanupSubtitles()
    this.showOriginalSubtitle()
  }

  private checkAndTranslate = throttle(async () => {
    if (!this.isActive) {
      return
    }

    try {
      const { status, domConfigs } = await this.getStorageData()

      if (!status) {
        return
      }

      const matchedConfig = this.isDomainAllowed(domConfigs)

      if (matchedConfig) {
        const candidateSelectors = this.getCandidateSelectors(matchedConfig)
        console.log(
          '🔍 Trying selectors:',
          JSON.stringify(candidateSelectors),
        )

        let rootElements: Element[] = []
        let usedSelector: string | null = null
        const candidateResults: { selector: string; elements: Element[]; uiScore: number }[] = []
        for (const sel of candidateSelectors) {
          if (!sel || sel.includes('..')) continue
          try {
            const found = Array.from(document.querySelectorAll(sel))
            if (found.length > 0) {
              const texts = found
                .map((el) => (el.textContent || '').trim())
                .filter(Boolean)
              const uiCount = texts.filter((t) => isLikelyUIText(t)).length
              const uiRatio = texts.length ? uiCount / texts.length : 1
              candidateResults.push({ selector: sel, elements: found, uiScore: uiRatio })
            }
          } catch (error) {
            console.warn('⚠️ Invalid selector:', sel, error)
          }
        }

        if (candidateResults.length === 0) {
          return
        }

        candidateResults.sort((a, b) => {
          if (a.uiScore !== b.uiScore) return a.uiScore - b.uiScore
          return b.elements.length - a.elements.length
        })

        const best = candidateResults[0]
        rootElements = best.elements
        usedSelector = best.selector
        console.log(
          '📊 Found elements:',
          rootElements.length,
          'via',
          usedSelector,
          '(uiScore=',
          best.uiScore,
          ')',
        )
        if (candidateResults.length > 1) {
          console.log(
            '   other candidates:',
            candidateResults
              .slice(1)
              .map((c) => `${c.selector} (n=${c.elements.length}, ui=${c.uiScore.toFixed(2)})`)
              .join(' | '),
          )
        }

        // 获取所有字幕文本并去重
        const allTexts = Array.from(rootElements)
          .map((element) => element.textContent?.trim())
          .filter((text) => text && text.length > 0)

        // 去除重复文本，只保留唯一值
        const uniqueTexts = allTexts.filter(
          (text, index, array) => array.indexOf(text) === index,
        )

        // 只处理最新的、不重复的字幕
        if (uniqueTexts.length > 0) {
          // 取最后一个非空文本作为当前字幕
          const currentText = uniqueTexts[uniqueTexts.length - 1]
          const currentTimestamp = Date.now()

          // 优化检测逻辑：检查内容变化和时间间隔
          const isNewContent = currentText !== this.lastSubtitleContent
          const isSignificantTimeGap =
            currentTimestamp - this.lastSubtitleTimestamp > 1000 // 1秒

          if (currentText && (isNewContent || isSignificantTimeGap)) {
            console.log('🎯 New subtitle detected:', currentText)
            console.log(
              '📅 Time since last:',
              currentTimestamp - this.lastSubtitleTimestamp,
              'ms',
            )
            this.lastSubtitleContent = currentText
            this.lastSubtitleTimestamp = currentTimestamp
            // Anti-spam: aynı text tekrar fire etmesin (3s throttle)
            const now = Date.now()
            if (
              now - this.lastRequestTime > 3000 ||
              this.lastRequestText !== currentText
            ) {
              this.lastRequestTime = now
              this.lastRequestText = currentText
              this.translateText(currentText, matchedConfig.selector)
            }
          }
        }
      }
    } catch (error) {
      console.error('Error in checkAndTranslate:', error)
    }
  }, 100, { leading: true, trailing: true })

  private setupMutationObserver(selectors: string[]) {
    const valid = (selectors || []).filter(
      (s) => s && typeof s === 'string' && !s.includes('..'),
    )
    if (valid.length === 0) {
      console.error('❌ No valid selectors for MutationObserver')
      return
    }
    // 清理现有的观察器
    if (this.mutationObserver) {
      this.mutationObserver.disconnect()
    }

    this.mutationObserver = new MutationObserver((mutations) => {
      let hasSubtitleChange = false

      mutations.forEach((mutation) => {
        if (
          mutation.type === 'childList' ||
          mutation.type === 'characterData'
        ) {
          const target = mutation.target as Element

          for (const sel of valid) {
            try {
              if (target.matches && target.matches(sel)) {
                hasSubtitleChange = true
                break
              }
              if (target.querySelector && target.querySelector(sel)) {
                hasSubtitleChange = true
                break
              }
            } catch {
              // ignore invalid selector
            }
          }
        }
      })

      if (hasSubtitleChange) {
        console.log('🔄 MutationObserver detected subtitle change')
        this.checkAndTranslate()
      }
    })

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      characterDataOldValue: false,
    })

    console.log('👁️ MutationObserver setup for selectors:', valid)
  }

  private async translateText(text: string, selector: string) {
    if (!text.trim()) return

    if (this.translationCache.has(text)) {
      const translatedText = this.translationCache.get(text)!
      console.log('📋 Using cached translation:', text, '->', translatedText)
      this.updateSubtitle(text, translatedText)
      return
    }

    try {
      const storage = await this.getStorageData()
      const targetLanguage =
        (storage as any).providerConfig?.targetLanguage ||
        (storage as any).openaiConfig?.targetLanguage ||
        (storage as any).ollamaConfig?.targetLanguage ||
        'English'

      const sendMessagePromise = new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: 'TRANSLATE_TEXT',
            text: text,
            targetLanguage,
          },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError)
              return
            }
            resolve(response)
          },
        )
      })

      const response = (await sendMessagePromise) as any

      if (response && response.type === 'TRANSLATED_TEXT') {
        let translatedText = response.translatedText.split('@@@')[0].trim()
        translatedText = translatedText
          .replace(/\n/g, ' ')
          .replace(/@/g, ' ')
          .trim()

        this.translationCache.set(text, translatedText)
        this.translateRetryCount = 0
        this.updateSubtitle(text, translatedText)
      } else if (response && response.type === 'TRANSLATION_ERROR') {
        const rawError = response.error || 'Unknown translation error'
        console.error('Translation failed:', rawError)
        const errorKey = `${text.slice(0, 60)}::${rawError.slice(0, 100)}`
        const now = Date.now()
        if (
          this.lastErrorKey === errorKey &&
          now - this.lastErrorTime < this.ERROR_THROTTLE_MS
        ) {
          return
        }
        this.lastErrorKey = errorKey
        this.lastErrorTime = now

        const userMessage = this.friendlyErrorMessage(rawError)
        this.showTranslationError(text, userMessage)
      }
    } catch (error) {
      const msg = (error as any)?.message ?? String(error)
      const errorKey = `${text.slice(0, 60)}::${msg.slice(0, 100)}`
      const now = Date.now()

      // Anti-spam: aynı hata 30s içinde 1 kez loglanır/gösterilir
      if (
        this.lastErrorKey === errorKey &&
        now - this.lastErrorTime < 30000
      ) {
        return
      }
      this.lastErrorKey = errorKey
      this.lastErrorTime = now

      console.error('Error sending translation request:', error)
      // 如果是连接错误或扩展上下文失效，可能是 background script 未加载或插件重新加载
      const retryable =
        msg.includes('Could not establish connection') ||
        msg.includes('Extension context invalidated')

      if (retryable && this.translateRetryCount < this.MAX_TRANSLATE_RETRIES && this.isActive) {
        this.translateRetryCount++
        console.log(
          `Background script may not be loaded yet or extension reloaded, retrying (${this.translateRetryCount}/${this.MAX_TRANSLATE_RETRIES}) in 2 seconds...`,
        )
        setTimeout(() => this.translateText(text, selector), 2000)
      } else if (retryable) {
        console.warn(
          `Translation retries exhausted (${this.translateRetryCount}/${this.MAX_TRANSLATE_RETRIES}) or page inactive`,
        )
        this.showTranslationError(
          text,
          'Background script unreachable. Reload the extension.',
        )
      } else {
        this.showTranslationError(text, msg || 'Unknown error')
      }
    }
  }

  private friendlyErrorMessage(raw: string): string {
    const lower = raw.toLowerCase()
    if (
      lower.includes('403') ||
      lower.includes('forbidden') ||
      lower.includes('cors')
    ) {
      return (
        '🚫 Ollama rejected the request (CORS). ' +
        'Restart Ollama with: OLLAMA_ORIGINS="chrome-extension://*" ollama serve'
      )
    }
    if (lower.includes('404') || lower.includes('not found')) {
      const modelMatch = raw.match(/model ["']?([^"'\s]+)["']?/i)
      const model = modelMatch?.[1]
      if (model) {
        return `🔍 Model "${model}" not found. Run: ollama pull ${model}`
      }
      return '🔍 Resource not found. Check Base URL and Model Name.'
    }
    if (lower.includes('401') || lower.includes('unauthorized')) {
      return '🔑 Invalid API key. Check provider credentials.'
    }
    if (
      lower.includes('failed to fetch') ||
      lower.includes('connection refused') ||
      lower.includes('network')
    ) {
      return '🔌 Cannot reach server. Check if Ollama is running and Base URL is correct.'
    }
    if (lower.includes('timeout') || lower.includes('aborted')) {
      return '⏱ Request timed out. Server may be slow or unreachable.'
    }
    return raw
  }

  private showTranslationError(originalText: string, errorMessage: string) {
    const storage = this.getStorageData()
    storage.then((items) => {
      this.createOrUpdateFloatingError(originalText, errorMessage, items)
    })
  }

  private createOrUpdateFloatingError(
    originalText: string,
    errorMessage: string,
    items: StorageData,
  ) {
    const existingContainers = document.querySelectorAll(
      '.udemy-translate-floating-subtitle',
    )
    existingContainers.forEach((c) => {
      if (c !== this.floatingSubtitle) c.remove()
    })

    if (!this.floatingSubtitle) {
      const existing = document.getElementById(
        'udemy-translate-floating-subtitle',
      ) as HTMLElement | null
      if (existing) {
        this.floatingSubtitle = existing
      } else {
        this.floatingSubtitle = this.createFloatingSubtitleContainer(items)
        document.body.appendChild(this.floatingSubtitle)
      }
    }

    const container = this.floatingSubtitle
    container.innerHTML = ''
    container.style.display = 'flex'

    const title = document.createElement('div')
    title.style.cssText = `
      color: #ff4d4f;
      font-weight: bold;
      font-size: 14px;
      margin-bottom: 6px;
      text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
    `
    title.textContent = '⚠️ Translation error'

    const msg = document.createElement('div')
    const errorFontSize = items.originFontSize || CONFIG.DEFAULT_FONT_SIZE
    msg.style.cssText = `
      color: ${items.originFontColor || CONFIG.DEFAULT_ORIGIN_FONT_COLOR};
      font-weight: ${items.originFontWeight || CONFIG.DEFAULT_FONT_WEIGHT};
      font-size: ${errorFontSize}px;
      text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
      margin-bottom: 6px;
      line-height: 1.4;
      word-break: break-word;
    `
    msg.textContent = errorMessage

    const hint = document.createElement('div')
    hint.style.cssText = `
      color: ${items.translatedFontColor || CONFIG.DEFAULT_TRANSLATED_FONT_COLOR};
      font-weight: ${items.translatedFontWeight || CONFIG.DEFAULT_FONT_WEIGHT};
      font-size: ${(items.translatedFontSize || CONFIG.DEFAULT_FONT_SIZE)}px;
      text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
      margin-top: 6px;
      line-height: 1.4;
      opacity: 0.85;
      word-break: break-word;
    `
    hint.textContent = `Original: "${originalText.slice(0, 120)}${originalText.length > 120 ? '...' : ''}"`

    container.appendChild(title)
    container.appendChild(msg)
    container.appendChild(hint)

    if (this.subtitleTimeout !== null) {
      clearTimeout(this.subtitleTimeout)
    }
    this.subtitleTimeout = window.setTimeout(() => {
      if (this.floatingSubtitle) {
        this.floatingSubtitle.style.display = 'none'
      }
      this.subtitleTimeout = null
    }, 10000)
  }

  private createHideOriginalSubtitleStyle(selectors: string[]) {
    const valid = (selectors || []).filter(
      (s) => s && typeof s === 'string' && !s.includes('..'),
    )
    if (valid.length === 0) {
      console.error('❌ No valid selectors to hide')
      return
    }
    console.log(
      '🔍 Creating hide style for selectors:',
      JSON.stringify(valid),
    )

    try {
      for (const s of valid) document.querySelectorAll(s)
    } catch (error) {
      console.error('❌ Invalid CSS selector:', error)
      return
    }

    const styleId = 'hide-original-subtitle-style'
    let style = document.getElementById(styleId) as HTMLStyleElement | null

    if (!style) {
      style = document.createElement('style')
      style.id = styleId
      document.head.appendChild(style)
    }

    const rules = valid
      .map((s) => `${s} { display: none !important; }`)
      .join('\n')
    style.textContent = rules

    console.log('✅ Hide style created successfully')
  }

  private getCandidateSelectors(config: DomConfig): string[] {
    const list = [config.selector, ...(config.selectors || [])]
      .map((s) => (s || '').trim())
      .filter(Boolean)
    return Array.from(new Set(list))
  }

  private showOriginalSubtitle() {
    const styleElement = document.getElementById('hide-original-subtitle-style')
    if (styleElement) {
      styleElement.remove()
    }
  }

  private updateSubtitle(originalText: string, translatedText: string) {
    console.log('🔥translation:', originalText, '->', translatedText)

    this.getStorageData()
      .then((items: StorageData) => {
        this.createOrUpdateFloatingSubtitle(originalText, translatedText, items)
      })
      .catch((error) => {
        console.error('Error getting storage data:', error)
      })
  }

  private createOrUpdateFloatingSubtitle(
    originalText: string,
    translatedText: string,
    items: StorageData,
  ) {
    // 清理所有可能存在的旧字幕容器（防止累积）
    const existingContainers = document.querySelectorAll(
      '.udemy-translate-floating-subtitle',
    )
    existingContainers.forEach((container) => {
      if (container !== this.floatingSubtitle) {
        container.remove()
      }
    })

    if (!this.floatingSubtitle) {
      const existingContainer = document.getElementById(
        'udemy-translate-floating-subtitle',
      ) as HTMLElement | null

      if (existingContainer) {
        this.floatingSubtitle = existingContainer
      } else {
        this.floatingSubtitle = this.createFloatingSubtitleContainer(items)
        document.body.appendChild(this.floatingSubtitle)
      }
    }

    this.updateFloatingSubtitleContent(
      originalText,
      translatedText,
      items,
      this.floatingSubtitle,
    )

    if (this.subtitleTimeout !== null) {
      clearTimeout(this.subtitleTimeout)
    }

    this.subtitleTimeout = window.setTimeout(() => {
      if (this.floatingSubtitle) {
        this.floatingSubtitle.style.display = 'none'
      }
      this.subtitleTimeout = null
    }, 3000)
  }

  private createFloatingSubtitleContainer(items: StorageData): HTMLElement {
    const container = document.createElement('div')
    container.className = 'udemy-translate-floating-subtitle'
    container.id = 'udemy-translate-floating-subtitle'

    const position = items.subtitlePosition || CONFIG.DEFAULT_SUBTITLE_POSITION
    const width = items.subtitleWidth || CONFIG.DEFAULT_SUBTITLE_WIDTH
    const height = items.subtitleHeight || CONFIG.DEFAULT_SUBTITLE_HEIGHT
    const isDraggable = items.isDraggable ?? CONFIG.DEFAULT_DRAGGABLE

    const initialPosition = this.calculateInitialPosition(
      position,
      width,
      height,
    )

    const x = items.subtitleX ?? initialPosition.x
    const y = items.subtitleY ?? initialPosition.y

    const backgroundColor =
      items.backgroundColor || CONFIG.DEFAULT_BACKGROUND_COLOR
    const opacity = items.backgroundOpacity || CONFIG.DEFAULT_OPACITY

    container.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${width}px;
      min-height: ${height}px;
      background-color: ${backgroundColor};
      opacity: ${opacity};
      border-radius: 8px;
      padding: 12px;
      z-index: 2147483647;
      font-family: Arial, sans-serif;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      border: 2px solid rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(5px);
      transition: all 0.2s ease;
      cursor: ${isDraggable ? 'move' : 'default'};
      user-select: none;
      display: flex;
      flex-direction: column;
      justify-content: center;
      text-align: center;
    `

    if (isDraggable) {
      this.addDragFunctionality(container)
    }

    this.addContextMenu(container)

    return container
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
        return {
          x: (viewportWidth - width) / 2,
          y: 50,
        }
      case 'center':
        return {
          x: (viewportWidth - width) / 2,
          y: (viewportHeight - height) / 2,
        }
      case 'bottom':
      default:
        return {
          x: (viewportWidth - width) / 2,
          y: viewportHeight - height - 100,
        }
    }
  }

  private updateFloatingSubtitleContent(
    originalText: string,
    translatedText: string,
    items: StorageData,
    container: HTMLElement,
  ) {
    container.innerHTML = ''
    container.style.display = 'flex'

    const originalSubtitle = document.createElement('div')
    originalSubtitle.className = 'original-subtitle'
    originalSubtitle.style.cssText = `
      color: ${items.originFontColor || CONFIG.DEFAULT_ORIGIN_FONT_COLOR};
      font-weight: ${items.originFontWeight || CONFIG.DEFAULT_FONT_WEIGHT};
      font-size: ${items.originFontSize || CONFIG.DEFAULT_FONT_SIZE}px;
      text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
      margin-bottom: 8px;
      line-height: 1.4;
    `
    originalSubtitle.textContent = originalText

    const translatedSubtitle = document.createElement('div')
    translatedSubtitle.className = 'translated-subtitle'
    translatedSubtitle.style.cssText = `
      color: ${
        items.translatedFontColor || CONFIG.DEFAULT_TRANSLATED_FONT_COLOR
      };
      font-weight: ${items.translatedFontWeight || CONFIG.DEFAULT_FONT_WEIGHT};
      font-size: ${items.translatedFontSize || CONFIG.DEFAULT_FONT_SIZE}px;
      text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
      line-height: 1.4;
    `
    translatedSubtitle.textContent = translatedText

    container.appendChild(originalSubtitle)
    container.appendChild(translatedSubtitle)
  }

  private addDragFunctionality(container: HTMLElement) {
    let startX = 0
    let startY = 0
    let initialX = 0
    let initialY = 0

    const handleMouseDown = (e: MouseEvent) => {
      this.isDragging = true
      startX = e.clientX
      startY = e.clientY
      initialX = container.offsetLeft
      initialY = container.offsetTop

      container.style.cursor = 'grabbing'
      container.style.transition = 'none'

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      e.preventDefault()
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!this.isDragging) return

      const deltaX = e.clientX - startX
      const deltaY = e.clientY - startY

      const newX = initialX + deltaX
      const newY = initialY + deltaY

      // 边界检查
      const maxX = window.innerWidth - container.offsetWidth
      const maxY = window.innerHeight - container.offsetHeight

      const clampedX = Math.max(0, Math.min(newX, maxX))
      const clampedY = Math.max(0, Math.min(newY, maxY))

      container.style.left = `${clampedX}px`
      container.style.top = `${clampedY}px`
    }

    const handleMouseUp = () => {
      if (this.isDragging) {
        this.isDragging = false
        container.style.cursor = 'move'
        container.style.transition = 'all 0.2s ease'

        // 保存位置
        this.saveSubtitlePosition(container.offsetLeft, container.offsetTop)

        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }

    container.addEventListener('mousedown', handleMouseDown)
  }

  private addContextMenu(container: HTMLElement) {
    container.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      this.showPositionMenu(e.clientX, e.clientY)
    })
  }

  private showPositionMenu(x: number, y: number) {
    // 移除现有菜单
    const existingMenu = document.getElementById('subtitle-position-menu')
    if (existingMenu) {
      existingMenu.remove()
    }

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
      item.style.cssText = `
        padding: 8px 16px;
        cursor: pointer;
        transition: background-color 0.2s;
      `
      item.addEventListener('mouseenter', () => {
        item.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'
      })
      item.addEventListener('mouseleave', () => {
        item.style.backgroundColor = 'transparent'
      })
      item.addEventListener('click', () => {
        this.handlePositionChange(pos.value)
        menu.remove()
      })
      menu.appendChild(item)
    })

    document.body.appendChild(menu)

    // 点击其他地方关闭菜单
    setTimeout(() => {
      document.addEventListener('click', () => menu.remove(), { once: true })
    }, 100)
  }

  private async handlePositionChange(position: string) {
    if (position === 'reset') {
      // 重置到默认位置
      await this.saveSubtitlePosition(null, null, 'bottom')
    } else {
      await this.saveSubtitlePosition(null, null, position)
    }

    // 重新创建字幕容器
    if (this.floatingSubtitle) {
      this.floatingSubtitle.remove()
      this.floatingSubtitle = null
    }
  }

  private async saveSubtitlePosition(
    x?: number | null,
    y?: number | null,
    position?: string,
  ) {
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

  private cleanupSubtitles() {
    if (this.floatingSubtitle) {
      this.floatingSubtitle.remove()
      this.floatingSubtitle = null
    }

    const allFloatingSubtitles = document.querySelectorAll(
      '.udemy-translate-floating-subtitle',
    )
    allFloatingSubtitles.forEach((subtitle) => {
      subtitle.remove()
    })

    if (this.videoWrapper) {
      const subtitleElement = this.videoWrapper.querySelector(
        '.translated-wrapper',
      )
      if (subtitleElement) {
        subtitleElement.remove()
      }
    }

    if (this.subtitleTimeout !== null) {
      clearTimeout(this.subtitleTimeout)
      this.subtitleTimeout = null
    }
  }

  public handleStatusChange(status: boolean) {
    console.log('Status changed:', status)
    if (status) {
      this.getStorageData()
        .then(({ domConfigs }) => {
          if (this.isDomainAllowed(domConfigs)) {
            console.log('Status changed to active, starting translation')
            this.startTranslation()
          } else {
            console.log('Status changed to active, but domain not allowed')
          }
        })
        .catch((error) => {
          console.error('Error in STATUS_CHANGED:', error)
        })
    } else {
      console.log('Status changed to inactive, stopping translation')
      this.stopTranslation()
    }
  }

  public handleStorageChange(changes: {
    [key: string]: chrome.storage.StorageChange
  }) {
    console.log('Storage changed:', changes)
    if (changes.status || changes.domConfigs) {
      this.getStorageData()
        .then(({ status, domConfigs }) => {
          if (status && this.isDomainAllowed(domConfigs)) {
            console.log('Status or domConfigs changed, starting translation')
            this.startTranslation()
          } else {
            console.log('Status or domConfigs changed, stopping translation')
            this.stopTranslation()
          }
        })
        .catch((error) => {
          console.error('Error in storage change:', error)
        })
    }
    if (changes.apiKey || changes.baseURL || changes.prompt) {
      this.getStorageData()
        .then(({ domConfigs }) => {
          if (this.isDomainAllowed(domConfigs)) {
            console.log('API settings changed, triggering translation')
            this.checkAndTranslate()
          } else {
            console.log('API settings changed, but domain not allowed')
          }
        })
        .catch((error) => {
          console.error('Error in storage change:', error)
        })
    }
  }

  public handleVisibilityChange() {
    this.isActive = !document.hidden
    console.log('Visibility changed, isActive:', this.isActive)
    if (this.isActive) {
      this.getStorageData()
        .then(({ status, domConfigs }) => {
          if (status && this.isDomainAllowed(domConfigs)) {
            console.log('Page became visible, starting translation')
            this.startTranslation()
          } else {
            console.log(
              'Page became visible, but translation not enabled or domain not allowed',
            )
          }
        })
        .catch((error) => {
          console.error('Error in visibility change:', error)
        })
    } else {
      console.log('Page became hidden, stopping translation')
      this.stopTranslation()
    }
  }
}

const translationManager = new TranslationManager()

// Start once; defer if the DOM is still loading, otherwise run immediately
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => translationManager.start(), {
    once: true,
  })
} else {
  translationManager.start()
}
