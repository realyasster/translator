/**
 * Otomatik altyazı algılama motoru.
 *
 * Akış: kök/video keşfi -> adaptörler -> doğrulama ve puanlama -> background
 * kaynak koordinatörü -> yetkili tek kaynak -> SubtitleLifecycle.
 *
 * Motor yalnızca background tarafından yetkilendirilen kaynağın metnini
 * örnek olarak yayınlar. Yetki yokken hiçbir çeviri isteği tetiklenmez.
 */

import {
  CandidateSummary,
  DetectionAuthority,
  DetectionFrameReport,
  DetectionPhase,
  DetectionStatus,
  DetectionTransport,
  DetectionTransportHandlers,
  MAX_CANDIDATES_PER_FRAME,
  SourceRef,
  SubtitleDetector,
  SubtitleSample,
  UNAVAILABLE_AFTER_PLAYING_MS,
} from '../../../types/detection'
import { DetectionPort } from './detection-port'
import { FrameVisibilityBridge } from './frame-visibility'
import { RootRegistry } from './root-registry'
import { VideoEntry, FrameVisibilityProvider, VideoRegistry } from './video-registry'
import { NativeTrackAdapter } from './adapters/native-track'
import { ResolvedCaption, UdemyAdapter } from './adapters/udemy'
import { YouTubeAdapter } from './adapters/youtube'
import { GenericDomAdapter } from './adapters/generic-dom'
import { AdapterCandidate } from './adapters/types'
import {
  isPresentationAnchorAvailable,
  isUsablePresentationMount,
  samePresentation,
  SubtitlePresentation,
  SubtitlePresentationListener,
} from './presentation'
import {
  BehaviorMetrics,
  CandidateHistory,
  evaluateConnection,
  scoreCandidate,
} from './scoring'
import {
  collectTextCandidates,
  isStyleVisible,
  readVisibleText,
  textLines,
} from './text'

export interface DetectionVisibility extends FrameVisibilityProvider {
  start?(): void
  stop?(): void
  isFrameVisible?(): boolean
  broadcastToChildren?(): void
}

export interface DetectionEngineOptions {
  document?: Document
  window?: Window
  documentId?: string
  hostname?: string
  now?: () => number
  transport?: DetectionTransport
  transportFactory?: () => DetectionTransport
  visibility?: DetectionVisibility
}

interface EvaluatedCandidate {
  candidate: AdapterCandidate
  entry: VideoEntry
  source: SourceRef
  score: number
  metrics: BehaviorMetrics
  ready: boolean
  connectReason: string
}

/** Native track için bulunan Udemy anchor'ı bu süre boyunca önbellekte kalır. */
const NATIVE_ANCHOR_CACHE_MS = 1000
/** Bulunamayan anchor kısa süre önbelleklenir; blok sonradan render olabilir. */
const NATIVE_ANCHOR_MISS_CACHE_MS = 300
/** Below anchor'ı geçici kabul edilen kurtarma süresi. */
const PRESENTATION_ANCHOR_GRACE_MS = 1000

