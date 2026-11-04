/**
 * Otomatik altyazı algılama sisteminin ortak tipleri ve mesaj sözleşmesi.
 *
 * Bu dosya content script, background ve arayüz arasında paylaşılır; DOM
 * referansı taşımaz. Frame'ler arası kimlikte tabId/frameId background
 * tarafından mesajın gerçek göndericisinden alınır.
 */

export type SourceKind = 'text-track' | 'player-dom' | 'generic-dom'

export type DetectionPhase =
  | 'disabled'
  | 'searching'
  | 'verifying'
  | 'connected'
  | 'waiting'
  | 'suspended'
  | 'unavailable'

export interface SourceRef {
  documentId: string
  videoId: string
  sourceId: string
  generation: number
  kind: SourceKind
}

export interface SubtitleSample {
  source: SourceRef
  text: string
  mediaTime: number
  observedAt: number
}

export interface DetectionStatus {
  phase: DetectionPhase
  source?: SourceRef
  score?: number
  reason: string
}

export interface DetectionAuthority {
  token: string
  source: SourceRef
  expiresAt: number
}

export interface SubtitleDetector {
  start(): void
  stop(): void
  dispose(): void
  subscribe(
    onSample: (sample: SubtitleSample) => void,
    onStatus: (status: DetectionStatus) => void,
  ): () => void
  /** Yetkili kaynak ve sahiplik token'ı; yoksa null. */
  getAuthority?(): DetectionAuthority | null
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface CandidateSummary {
  source: SourceRef
  score: number
  kind: SourceKind
  ready: boolean
  hasText: boolean
  playing: boolean
  fullscreen: boolean
  visible: boolean
  visibleArea: number
  reason?: string
}

export interface DetectionFrameReport {
  documentId: string
  url: string
  phase: DetectionPhase
  reason: string
  candidates: CandidateSummary[]
  documentVisible: boolean
  frameVisible: boolean
  videoCount: number
  fullscreen: boolean
  observedAt: number
}

export interface DetectionTransportHandlers {
  onGrant(authority: DetectionAuthority): void
  onRevoke(token: string, reason: string): void
  onDisconnect(reason: string): void
  onAuthorityExpired(): void
}

export interface DetectionTransport {
  start(
    report: DetectionFrameReport | null,
    handlers: DetectionTransportHandlers,
  ): void
  update(report: DetectionFrameReport): void
  release(token: string): void
  stop(): void
  authority(): DetectionAuthority | null
}

/** Content -> background mesajları. */
export type DetectionRequest =
  | {
      type: 'DETECTION_REGISTER'
      documentId: string
      url: string
    }
  | (DetectionFrameReport & { type: 'DETECTION_UPDATE' })
  | { type: 'SOURCE_HEARTBEAT'; token: string }
  | { type: 'SOURCE_RELEASED'; token: string }

/** Background -> content mesajları. */
export type DetectionCommand =
  | {
      type: 'SOURCE_GRANT'
      token: string
      source: SourceRef
      expiresAt: number
    }
  | { type: 'SOURCE_REVOKE'; token: string; reason: string }

export interface DetectionStatusResponse {
  type: 'DETECTION_STATUS'
  enabled: boolean
  status: DetectionStatus & {
    frameId?: number
    sourceKind?: SourceKind
  }
}

export const DETECTION_PORT_NAME = 'subtitle-detection'

/** Yetkilendirme altı saniye içinde yenilenmezse sona erer. */
export const OWNERSHIP_TIMEOUT_MS = 6000
export const HEARTBEAT_INTERVAL_MS = 2000
/** Rakip kaynak en az iki saniye üstünlüğünü korumalı. */
export const SWITCH_HOLD_MS = 2000
/** Yalnızca alanla devralma için gereken görünür alan avantajı. */
export const AREA_ADVANTAGE = 1.25
export const CONNECT_THRESHOLD = 80
export const RIVAL_SCORE_GAP = 15
export const BEHAVIOR_WINDOW_MS = 30000
export const MIN_CHANGE_SPACING_MS = 500
export const MAX_CANDIDATES_PER_FRAME = 100
export const MAX_SAMPLES_PER_CANDIDATE = 20
export const UNAVAILABLE_AFTER_PLAYING_MS = 10000
