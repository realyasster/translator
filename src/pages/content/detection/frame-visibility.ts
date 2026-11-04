/**
 * Frame görünürlüğü köprüsü.
 *
 * Çocuk frame yalnızca kendi videolarının görünürlüğünü hesaplar; parent frame
 * iframe öğesinin kendi görünür alanıyla kesişimini bildirir. İç içe frame
 * görünürlüğü parent zinciri boyunca kesiştirilir. Köprü yalnızca frame kimliği
 * ve görünürlük geometrisi taşır.
 */

import { Rect } from '../../../types/detection'
import { FrameVisibilityProvider } from './video-registry'
import { intersectRects, rectArea } from './text'

const FRAME_MESSAGE_TYPE = 'SUBTITLE_TRANSLATOR_FRAME_VISIBILITY'
const FRAME_HELLO_TYPE = 'SUBTITLE_TRANSLATOR_FRAME_HELLO'

export interface FrameVisibilityOptions {
  window: Window
  document: Document
  isTopFrame?: boolean
  broadcastIntervalMs?: number
  now?: () => number
  onRegionChange?: (region: Rect | null, known: boolean) => void
}

interface FrameVisibilityMessage {
  type: typeof FRAME_MESSAGE_TYPE
  visible: boolean
  region: Rect | null
}

export class FrameVisibilityBridge implements FrameVisibilityProvider {
  private readonly win: Window
  private readonly doc: Document
  private readonly isTopFrame: boolean
  private readonly intervalMs: number
  private readonly onChange?: (region: Rect | null, known: boolean) => void
  private known: boolean
  private region: Rect | null = null
  private parentVisible = false
  private broadcastTimer: number | null = null
  private helloTimer: number | null = null
  private scheduledBroadcast: number | null = null
  private running = false
  private messageHandler: ((event: MessageEvent) => void) | null = null
  private scrollHandler: (() => void) | null = null
  private visibilityHandler: (() => void) | null = null
  private lastRegionKey = ''

  constructor(options: FrameVisibilityOptions) {
    this.win = options.window
    this.doc = options.document
    this.isTopFrame =
      options.isTopFrame ??
      (this.win.top === this.win || !this.win.parent)
    this.intervalMs = options.broadcastIntervalMs ?? 1000
    this.onChange = options.onRegionChange
    this.known = this.isTopFrame
    if (this.isTopFrame) {
      this.region = this.viewportRegion()
    }
  }

  public start(): void {
    if (this.running) return
    this.running = true

    this.messageHandler = (event: MessageEvent) => this.handleMessage(event)
    this.win.addEventListener('message', this.messageHandler as EventListener)
    this.scrollHandler = () => this.scheduleBroadcast()
    this.win.addEventListener('scroll', this.scrollHandler, true)
    this.win.addEventListener('resize', this.scrollHandler)
    this.visibilityHandler = () => {
      if (this.isTopFrame) this.region = this.viewportRegion()
      this.broadcastToChildren()
      this.notify()
    }
    this.doc.addEventListener('visibilitychange', this.visibilityHandler)

    if (this.isTopFrame) {
      this.broadcastTimer = this.win.setInterval(
        () => this.broadcastToChildren(),
        this.intervalMs,
      )
      this.broadcastToChildren()
    } else {
      this.sendHello()
      this.helloTimer = this.win.setInterval(() => {
        if (!this.known) this.sendHello()
        else if (this.helloTimer !== null) {
          this.win.clearInterval(this.helloTimer)
          this.helloTimer = null
        }
      }, 500)
      this.broadcastTimer = this.win.setInterval(
        () => this.broadcastToChildren(),
        this.intervalMs,
      )
    }
    this.notify()
  }

  public stop(): void {
    if (!this.running) return
    this.running = false
    if (this.broadcastTimer !== null) {
      this.win.clearInterval(this.broadcastTimer)
      this.broadcastTimer = null
    }
    if (this.helloTimer !== null) {
      this.win.clearInterval(this.helloTimer)
      this.helloTimer = null
    }
    if (this.scheduledBroadcast !== null) {
      this.win.clearTimeout(this.scheduledBroadcast)
      this.scheduledBroadcast = null
    }
    if (this.messageHandler) {
      this.win.removeEventListener('message', this.messageHandler as EventListener)
      this.messageHandler = null
    }
    if (this.scrollHandler) {
      this.win.removeEventListener('scroll', this.scrollHandler, true)
      this.win.removeEventListener('resize', this.scrollHandler)
      this.scrollHandler = null
    }
    if (this.visibilityHandler) {
      this.doc.removeEventListener('visibilitychange', this.visibilityHandler)
      this.visibilityHandler = null
    }
  }