const KIND_PRIORITY: Record<SourceRef['kind'], number> = {
  'text-track': 0,
  'player-dom': 1,
  'generic-dom': 2,
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

export function sourceKey(source: SourceRef): string {
  return [
    source.documentId,
    source.videoId,
    source.sourceId,
    source.generation,
    source.kind,
  ].join('|')
}

export class DetectionEngine implements SubtitleDetector {
  private readonly doc: Document
  private readonly win: Window
  private readonly now: () => number
  private readonly documentId: string
  private readonly hostname: string
  private readonly options: DetectionEngineOptions

  private visibility: DetectionVisibility
  private rootRegistry: RootRegistry | null = null
  private videoRegistry: VideoRegistry | null = null
  private transport: DetectionTransport | null = null

  private nativeAdapters = new Map<string, NativeTrackAdapter>()
  private udemyAdapter = new UdemyAdapter()
  private youtubeAdapter = new YouTubeAdapter()
  private genericAdapter = new GenericDomAdapter()

  private histories = new Map<string, CandidateHistory>()
  private historySeenAt = new Map<string, number>()
  private lastKnown = new Map<string, EvaluatedCandidate>()

  private sampleSubscribers: Array<(sample: SubtitleSample) => void> = []
  private statusSubscribers: Array<(status: DetectionStatus) => void> = []
  private presentationSubscribers: SubtitlePresentationListener[] = []
  private currentPresentation: SubtitlePresentation | null = null
  private nativeAnchorCache = new WeakMap<
    HTMLVideoElement,
    { layout: ResolvedCaption | null; generation: number; checkedAt: number }
  >()
  /** Below anchor'ı kullanılamaz hale gelen kaynakların ilk gözlem zamanı. */
  private belowAnchorMissingSince = new Map<string, number>()

  private status: DetectionStatus = { phase: 'disabled', reason: 'stopped' }
  private lastSampleKey = ''
  private authorityKey = ''
  private playingSince: number | null = null
  private lastUrl = ''
  private lastRootDeepScan = 0

  private running = false
  private evaluating = false
  private evaluationScheduled = false
  private disposed = false

  private evalTimer: number | null = null
  private healthTimer: number | null = null
  private resizeTimer: number | null = null

  private boundVisibilityChange: (() => void) | null = null
  private boundResize: (() => void) | null = null
  private boundNavigation: (() => void) | null = null

  constructor(options: DetectionEngineOptions = {}) {
    this.options = options
    this.doc = options.document ?? document
    this.win =
      options.window ??
      this.doc.defaultView ??
      (typeof window !== 'undefined' ? window : ({} as Window))
    this.now = options.now ?? (() => Date.now())
    this.documentId = options.documentId ?? randomId('doc')
    this.hostname =
      options.hostname ?? this.win.location?.hostname ?? ''
    this.visibility =
      options.visibility ??
      new FrameVisibilityBridge({
        window: this.win,
        document: this.doc,
        now: this.now,
        onRegionChange: () => this.scheduleEvaluation(0),
      })
    this.lastUrl = this.win.location?.href || ''
  }

  // --------------------------------------------------------------- yaşam döngüsü

  public start(): void {
    if (this.running || this.disposed) return
    this.running = true
    this.lastSampleKey = ''
    this.authorityKey = ''
    this.playingSince = null
    this.lastUrl = this.win.location?.href || this.lastUrl

    this.visibility.start?.()

    this.videoRegistry = new VideoRegistry({
      document: this.doc,
      window: this.win,
      visibility: this.visibility,
      now: this.now,
    })
    this.videoRegistry.start()
    this.videoRegistry.onChange((_entry, reason) => {
      if (reason === 'seeking') this.resetBehaviorEvidence()
      this.scheduleEvaluation(reason === 'seeking' ? 50 : 20)
    })

    this.rootRegistry = new RootRegistry(this.doc, { now: this.now })
    this.rootRegistry.onMutation((roots) => {
      this.videoRegistry?.scan(roots)
      this.scheduleEvaluation(20)
    })
    this.rootRegistry.onRootsChanged(() => {
      this.videoRegistry?.scan(this.rootRegistry?.getRoots() ?? [this.doc])
      this.scheduleEvaluation(20)
    })
    this.rootRegistry.start()
    this.videoRegistry.scan(this.rootRegistry.getRoots())

    this.transport = this.createTransport()
    const handlers: DetectionTransportHandlers = {
      onGrant: (authority) => this.handleGrant(authority),
      onRevoke: (token, reason) => this.handleRevoke(token, reason),
      onDisconnect: (reason) => this.handleAuthorityLost(reason),
      onAuthorityExpired: () => this.handleAuthorityLost('authority-expired'),
    }
    this.transport.start(null, handlers)

    this.bindGlobalListeners()

    this.healthTimer = this.win.setInterval(() => this.healthCheck(), 1000)

    this.scheduleEvaluation(0)
  }

  public stop(): void {
    if (!this.running) return
    this.running = false
    this.evaluating = false
    if (this.evalTimer !== null) {
      this.win.clearTimeout(this.evalTimer)
      this.evalTimer = null
    }
    if (this.healthTimer !== null) {
      this.win.clearInterval(this.healthTimer)
      this.healthTimer = null
    }
    if (this.resizeTimer !== null) {
      this.win.clearTimeout(this.resizeTimer)
      this.resizeTimer = null
    }
    this.evaluationScheduled = false

    this.unbindGlobalListeners()

    for (const adapter of Array.from(this.nativeAdapters.values())) adapter.detach()
    this.nativeAdapters.clear()

    if (this.rootRegistry) {
      this.rootRegistry.stop()
      this.rootRegistry = null
    }
    if (this.videoRegistry) {
      this.videoRegistry.stop()
      this.videoRegistry = null
    }
    if (this.transport) {
      this.transport.stop()
      this.transport = null
    }
    this.visibility.stop?.()

    this.histories.clear()
    this.historySeenAt.clear()
    this.lastKnown.clear()
    this.nativeAnchorCache = new WeakMap()
    this.belowAnchorMissingSince.clear()
    this.udemyAdapter.reset()
    this.lastSampleKey = ''
    this.authorityKey = ''
    this.playingSince = null
    // Yetki ve yerleşim birlikte düşer; abone kaldıysa null bildirilir.
    this.setPresentation(null)
    this.setStatus({ phase: 'disabled', reason: 'stopped' })
  }

  public dispose(): void {
    this.stop()
    this.disposed = true
    this.sampleSubscribers = []
    this.statusSubscribers = []
    this.presentationSubscribers = []
    this.currentPresentation = null
  }

  /**
   * BFCache restore sonrası motor içi geçmişi/önbellekleri temizler.
   * Manager, detection'ı yeniden başlattıktan sonra açıkça çağırır.
   */
  public resetAfterRestore(): void {
    if (this.disposed) return
    this.histories.clear()
    this.historySeenAt.clear()
    this.lastKnown.clear()
    this.nativeAnchorCache = new WeakMap()
    this.belowAnchorMissingSince.clear()
    this.udemyAdapter.reset()
    this.rootRegistry?.healthCheck(true)
    if (this.rootRegistry) {
      this.videoRegistry?.scan(this.rootRegistry.getRoots())
    }
    this.scheduleEvaluation(0)
  }

  public subscribe(
    onSample: (sample: SubtitleSample) => void,
    onStatus: (status: DetectionStatus) => void,
  ): () => void {
    this.sampleSubscribers.push(onSample)
    this.statusSubscribers.push(onStatus)
    onStatus(this.status)
    return () => {
      this.sampleSubscribers = this.sampleSubscribers.filter(
        (fn) => fn !== onSample,
      )
      this.statusSubscribers = this.statusSubscribers.filter(
        (fn) => fn !== onStatus,
      )
    }
  }

  /**
   * Content tarafına özel yerleşim akışı. Yeni abone mevcut değeri hemen alır.
   * Bu sözleşme background taşıma katmanına eklenmez.
   */
  public subscribePresentation(
    listener: SubtitlePresentationListener,
  ): () => void {
    this.presentationSubscribers.push(listener)
    listener(clonePresentation(this.currentPresentation))
    return () => {
      this.presentationSubscribers = this.presentationSubscribers.filter(
        (fn) => fn !== listener,
      )
    }
  }

  public getPresentation(): SubtitlePresentation | null {
    return clonePresentation(this.currentPresentation)
  }

  public getAuthority(): DetectionAuthority | null {
    if (!this.running || !this.transport) return null
    const authority = this.transport.authority()
    if (!authority) return null
    if (this.authorityKey && sourceKey(authority.source) !== this.authorityKey) {
      return null
    }
    return authority
  }

  public getVideoEntries(): VideoEntry[] {
    return this.videoRegistry?.getVideos() ?? []
  }

  /** Testler ve tanılama için tek seferlik değerlendirme. */
  public evaluateNow(): void {
    this.evaluate()
  }

  public getStatus(): DetectionStatus {
    return this.status
  }

  // -------------------------------------------------------------------- keşif

  private createTransport(): DetectionTransport {
    if (this.options.transportFactory) return this.options.transportFactory()
    if (this.options.transport) return this.options.transport
    return new DetectionPort({
      documentId: this.documentId,
      url: this.win.location?.href || '',
      now: this.now,
    })
  }

  private bindGlobalListeners(): void {
    this.boundVisibilityChange = () => this.handleVisibilityChange()
    this.boundResize = () => {
      if (this.resizeTimer !== null) return
      this.resizeTimer = this.win.setTimeout(() => {
        this.resizeTimer = null
        this.videoRegistry?.refresh('geometry')
        this.visibility.broadcastToChildren?.()
        this.scheduleEvaluation(0)
      }, 100)
    }
    this.boundNavigation = () => this.handleNavigation()

    this.doc.addEventListener('visibilitychange', this.boundVisibilityChange)
    this.win.addEventListener('resize', this.boundResize)
    this.win.addEventListener('scroll', this.boundResize, true)
    this.win.addEventListener('popstate', this.boundNavigation)
    this.win.addEventListener('hashchange', this.boundNavigation)
  }

  private unbindGlobalListeners(): void {
    if (this.boundVisibilityChange) {
      this.doc.removeEventListener('visibilitychange', this.boundVisibilityChange)
      this.boundVisibilityChange = null
    }
    if (this.boundResize) {
      this.win.removeEventListener('resize', this.boundResize)
      this.win.removeEventListener('scroll', this.boundResize, true)
      this.boundResize = null
    }
    if (this.boundNavigation) {
      this.win.removeEventListener('popstate', this.boundNavigation)
      this.win.removeEventListener('hashchange', this.boundNavigation)
      this.boundNavigation = null
    }
  }

  private scheduleEvaluation(delayMs: number): void {
    if (!this.running || this.disposed) return
    if (this.evaluationScheduled) return
    this.evaluationScheduled = true
    this.evalTimer = this.win.setTimeout(() => {
      this.evalTimer = null
      this.evaluationScheduled = false
      this.evaluate()
    }, delayMs)
  }

  private healthCheck(): void {
    if (!this.running) return
    const now = this.now()
    const deepScanDue = now - this.lastRootDeepScan >= 5000
    try {
      // Derin tarama, sonradan attachShadow ile açılan kökleri de bulur.
      this.rootRegistry?.healthCheck(deepScanDue)
      if (deepScanDue) this.lastRootDeepScan = now
      this.videoRegistry?.prune()
      if (this.rootRegistry) {
        this.videoRegistry?.scan(this.rootRegistry.getRoots())
      }
    } catch {
      // sağlık kontrolü asla akışı kesmez
    }

    const url = this.win.location?.href || ''
    if (url && url !== this.lastUrl) {
      this.lastUrl = url
      this.handleNavigation()
      return
    }

    this.evaluate()
  }

  private handleVisibilityChange(): void {
    if (this.doc.visibilityState === 'hidden' || this.doc.hidden) {
      this.setStatus({ phase: 'suspended', reason: 'page-hidden' })
      this.report([])
      return
    }
    // Geri dönüşte kaynak yeniden doğrulanır.
    this.videoRegistry?.refresh('geometry')
    this.rootRegistry?.healthCheck(true)
    this.scheduleEvaluation(0)
  }

  private handleNavigation(): void {
    this.lastUrl = this.win.location?.href || this.lastUrl
    this.histories.clear()
    this.historySeenAt.clear()
    this.lastKnown.clear()
    this.nativeAnchorCache = new WeakMap()
    this.belowAnchorMissingSince.clear()
    this.udemyAdapter.reset()
    this.rootRegistry?.healthCheck(true)
    if (this.rootRegistry) this.videoRegistry?.scan(this.rootRegistry.getRoots())
    this.scheduleEvaluation(0)
  }

  private resetBehaviorEvidence(): void {
    for (const history of Array.from(this.histories.values())) history.reset()
  }

  // ------------------------------------------------------------------ puanlama

  private evaluate(): void {
    if (!this.running || this.evaluating) return
    this.evaluating = true
    try {
      const now = this.now()

      if (this.doc.visibilityState === 'hidden' || this.doc.hidden) {
        this.setStatus({ phase: 'suspended', reason: 'page-hidden' })
        this.report([])
        return
      }

      if (!this.visibility.isKnown()) {
        this.setStatus({
          phase: 'waiting',
          reason: 'frame-visibility-unknown',
        })
        this.report([], 'frame-visibility-unknown')
        return
      }

      const region = this.visibility.getVisibleRegion()
      if (!region) {
        this.setStatus({ phase: 'searching', reason: 'video-offscreen' })
        this.report([], 'video-offscreen')
        return
      }

      this.videoRegistry?.prune()
      this.videoRegistry?.refresh('geometry')
      const videos = (this.videoRegistry?.getVisibleVideos() ?? []).slice()
      if (!videos.length) {
        this.playingSince = null
        this.setStatus({ phase: 'searching', reason: 'video-not-found' })
        this.report([], 'video-not-found')
        return
      }

      videos.sort((a, b) => {
        if (a.fullscreen !== b.fullscreen) return a.fullscreen ? -1 : 1
        const aPlaying = !a.paused && !a.ended
        const bPlaying = !b.paused && !b.ended
        if (aPlaying !== bPlaying) return aPlaying ? -1 : 1
        return b.visibleArea - a.visibleArea
      })

      this.ensureNativeAdapters(videos)
      const authority = this.transport?.authority() ?? null
      const evaluated = this.collectEvaluated(videos, authority, now)
      this.pruneHistories(now)

      const authorityCandidate = authority
        ? evaluated.find(
            (item) =>
              !item.candidate.invalidReason &&
              sourceKey(item.source) === sourceKey(authority.source),
          ) ?? null
        : null

      const status = this.computeStatus(
        evaluated,
        videos,
        authority,
        authorityCandidate,
        now,
      )

      // Yerleşim, yeni metin örneğinden önce yayınlanır; abone aynı değeri
      // tekrar almaz. Yerleşim değişikliği kaynak/nesil üretmez.
      this.setPresentation(
        this.resolvePresentation(authority, authorityCandidate, videos),
      )

      if (status.phase === 'connected' && authority && authorityCandidate) {
        this.emitSample(authorityCandidate)
      } else if (status.phase === 'waiting' && authority) {
        // Boş satır geçişinde yalnızca bir kez boş örnek yayınlanır.
        this.emitEmptySample(authority)
      } else {
        this.lastSampleKey = ''
      }

      this.setStatus(status)
      this.report(evaluated, status.reason, status)
    } finally {
      this.evaluating = false
    }
  }

  private collectEvaluated(
    videos: VideoEntry[],
    authority: DetectionAuthority | null,
    now: number,
  ): EvaluatedCandidate[] {
    const raw: Array<{ candidate: AdapterCandidate; entry: VideoEntry }> = []
    const hostAdapter = UdemyAdapter.matches(this.hostname)
      ? this.udemyAdapter
      : YouTubeAdapter.matches(this.hostname)
        ? this.youtubeAdapter
        : null

    for (const entry of videos) {
      const native = this.nativeAdapters.get(entry.id)
      const nativeCandidates = native ? native.getCandidates(entry) : []
      for (const candidate of nativeCandidates) raw.push({ candidate, entry })

      const hostCandidate = hostAdapter
        ? hostAdapter.getCandidate({
            entry,
            document: this.doc,
            window: this.win,
            now,
            hostname: this.hostname,
          })
        : null
      if (hostCandidate) raw.push({ candidate: hostCandidate, entry })

      const verifiedHasText =
        nativeCandidates.some((candidate) => candidate.text) ||
        !!hostCandidate?.text
      const authorityIsGeneric = authority?.source.kind === 'generic-dom'
      if (!verifiedHasText || authorityIsGeneric) {
        for (const candidate of this.genericAdapter.getCandidates({
          entry,
          document: this.doc,
          window: this.win,
          now,
          hostname: this.hostname,
        })) {
          raw.push({ candidate, entry })
        }
      }
    }

    const evaluated: EvaluatedCandidate[] = []
    const seen = new Set<string>()
    for (const { candidate, entry } of raw) {
      if (evaluated.length >= MAX_CANDIDATES_PER_FRAME) break
      const source: SourceRef = {
        documentId: this.documentId,
        videoId: entry.id,
        sourceId: candidate.sourceId,
        generation: entry.generation,
        kind: candidate.kind,
      }
      const key = sourceKey(source)
      if (seen.has(key)) continue
      seen.add(key)

      const text = candidate.text || ''
      const history = this.getHistory(key)
      if (text) history.record(text, entry.video.currentTime || 0, now)
      this.historySeenAt.set(key, now)

      const metrics = history.metrics(now)
      candidate.evidence.verifiedTextChanges =
        metrics.changeCount >= 2 &&
        metrics.withinWindow &&
        metrics.spacingOk &&
        metrics.mediaAdvanced
      const rawScore = scoreCandidate(candidate.evidence)
      const score = history.updateBestScore(rawScore)

      const evaluatedCandidate: EvaluatedCandidate = {
        candidate: { ...candidate, evidence: { ...candidate.evidence } },
        entry,
        source,
        score,
        metrics,
        ready: false,
        connectReason: 'pending',
      }
      evaluated.push(evaluatedCandidate)
      this.lastKnown.set(key, evaluatedCandidate)
    }

    // Yetkili genel DOM kaynağı geçici olarak boşalsa bile öğe duruyorsa
    // bağlantı korunur.
    if (authority && authority.source.kind === 'generic-dom') {
      const key = sourceKey(authority.source)
      if (!evaluated.some((item) => sourceKey(item.source) === key)) {
        const cached = this.lastKnown.get(key)
        const element = cached?.candidate.element
        if (
          cached &&
          element &&
          element.isConnected &&
          isStyleVisible(element, this.win) &&
          cached.entry.video.isConnected &&
          cached.entry.visible
        ) {
          const text = readVisibleText(element, { win: this.win })
          evaluated.push({
            ...cached,
            candidate: {
              ...cached.candidate,
              text,
              lines: textLines(text),
            },
            score: cached.score,
            ready: false,
          })
        }
      }
    }

    // Aynı video için yerel kanal / doğrulanmış oynatıcı / genel DOM aynı
    // altyazıyı temsil eder. Daha güvenilir kaynak metin taşıyorsa alt
    // öncelikli kopya elenir; iki bağımsız genel aday ise birlikte kalır.
    const bestPriorityByVideo = new Map<string, number>()
    for (const item of evaluated) {
      if (item.candidate.invalidReason) continue
      if (!item.candidate.text.trim()) continue
      const priority = KIND_PRIORITY[item.source.kind]
      const existing = bestPriorityByVideo.get(item.source.videoId)
      if (existing === undefined || priority < existing) {
        bestPriorityByVideo.set(item.source.videoId, priority)
      }
    }
    if (bestPriorityByVideo.size) {
      const authorityKey = authority ? sourceKey(authority.source) : ''
      for (let i = evaluated.length - 1; i >= 0; i -= 1) {
        const item = evaluated[i]
        const best = bestPriorityByVideo.get(item.source.videoId)
        if (best === undefined) continue
        if (KIND_PRIORITY[item.source.kind] <= best) continue
        if (authorityKey && sourceKey(item.source) === authorityKey) continue
        evaluated.splice(i, 1)
      }
    }

    evaluated.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const priority = KIND_PRIORITY[a.source.kind] - KIND_PRIORITY[b.source.kind]
      if (priority !== 0) return priority
      return a.source.sourceId.localeCompare(b.source.sourceId)
    })

    for (const candidate of evaluated) {
      if (candidate.candidate.invalidReason) {
        candidate.ready = false
        candidate.connectReason = candidate.candidate.invalidReason
        continue
      }
      const second =
        evaluated.find(
          (other) =>
            other !== candidate &&
            other.source.videoId === candidate.source.videoId &&
            other.source.sourceId !== candidate.source.sourceId &&
            !other.candidate.invalidReason &&
            !!other.candidate.text.trim(),
        ) ?? null
      const result = evaluateConnection({
        score: candidate.score,
        kind: candidate.source.kind,
        hasText: !!candidate.candidate.text.trim(),
        secondIndependentScore: second ? second.score : null,
        changeCount: candidate.metrics.changeCount,
        changesWithinWindow: candidate.metrics.withinWindow,
        changeSpacingOk: candidate.metrics.spacingOk,
        mediaAdvanced: candidate.metrics.mediaAdvanced,
      })
      candidate.ready = result.ready
      candidate.connectReason = result.reason
    }

    return evaluated
  }

  private computeStatus(
    evaluated: EvaluatedCandidate[],
    videos: VideoEntry[],
    authority: DetectionAuthority | null,
    authorityCandidate: EvaluatedCandidate | null,
    now: number,
  ): DetectionStatus {
    const valid = evaluated.filter((item) => !item.candidate.invalidReason)
    const top = valid[0] ?? null
    const anyPlaying = videos.some((entry) => !entry.paused && !entry.ended)

    if (authority) {
      if (!authorityCandidate) {
        return {
          phase: 'verifying',
          reason: 'source-changed-or-lost',
        }
      }
      if (!authorityCandidate.candidate.text.trim()) {
        return {
          phase: 'waiting',
          source: authority.source,
          score: authorityCandidate.score,
          reason: 'waiting-for-next-line',
        }
      }
      return {
        phase: 'connected',
        source: authority.source,
        score: authorityCandidate.score,
        reason: 'connected',
      }
    }

    if (anyPlaying) {
      if (top?.ready) {
        this.playingSince = null
      } else if (this.playingSince === null) {
        this.playingSince = now
      }
    } else {
      this.playingSince = null
    }

    if (top?.ready) {
      return {
        phase: 'verifying',
        score: top.score,
        reason: 'awaiting-source-grant',
      }
    }

    if (
      anyPlaying &&
      this.playingSince !== null &&
      now - this.playingSince >= UNAVAILABLE_AFTER_PLAYING_MS
    ) {
      // Kaynak on saniye içinde doğrulanamadı; hafif keşif sürer.
      return { phase: 'unavailable', reason: 'no-readable-subtitles' }
    }

    if (top) {
      let reason = top.connectReason
      if (!top.candidate.text.trim()) reason = 'waiting-for-text'
      if (top.score < 80 && reason === 'pending') reason = 'low-confidence'
      return { phase: 'verifying', score: top.score, reason }
    }

    return { phase: 'searching', reason: 'subtitle-not-found' }
  }

  /**
   * Yetkili kaynağın yerleşimini çözer. Yerleşim yalnızca yetkili kaynağa
   * bağlıdır; metin örneğinden bağımsızdır. Below niyeti, anchor geçici
   * olarak kullanılamasa bile floating'e çevrilmez.
   */
  private resolvePresentation(
    authority: DetectionAuthority | null,
    authorityCandidate: EvaluatedCandidate | null,
    videos: VideoEntry[],
  ): SubtitlePresentation | null {
    if (!authority) return null

    const key = sourceKey(authority.source)
    const candidate =
      authorityCandidate ?? this.lastKnown.get(key) ?? null
    const hint = candidate?.candidate.presentation

    let mode: SubtitlePresentation['mode'] = 'floating'
    let anchor: HTMLElement | null = null
    let mountAfter: HTMLElement | null | undefined = undefined

    if (authority.source.kind === 'text-track') {
      // Text-track seçili olsa da aynı videonun doğrulanmış Udemy video altı
      // DOM hedefi kullanılabilir.
      const layout = this.resolveNativeTrackLayout(authority.source, videos)
      if (layout) {
        mode = 'below-caption'
        anchor = layout.element
        mountAfter = layout.mountAfter
      } else if (hint?.mode === 'below-caption') {
        mode = 'below-caption'
        anchor = hint.anchor instanceof HTMLElement ? hint.anchor : null
        mountAfter = hint.mountAfter
      }
    } else if (hint?.mode === 'below-caption') {
      mode = 'below-caption'
      anchor = hint.anchor instanceof HTMLElement ? hint.anchor : null
      mountAfter = hint.mountAfter
    }

    if (mode !== 'below-caption') {
      return {
        source: { ...authority.source },
        mode: 'floating',
        anchor: null,
        mountAfter: null,
      }
    }

    if (!anchor || !isPresentationAnchorAvailable(anchor, this.doc, this.win)) {
      // Anchor kısa süreliğine koptu/gizlendi. Below niyeti grace süresince
      // korunur; yeniden değerlendirme tetiklenir. Süre aşılırsa kurtarılabilir
      // aşağı hedef yok sayılır ve görünür floating'e geçilir.
      const now = this.now()
      const missingSince = this.belowAnchorMissingSince.get(key)
      if (missingSince === undefined) {
        this.belowAnchorMissingSince.set(key, now)
        this.scheduleEvaluation(0)
      } else {
        const elapsed = now - missingSince
        if (elapsed < PRESENTATION_ANCHOR_GRACE_MS) {
          this.scheduleEvaluation(
            Math.max(0, PRESENTATION_ANCHOR_GRACE_MS - elapsed),
          )
        } else {
          // Kalıcı kayıp: anchor geri gelene kadar floating yayınlanır.
          return {
            source: { ...authority.source },
            mode: 'floating',
            anchor: null,
            mountAfter: null,
          }
        }
      }
      return {
        source: { ...authority.source },
        mode: 'below-caption',
        anchor: null,
        mountAfter: null,
      }
    }
    this.belowAnchorMissingSince.delete(key)

    if (
      mountAfter !== undefined &&
      mountAfter !== null &&
      !isUsablePresentationMount(mountAfter, anchor, this.doc, this.win)
    ) {
      mountAfter = null
    }

    return {
      source: { ...authority.source },
      mode: 'below-caption',
      anchor,
      mountAfter,
    }
  }

  private resolveNativeTrackLayout(
    source: SourceRef,
    videos: VideoEntry[],
  ): ResolvedCaption | null {
    if (!UdemyAdapter.matches(this.hostname)) return null
    const entry = videos.find((item) => item.id === source.videoId)
    if (!entry) return null

    const now = this.now()
    // Anahtar video öğesidir: video DOM'dan kalkınca anchor önbelleği de
    // çöp toplamaya bırakılır, ayrı bir temizlik gerekmez.
    const cached = this.nativeAnchorCache.get(entry.video)
    if (cached && cached.generation === entry.generation) {
      // Hedefi olmayan sonuç kısa süre önbelleklenir; dış satır sonradan
      // render edilebilir.
      const ttl =
        !cached.layout || cached.layout.mountAfter === null
          ? NATIVE_ANCHOR_MISS_CACHE_MS
          : NATIVE_ANCHOR_CACHE_MS
      if (now - cached.checkedAt < ttl) {
        if (!cached.layout) return null
        const anchorUsable = isPresentationAnchorAvailable(
          cached.layout.element,
          this.doc,
          this.win,
        )
        const mountValue = cached.layout.mountAfter
        const context = {
          entry,
          document: this.doc,
          window: this.win,
          now,
          hostname: this.hostname,
        }
        const mountUsable =
          mountValue === undefined ||
          mountValue === null ||
          isUsablePresentationMount(
            mountValue,
            cached.layout.element,
            this.doc,
            this.win,
            (target, anchorEl) =>
              this.udemyAdapter.isValidMountTarget(
                target,
                anchorEl ?? cached.layout!.element,
                context,
              ),
          )
        if (anchorUsable && mountUsable) return cached.layout
      }
    }

    let layout: ResolvedCaption | null = null
    try {
      layout = this.udemyAdapter.resolveBelowVideoLayout({
        entry,
        document: this.doc,
        window: this.win,
        now,
        hostname: this.hostname,
      })
    } catch {
      layout = null
    }
    this.nativeAnchorCache.set(entry.video, {
      layout,
      generation: entry.generation,
      checkedAt: now,
    })
    return layout
  }

  /** Yalnızca source/mode/anchor değiştiğinde abonelere bildirir. */
  private setPresentation(next: SubtitlePresentation | null): void {
    const normalized = clonePresentation(next)
    if (samePresentation(this.currentPresentation, normalized)) return
    this.currentPresentation = normalized
    for (const subscriber of this.presentationSubscribers.slice()) {
      subscriber(clonePresentation(normalized))
    }
  }

  private emitSample(candidate: EvaluatedCandidate): void {
    const text = candidate.candidate.text
    const key = `${sourceKey(candidate.source)}::${text}`
    if (key === this.lastSampleKey) return
    this.lastSampleKey = key
    const sample: SubtitleSample = {
      source: candidate.source,
      text,
      mediaTime: candidate.entry.video.currentTime || 0,
      observedAt: this.now(),
    }
    for (const subscriber of this.sampleSubscribers) subscriber(sample)
  }

  private emitEmptySample(authority: DetectionAuthority): void {
    const key = `${sourceKey(authority.source)}::`
    if (key === this.lastSampleKey) return
    this.lastSampleKey = key
    const sample: SubtitleSample = {
      source: authority.source,
      text: '',
      mediaTime: 0,
      observedAt: this.now(),
    }
    for (const subscriber of this.sampleSubscribers) subscriber(sample)
  }

  private report(
    evaluated: EvaluatedCandidate[],
    reason = this.status.reason,
    status?: DetectionStatus,
  ): void {
    if (!this.transport) return
    const videos = this.videoRegistry?.getVisibleVideos() ?? []
    const candidates: CandidateSummary[] = evaluated
      .filter((item) => !item.candidate.invalidReason)
      .slice(0, MAX_CANDIDATES_PER_FRAME)
      .map((item) => ({
        source: item.source,
        score: item.score,
        kind: item.source.kind,
        ready: item.ready,
        hasText: !!item.candidate.text.trim(),
        playing: !item.entry.paused && !item.entry.ended,
        fullscreen: item.entry.fullscreen,
        visible: item.entry.visible && item.entry.visibleArea > 0,
        visibleArea: item.entry.visibleArea,
        reason: item.connectReason,
      }))
    const report: DetectionFrameReport = {
      documentId: this.documentId,
      url: this.win.location?.href || '',
      phase: status?.phase ?? this.status.phase,
      reason,
      candidates,
      documentVisible: this.visibility.isDocumentVisible(),
      frameVisible: this.visibility.isFrameVisible?.() ?? !!this.visibility.getVisibleRegion(),
      videoCount: videos.length,
      fullscreen: videos.some((entry) => entry.fullscreen),
      observedAt: this.now(),
    }
    this.transport.update(report)
  }

  private getHistory(key: string): CandidateHistory {
    let history = this.histories.get(key)
    if (!history) {
      history = new CandidateHistory()
      this.histories.set(key, history)
    }
    return history
  }

  private pruneHistories(now: number): void {
    if (this.histories.size <= MAX_CANDIDATES_PER_FRAME * 2) return
    for (const [key, seenAt] of Array.from(this.historySeenAt.entries())) {
      if (now - seenAt > 120000) {
        this.historySeenAt.delete(key)
        this.histories.delete(key)
        this.lastKnown.delete(key)
      }
    }
  }

  private ensureNativeAdapters(videos: VideoEntry[]): void {
    const active = new Set(videos.map((entry) => entry.id))
    for (const [id, adapter] of Array.from(this.nativeAdapters.entries())) {
      if (!active.has(id)) {
        adapter.detach()
        this.nativeAdapters.delete(id)
      }
    }
    for (const entry of videos) {
      if (this.nativeAdapters.has(entry.id)) continue
      const adapter = new NativeTrackAdapter()
      adapter.attach(entry.video, () => this.scheduleEvaluation(0))
      this.nativeAdapters.set(entry.id, adapter)
    }
  }

  // -------------------------------------------------------------------- yetki

  private handleGrant(authority: DetectionAuthority): void {
    this.authorityKey = sourceKey(authority.source)
    this.belowAnchorMissingSince.clear()
    this.lastSampleKey = ''
    this.playingSince = null
    if (
      this.currentPresentation &&
      sourceKey(this.currentPresentation.source) !== this.authorityKey
    ) {
      // Yeni yetki, eski kaynağın yerleşimini devralmaz.
      this.setPresentation(null)
    }
    this.setStatus({
      phase: 'verifying',
      source: authority.source,
      reason: 'grant-received',
    })
    this.scheduleEvaluation(0)
  }

  private handleRevoke(token: string, reason: string): void {
    this.authorityKey = ''
    this.belowAnchorMissingSince.clear()
    this.lastSampleKey = ''
    this.setPresentation(null)
    try {
      this.transport?.release(token)
    } catch {
      // yoksay
    }
    this.setStatus({ phase: 'verifying', reason: reason || 'revoked' })
    this.scheduleEvaluation(0)
  }

  private handleAuthorityLost(reason: string): void {
    this.authorityKey = ''
    this.belowAnchorMissingSince.clear()
    this.lastSampleKey = ''
    this.setPresentation(null)
    this.setStatus({ phase: 'verifying', reason })
    this.scheduleEvaluation(0)
  }

  private setStatus(next: DetectionStatus): void {
    const current = this.status
    const sameSource =
      sourceKeyOrEmpty(next.source) === sourceKeyOrEmpty(current.source)
    if (
      current.phase === next.phase &&
      current.reason === next.reason &&
      current.score === next.score &&
      sameSource
    ) {
      return
    }
    this.status = next
    for (const subscriber of this.statusSubscribers) subscriber(next)
  }
}

function sourceKeyOrEmpty(source?: SourceRef): string {
  return source ? sourceKey(source) : ''
}

function clonePresentation(
  presentation: SubtitlePresentation | null,
): SubtitlePresentation | null {
  if (!presentation) return null
  return {
    source: { ...presentation.source },
    mode: presentation.mode,
    anchor: presentation.anchor,
    mountAfter: presentation.mountAfter,
  }
}






