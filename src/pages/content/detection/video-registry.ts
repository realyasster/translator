/**
 * Video kayıtları: görünürlük, oynatma durumu, içerik değişimi ve olaylar.
 */

import { Rect } from '../../../types/detection'
import {
  getElementRect,
  intersectRects,
  isStyleVisible,
  rectArea,
} from './text'

export interface FrameVisibilityProvider {
  isKnown(): boolean
  getVisibleRegion(): Rect | null
  isDocumentVisible(): boolean
}

export interface VideoEntry {
  id: string
  video: HTMLVideoElement
  root: Document | ShadowRoot
  generation: number
  contentKey: string
  paused: boolean
  ended: boolean
  readyState: number
  currentTime: number
  currentSrc: string
  fullscreen: boolean
  visible: boolean
  visibleArea: number
  rect: Rect | null
  lastSeenAt: number
}

export type VideoEventReason =
  | 'video-event'
  | 'content-changed'
  | 'seeking'
  | 'fullscreen'
  | 'geometry'

export interface VideoRegistryOptions {
  document: Document
  window: Window
  visibility: FrameVisibilityProvider
  now?: () => number
}

function randomId(): string {
  const cryptoObj = (globalThis as any).crypto
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID()
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export class VideoRegistry {
  private readonly doc: Document
  private readonly win: Window
  private readonly visibility: FrameVisibilityProvider
  private readonly now: () => number
  private entries = new Map<HTMLVideoElement, VideoEntry>()
  private cleanup = new Map<HTMLVideoElement, () => void>()
  private sub: ((entry: VideoEntry, reason: VideoEventReason) => void) | null =
    null
  private fullscreenHandler: (() => void) | null = null
  private running = false

  constructor(options: VideoRegistryOptions) {
    this.doc = options.document
    this.win = options.window
    this.visibility = options.visibility
    this.now = options.now ?? (() => Date.now())
  }

  public start(): void {
    if (this.running) return
    this.running = true
    this.fullscreenHandler = () => this.refresh('fullscreen')
    this.doc.addEventListener('fullscreenchange', this.fullscreenHandler, true)
    this.doc.addEventListener(
      'webkitfullscreenchange' as any,
      this.fullscreenHandler,
      true,
    )
  }

  public stop(): void {
    this.running = false
    for (const dispose of Array.from(this.cleanup.values())) dispose()
    this.cleanup.clear()
    this.entries.clear()
    this.sub = null
    if (this.fullscreenHandler) {
      this.doc.removeEventListener('fullscreenchange', this.fullscreenHandler, true)
      this.doc.removeEventListener(
        'webkitfullscreenchange' as any,
        this.fullscreenHandler,
        true,
      )
      this.fullscreenHandler = null
    }
  }

  public onChange(
    cb: (entry: VideoEntry, reason: VideoEventReason) => void,
  ): () => void {
    this.sub = cb
    return () => {
      if (this.sub === cb) this.sub = null
    }
  }

  public scan(roots: Array<Document | ShadowRoot>): void {
    if (!this.running) return
    for (const root of roots) {
      let videos: NodeListOf<HTMLVideoElement> | HTMLVideoElement[]
      try {
        videos = root.querySelectorAll('video')
      } catch {
        continue
      }
      for (const video of Array.from(videos)) {
        this.register(video, root)
      }
    }
  }

  public prune(): void {
    for (const [video, entry] of Array.from(this.entries.entries())) {
      if (!video.isConnected) {
        this.remove(video)
      } else if (entry.root !== this.rootFor(video)) {
        this.remove(video)
      }
    }
  }

  public refresh(reason: VideoEventReason = 'geometry'): void {
    if (!this.running) return
    for (const entry of Array.from(this.entries.values())) {
      const previous = {
        visible: entry.visible,
        visibleArea: entry.visibleArea,
        paused: entry.paused,
        ended: entry.ended,
        fullscreen: entry.fullscreen,
        contentKey: entry.contentKey,
        generation: entry.generation,
      }
      this.updateGeometry(entry)
      this.updatePlayback(entry)
      const contentKey = this.computeContentKey(entry.video)
      if (contentKey !== entry.contentKey) {
        entry.contentKey = contentKey
        entry.generation += 1
      }
      const contentChanged = entry.generation !== previous.generation
      if (
        contentChanged ||
        entry.visible !== previous.visible ||
        entry.visibleArea !== previous.visibleArea ||
        entry.paused !== previous.paused ||
        entry.ended !== previous.ended ||
        entry.fullscreen !== previous.fullscreen
      ) {
        this.emit(entry, contentChanged ? 'content-changed' : reason)
      }
    }
  }

  public getVideos(): VideoEntry[] {
    return Array.from(this.entries.values())
  }

  public getVisibleVideos(): VideoEntry[] {
    return this.getVideos().filter((entry) => entry.visible && entry.visibleArea > 0)
  }

  public getEntry(video: HTMLVideoElement): VideoEntry | undefined {
    return this.entries.get(video)
  }

  private register(video: HTMLVideoElement, root: Document | ShadowRoot): void {
    if (this.entries.has(video)) return
    const entry: VideoEntry = {
      id: randomId(),
      video,
      root,
      generation: 1,
      contentKey: this.computeContentKey(video),
      paused: video.paused !== false,
      ended: !!video.ended,
      readyState: video.readyState || 0,
      currentTime: video.currentTime || 0,
      currentSrc: video.currentSrc || video.getAttribute('src') || '',
      fullscreen: false,
      visible: false,
      visibleArea: 0,
      rect: null,
      lastSeenAt: this.now(),
    }
    this.entries.set(video, entry)
    this.updateGeometry(entry)
    this.updatePlayback(entry)

    const listener = () => {
      if (!this.running || !this.entries.has(video)) return
      const reason: VideoEventReason =
        entry.video.readyState >= 1 && entry.video.currentSrc
          ? 'video-event'
          : 'video-event'
      if (entry.video.currentSrc !== entry.currentSrc) {
        entry.currentSrc = entry.video.currentSrc
      }
      if (entry.video.readyState >= 1) {
        const contentKey = this.computeContentKey(video)
        if (contentKey !== entry.contentKey) {
          entry.contentKey = contentKey
          entry.generation += 1
        }
      }
      this.updateGeometry(entry)
      this.updatePlayback(entry)
      this.emit(entry, reason)
    }

    const onEmptied = () => {
      entry.generation += 1
      entry.contentKey = this.computeContentKey(video)
      this.updateGeometry(entry)
      this.updatePlayback(entry)
      this.emit(entry, 'content-changed')
    }

    const onSeeking = () => {
      this.updatePlayback(entry)
      this.emit(entry, 'seeking')
    }

    const events: Array<[string, EventListener]> = [
      ['play', listener],
      ['pause', listener],
      ['ended', listener],
      ['loadedmetadata', listener],
      ['loadeddata', listener],
      ['resize', listener],
      ['seeked', listener],
      ['seeking', onSeeking],
      ['emptied', onEmptied],
    ]
    for (const [name, handler] of events) {
      video.addEventListener(name, handler)
    }

    this.cleanup.set(video, () => {
      for (const [name, handler] of events) {
        video.removeEventListener(name, handler)
      }
    })
  }

  private remove(video: HTMLVideoElement): void {
    const dispose = this.cleanup.get(video)
    if (dispose) dispose()
    this.cleanup.delete(video)
    this.entries.delete(video)
  }

  private updateGeometry(entry: VideoEntry): void {
    const rect = getElementRect(entry.video)
    entry.rect = rect
    const region = this.visibility.getVisibleRegion()
    const intersection = rect && region ? intersectRects(rect, region) : null
    const area = rectArea(intersection)
    const verticallyUsable =
      !!rect && rect.width > 0 && rect.height > 0 && !!intersection
    entry.visible =
      this.visibility.isKnown() &&
      this.visibility.isDocumentVisible() &&
      verticallyUsable &&
      isStyleVisible(entry.video, this.win)
    entry.visibleArea = entry.visible ? area : 0
    entry.fullscreen =
      this.doc.fullscreenElement === entry.video ||
      !!(this.doc.fullscreenElement && this.doc.fullscreenElement.contains(entry.video)) ||
      !!(entry.video as any).webkitDisplayingFullscreen
    entry.lastSeenAt = this.now()
  }

  private updatePlayback(entry: VideoEntry): void {
    entry.paused = entry.video.paused !== false
    entry.ended = !!entry.video.ended
    entry.readyState = entry.video.readyState || 0
    entry.currentTime = entry.video.currentTime || 0
    entry.currentSrc = entry.video.currentSrc || entry.video.getAttribute('src') || ''
  }

  private computeContentKey(video: HTMLVideoElement): string {
    const src =
      video.currentSrc ||
      video.getAttribute('src') ||
      ''
    const sources = Array.from(video.querySelectorAll('source'))
      .map((source) => source.getAttribute('src') || '')
      .join('|')
    return `${src}::${sources}`
  }

  private rootFor(node: Node): Document | ShadowRoot | null {
    try {
      const root = node.getRootNode()
      if (root.nodeType === 9 || root.nodeType === 11) {
        return root as Document | ShadowRoot
      }
    } catch {
      // yoksay
    }
    return null
  }

  private emit(entry: VideoEntry, reason: VideoEventReason): void {
    if (this.sub) this.sub(entry, reason)
  }
}