  public isKnown(): boolean {
    return this.known
  }

  public isDocumentVisible(): boolean {
    return this.doc.visibilityState !== 'hidden' && !this.doc.hidden
  }

  public getVisibleRegion(): Rect | null {
    if (this.known) return this.region
    return null
  }

  public isFrameVisible(): boolean {
    return (
      this.isKnown() &&
      this.isDocumentVisible() &&
      !!this.region &&
      rectArea(this.region) > 0
    )
  }

  private scheduleBroadcast(): void {
    if (this.scheduledBroadcast !== null) return
    this.scheduledBroadcast = this.win.setTimeout(() => {
      this.scheduledBroadcast = null
      this.broadcastToChildren()
    }, 100)
  }

  /** Parent frame, çocuk iframe'lere güncel görünürlük geometrisini gönderir. */
  public broadcastToChildren(): void {
    if (!this.running) return
    let iframes: NodeListOf<HTMLIFrameElement>
    try {
      iframes = this.doc.querySelectorAll('iframe')
    } catch {
      return
    }
    for (const iframe of Array.from(iframes)) {
      this.sendToIframe(iframe)
    }
  }

  private sendToIframe(iframe: HTMLIFrameElement): void {
    const target = iframe.contentWindow
    if (!target) return
    const ownRegion = this.getVisibleRegion()
    const visible = this.isDocumentVisible() && !!ownRegion
    let region: Rect | null = null
    if (visible && ownRegion) {
      let frameRect: Rect | null = null
      try {
        const rect = iframe.getBoundingClientRect()
        frameRect = {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }
      } catch {
        frameRect = null
      }
      if (frameRect && frameRect.width > 0 && frameRect.height > 0) {
        const intersection = intersectRects(frameRect, ownRegion)
        if (intersection) {
          region = {
            left: intersection.left - frameRect.left,
            top: intersection.top - frameRect.top,
            width: intersection.width,
            height: intersection.height,
          }
        }
      }
    }
    const message: FrameVisibilityMessage = {
      type: FRAME_MESSAGE_TYPE,
      visible: !!region,
      region,
    }
    try {
      target.postMessage(message, '*')
    } catch {
      // cross-origin hedef kapalı olabilir
    }
  }

  private sendHello(): void {
    if (this.isTopFrame) return
    try {
      this.win.parent.postMessage({ type: FRAME_HELLO_TYPE }, '*')
    } catch {
      // parent erişilemez
    }
  }

  private handleMessage(event: MessageEvent): void {
    const data = event.data
    if (!data || typeof data !== 'object') return

    if (data.type === FRAME_HELLO_TYPE) {
      // event.source bir çocuk iframe ise geometriyi gönder. İç içe
      // frame'lerde ara frame de kendi çocuklarına yayın yapar.
      let matched = false
      try {
        const iframes = this.doc.querySelectorAll('iframe')
        for (const iframe of Array.from(iframes)) {
          if (iframe.contentWindow === event.source) {
            matched = true
            this.sendToIframe(iframe)
            break
          }
        }
      } catch {
        matched = false
      }
      if (matched) this.broadcastToChildren()
      return
    }

    if (data.type !== FRAME_MESSAGE_TYPE) return
    if (!this.isTopFrame && event.source !== this.win.parent) return

    this.parentVisible = !!data.visible
    const incoming = this.sanitizeRegion(data.region)
    this.known = true
    const viewport = this.viewportRegion()
    const intersection =
      this.parentVisible && incoming ? intersectRects(viewport, incoming) : null
    this.region = intersection && rectArea(intersection) > 0 ? intersection : null
    this.notify()
  }

  private sanitizeRegion(value: unknown): Rect | null {
    if (!value || typeof value !== 'object') return null
    const region = value as Partial<Rect>
    if (
      typeof region.left !== 'number' ||
      typeof region.top !== 'number' ||
      typeof region.width !== 'number' ||
      typeof region.height !== 'number'
    ) {
      return null
    }
    if (region.width <= 0 || region.height <= 0) return null
    return {
      left: region.left,
      top: region.top,
      width: region.width,
      height: region.height,
    }
  }

  private viewportRegion(): Rect {
    const width = this.win.innerWidth || 0
    const height = this.win.innerHeight || 0
    return { left: 0, top: 0, width, height }
  }

  private notify(): void {
    const key = this.region
      ? `${this.region.left},${this.region.top},${this.region.width},${this.region.height}`
      : 'none'
    if (key === this.lastRegionKey && this.known) return
    this.lastRegionKey = key
    if (this.onChange) this.onChange(this.region, this.known)
  }
}



