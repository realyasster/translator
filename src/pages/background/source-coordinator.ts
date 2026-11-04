/**
 * Sekme başına tek yetkili altyazı kaynağı koordinatörü.
 *
 * Frame'ler yalnızca doğrulanmış aday özetleri bildirir. Koordinatör:
 *  - tam ekran / oynayan görünür video / en büyük alan / mevcut sahip sırasıyla
 *    adayları sıralar,
 *  - sahiplik token'ı üretir ve heartbeat ile yeniler,
 *  - eski sahip durduğunu onaylamadan veya yetkisi sona ermeden yeni sahip
 *    atamaz,
 *  - normal ve streaming çeviri isteklerinde token/kaynak doğrular.
 */

import {
  AREA_ADVANTAGE,
  CandidateSummary,
  CONNECT_THRESHOLD,
  DetectionPhase,
  DetectionStatus,
  OWNERSHIP_TIMEOUT_MS,
  RIVAL_SCORE_GAP,
  SourceKind,
  SourceRef,
  SWITCH_HOLD_MS,
} from '../../types/detection'

export interface GrantRequest {
  tabId: number
  frameId: number
  token: string
  source: SourceRef
  expiresAt: number
}

export interface RevokeRequest {
  tabId: number
  frameId: number
  token: string
  reason: string
}

export interface CoordinatorHooks {
  grant: (request: GrantRequest) => void
  revoke: (request: RevokeRequest) => void
}

export interface FrameUpdate {
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

export interface SourceCoordinatorOptions {
  hooks: CoordinatorHooks
  now?: () => number
  createToken?: () => string
  ownershipTimeoutMs?: number
  switchHoldMs?: number
  areaAdvantage?: number
}

interface FrameSession {
  tabId: number
  frameId: number
  documentId: string
  url: string
  phase: DetectionPhase
  reason: string
  candidates: CandidateSummary[]
  documentVisible: boolean
  frameVisible: boolean
  videoCount: number
  fullscreen: boolean
  updatedAt: number
}

interface OwnerState {
  frameId: number
  token: string
  source: SourceRef
  score: number
  grantedAt: number
  expiresAt: number
  releasing: boolean
}

interface PendingGrant {
  frameId: number
  source: SourceRef
  score: number
  createdAt: number
}

interface TabState {
  sessions: Map<number, FrameSession>
  owner: OwnerState | null
  pending: PendingGrant | null
  rivalKey: string | null
  rivalSince: number
}

interface OwnedCandidate {
  tabId: number
  frameId: number
  candidate: CandidateSummary
  session: FrameSession
}

function sourceMatches(a: SourceRef, b: SourceRef): boolean {
  return (
    a.documentId === b.documentId &&
    a.videoId === b.videoId &&
    a.sourceId === b.sourceId &&
    a.generation === b.generation &&
    a.kind === b.kind
  )
}

function candidateKey(candidate: CandidateSummary, frameId: number): string {
  return [
    frameId,
    candidate.source.videoId,
    candidate.source.sourceId,
    candidate.source.generation,
    candidate.source.kind,
  ].join('|')
}

function stableCandidateKey(candidate: CandidateSummary, frameId: number): string {
  return [
    frameId,
    candidate.source.videoId,
    candidate.source.sourceId,
    candidate.source.kind,
  ].join('|')
}

export class SourceCoordinator {
  private readonly hooks: CoordinatorHooks
  private readonly now: () => number
  private readonly createToken: () => string
  private readonly ownershipTimeoutMs: number
  private readonly switchHoldMs: number
  private readonly areaAdvantage: number
  private tabs = new Map<number, TabState>()
  // Fail-closed: storage okunana kadar yetki verilmez. Background, depodan
  // okuduğu status ile setEnabled(true) çağırır.
  private enabled = false

  constructor(options: SourceCoordinatorOptions) {
    this.hooks = options.hooks
    this.now = options.now ?? (() => Date.now())
    this.createToken =
      options.createToken ??
      (() => {
        const cryptoObj = (globalThis as any).crypto
        if (cryptoObj?.randomUUID) return `own_${cryptoObj.randomUUID()}`
        // Çok eski ortamlar için geri dönüş; MV3 service worker'da UUID vardır.
        return `own_${Date.now().toString(36)}_${Math.random()
          .toString(36)
          .slice(2, 10)}`
      })
    this.ownershipTimeoutMs =
      options.ownershipTimeoutMs ?? OWNERSHIP_TIMEOUT_MS
    this.switchHoldMs = options.switchHoldMs ?? SWITCH_HOLD_MS
    this.areaAdvantage = options.areaAdvantage ?? AREA_ADVANTAGE
  }

  // ---------------------------------------------------------------- kayıt

  public register(
    tabId: number,
    frameId: number,
    documentId: string,
    url: string,
    now = this.now(),
  ): void {
    const tab = this.getTab(tabId)
    const existing = tab.sessions.get(frameId)
    if (existing && existing.documentId !== documentId) {
      // Yeni content script oturumu: eski yetki devam edemez.
      if (tab.owner && tab.owner.frameId === frameId) {
        const owner = tab.owner
        tab.owner = null
        tab.pending = null
        this.hooks.revoke({
          tabId,
          frameId,
          token: owner.token,
          reason: 'document-changed',
        })
      }
      tab.sessions.delete(frameId)
    }
    tab.sessions.set(frameId, {
      tabId,
      frameId,
      documentId,
      url,
      phase: existing?.documentId === documentId ? existing.phase : 'searching',
      reason: existing?.documentId === documentId ? existing.reason : 'registered',
      candidates:
        existing?.documentId === documentId ? existing.candidates : [],
      documentVisible:
        existing?.documentId === documentId
          ? existing.documentVisible
          : false,
      frameVisible:
        existing?.documentId === documentId ? existing.frameVisible : false,
      videoCount: existing?.documentId === documentId ? existing.videoCount : 0,
      fullscreen: existing?.documentId === documentId ? existing.fullscreen : false,
      updatedAt: now,
    })
  }

  public update(
    tabId: number,
    frameId: number,
    update: FrameUpdate,
    now = this.now(),
  ): void {
    let tab = this.tabs.get(tabId)
    if (!tab) {
      tab = this.getTab(tabId)
    }
    const existing = tab.sessions.get(frameId)
    if (!existing || existing.documentId !== update.documentId) {
      this.register(tabId, frameId, update.documentId, update.url, now)
      tab = this.getTab(tabId)
    }
    const session = tab.sessions.get(frameId)
    if (!session) return
    session.url = update.url
    session.phase = update.phase
    session.reason = update.reason
    session.candidates = Array.isArray(update.candidates)
      ? update.candidates
          .filter((candidate) => candidate && candidate.source)
          .slice(0, 100)
      : []
    session.documentVisible = !!update.documentVisible
    session.frameVisible = !!update.frameVisible
    session.videoCount = update.videoCount || 0
    session.fullscreen = !!update.fullscreen
    session.updatedAt = now

    this.arbitrate(tabId, now)
  }

  public release(
    tabId: number,
    frameId: number,
    token: string,
    now = this.now(),
  ): void {
    const tab = this.tabs.get(tabId)
    if (!tab || !tab.owner) return
    const owner = tab.owner
    if (owner.frameId !== frameId || owner.token !== token) return
    tab.owner = null
    this.grantPendingOrArbitrate(tabId, now)
  }

  public unregister(tabId: number, frameId: number, now = this.now()): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    tab.sessions.delete(frameId)
    if (tab.owner && tab.owner.frameId === frameId) {
      // Port kapandı: eski sahip artık çalışmıyor.
      tab.owner = null
      tab.pending = null
    }
    if (tab.pending && tab.pending.frameId === frameId) {
      tab.pending = null
    }
    if (!tab.sessions.size) {
      this.tabs.delete(tabId)
      return
    }
    this.arbitrate(tabId, now)
  }

  public heartbeat(
    tabId: number,
    frameId: number,
    token: string,
    now = this.now(),
  ): { renewed: boolean; expiresAt?: number; score?: number } {
    if (!this.enabled) return { renewed: false }
    const tab = this.tabs.get(tabId)
    if (!tab || !tab.owner) return { renewed: false }
    const owner = tab.owner
    if (owner.frameId !== frameId || owner.token !== token || owner.releasing) {
      return { renewed: false }
    }
    if (now > owner.expiresAt) {
      this.expireOwner(tabId, now)
      return { renewed: false }
    }
    owner.expiresAt = now + this.ownershipTimeoutMs
    owner.score =
      this.findCandidate(tab, owner.frameId, owner.source)?.candidate.score ??
      owner.score
    this.hooks.grant({
      tabId,
      frameId: owner.frameId,
      token: owner.token,
      source: owner.source,
      expiresAt: owner.expiresAt,
    })
    return {
      renewed: true,
      expiresAt: owner.expiresAt,
      score: owner.score,
    }
  }

  public validate(
    tabId: number,
    frameId: number,
    token: string,
    source: SourceRef,
    now = this.now(),
  ): { valid: boolean; reason: string } {
    if (!this.enabled) return { valid: false, reason: 'disabled' }
    const tab = this.tabs.get(tabId)
    if (!tab || !tab.owner) return { valid: false, reason: 'no-owner' }
    const owner = tab.owner
    if (owner.frameId !== frameId) return { valid: false, reason: 'wrong-frame' }
    if (owner.token !== token) return { valid: false, reason: 'stale-token' }
    if (owner.releasing) return { valid: false, reason: 'releasing' }
    if (now > owner.expiresAt) {
      this.expireOwner(tabId, now)
      return { valid: false, reason: 'expired' }
    }
    if (!sourceMatches(owner.source, source)) {
      return { valid: false, reason: 'source-mismatch' }
    }
    return { valid: true, reason: 'authorized' }
  }

  public expire(now = this.now()): void {
    for (const [tabId, tab] of Array.from(this.tabs.entries())) {
      if (tab.owner && now > tab.owner.expiresAt) {
        this.expireOwner(tabId, now)
      }
    }
  }

  /**
   * Eklenti ana anahtarı. Kapatıldığında mevcut yetkiler iptal edilir ve
   * açılana kadar hiçbir aday yetkilendirilmez; session'lar korunur.
   */
  public setEnabled(enabled: boolean, now = this.now()): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    if (!enabled) {
      this.revokeAll('disabled')
      return
    }
    for (const tabId of Array.from(this.tabs.keys())) {
      this.arbitrate(tabId, now)
    }
  }

  public isEnabled(): boolean {
    return this.enabled
  }

  public status(tabId: number, now = this.now()): DetectionStatus & {
    frameId?: number
    sourceKind?: SourceKind
  } {
    if (!this.enabled) {
      return { phase: 'disabled', reason: 'extension-disabled' }
    }
    const tab = this.tabs.get(tabId)
    if (!tab) {
      // MV3 service worker yeniden başladıysa bellek boştur; frame'ler kısa
      // süre içinde yeniden kayıt olur. Bu aralıkta "searching" beklenendir.
      return { phase: 'searching', reason: 'no-frame' }
    }

    const owner = tab.owner
    if (owner && !owner.releasing && now <= owner.expiresAt) {
      const session = tab.sessions.get(owner.frameId)
      const candidate = this.findCandidate(tab, owner.frameId, owner.source)
      return {
        phase: session?.phase ?? 'connected',
        source: owner.source,
        score: candidate?.candidate.score ?? owner.score,
        reason: session?.reason ?? 'connected',
        frameId: owner.frameId,
        sourceKind: owner.source.kind,
      }
    }

    if (owner && owner.releasing) {
      return {
        phase: 'verifying',
        reason: 'switching-source',
        frameId: owner.frameId,
      }
    }

    const candidates = this.eligibleCandidates(tab)
    if (candidates.length) {
      const best = candidates[0]
      return {
        phase: best.session.phase,
        score: best.candidate.score,
        reason: best.session.reason,
        frameId: best.frameId,
        sourceKind: best.candidate.kind,
      }
    }

    const sessions = Array.from(tab.sessions.values())
    const unavailable = sessions.find((session) => session.phase === 'unavailable')
    if (unavailable) {
      return {
        phase: 'unavailable',
        reason: unavailable.reason,
        frameId: unavailable.frameId,
      }
    }
    const verifying = sessions.find((session) => session.phase === 'verifying')
    if (verifying) {
      return {
        phase: 'verifying',
        reason: verifying.reason,
        frameId: verifying.frameId,
      }
    }
    const suspended = sessions.find((session) => session.phase === 'suspended')
    if (suspended) {
      return {
        phase: 'suspended',
        reason: suspended.reason,
        frameId: suspended.frameId,
      }
    }
    const first = sessions[0]
    return first
      ? {
          phase: first.phase,
          reason: first.reason,
          frameId: first.frameId,
        }
      : { phase: 'searching', reason: 'no-frame' }
  }

  public revokeAll(reason: string): void {
    for (const [tabId, tab] of Array.from(this.tabs.entries())) {
      const owner = tab.owner
      tab.owner = null
      tab.pending = null
      tab.rivalKey = null
      // Hook'tan önce sahipliği bırak: revoke iletilemezse fallback
      // release() reentrant çağrılsa bile eşleşecek bir owner kalmaz.
      if (owner) {
        this.hooks.revoke({
          tabId,
          frameId: owner.frameId,
          token: owner.token,
          reason,
        })
      }
    }
  }

  public removeTab(tabId: number): void {
    this.tabs.delete(tabId)
  }

  public getOwner(tabId: number): { frameId: number; source: SourceRef } | null {
    const tab = this.tabs.get(tabId)
    if (!tab?.owner) return null
    return { frameId: tab.owner.frameId, source: tab.owner.source }
  }

  // ------------------------------------------------------------- karar verme

  private getTab(tabId: number): TabState {
    let tab = this.tabs.get(tabId)
    if (!tab) {
      tab = {
        sessions: new Map(),
        owner: null,
        pending: null,
        rivalKey: null,
        rivalSince: 0,
      }
      this.tabs.set(tabId, tab)
    }
    return tab
  }

  private arbitrate(tabId: number, now: number): void {
    // Eklenti kapalıyken gelen geç DETECTION_UPDATE yeni yetki üretmemeli.
    if (!this.enabled) return
    const tab = this.tabs.get(tabId)
    if (!tab) return

    if (tab.owner && now > tab.owner.expiresAt) {
      this.expireOwner(tabId, now)
      return
    }

    if (tab.owner && tab.owner.releasing) {
      this.refreshPending(tab)
      return
    }

    const eligible = this.eligibleCandidates(tab)
    const best = eligible[0] ?? null

    if (tab.owner) {
      const ownerCandidate = this.findCandidate(
        tab,
        tab.owner.frameId,
        tab.owner.source,
      )
      if (!ownerCandidate) {
        const replacement =
          best && !this.isSameOwnerCandidate(best, tab) ? best : null
        this.requestRevoke(tabId, 'source-lost', replacement, now)
        return
      }
      if (!best || this.isSameOwnerCandidate(best, tab)) {
        tab.rivalKey = null
        return
      }
      if (best.candidate.fullscreen) {
        this.requestSwitch(tabId, best, 'fullscreen', now)
        return
      }

      const scoreAdvantage =
        best.candidate.score >=
        ownerCandidate.candidate.score + RIVAL_SCORE_GAP
      const playAdvantage = best.candidate.playing && !ownerCandidate.candidate.playing
      const areaAdvantage =
        best.candidate.visibleArea >=
        ownerCandidate.candidate.visibleArea * this.areaAdvantage

      if (!scoreAdvantage && !playAdvantage && !areaAdvantage) {
        tab.rivalKey = null
        return
      }

      const key = candidateKey(best.candidate, best.frameId)
      if (tab.rivalKey !== key) {
        tab.rivalKey = key
        tab.rivalSince = now
        return
      }
      if (now - tab.rivalSince >= this.switchHoldMs) {
        this.requestSwitch(tabId, best, 'better-source', now)
      }
      return
    }

    // Sahip yok: bekleyen devir yoksa en iyi adaya hemen yetki verilir.
    if (tab.pending) {
      this.refreshPending(tab)
      return
    }
    if (best) {
      this.grantCandidate(tabId, best, now)
    }
  }

  private eligibleCandidates(tab: TabState): OwnedCandidate[] {
    const list: OwnedCandidate[] = []
    for (const session of Array.from(tab.sessions.values())) {
      if (!session.frameVisible) continue
      for (const candidate of session.candidates) {
        if (!candidate.visible) continue
        if (!candidate.ready) continue
        if (candidate.score < CONNECT_THRESHOLD) continue
        list.push({
          tabId: session.tabId,
          frameId: session.frameId,
          candidate,
          session,
        })
      }
    }

    list.sort((a, b) => {
      if (a.candidate.fullscreen !== b.candidate.fullscreen) {
        return a.candidate.fullscreen ? -1 : 1
      }
      const aPlaying = a.candidate.playing
      const bPlaying = b.candidate.playing
      if (aPlaying !== bPlaying) return aPlaying ? -1 : 1
      if (a.candidate.visibleArea !== b.candidate.visibleArea) {
        return b.candidate.visibleArea - a.candidate.visibleArea
      }
      if (tab.owner) {
        const aOwner =
          tab.owner.frameId === a.frameId &&
          sourceMatches(tab.owner.source, a.candidate.source)
        const bOwner =
          tab.owner.frameId === b.frameId &&
          sourceMatches(tab.owner.source, b.candidate.source)
        if (aOwner !== bOwner) return aOwner ? -1 : 1
      }
      return stableCandidateKey(a.candidate, a.frameId).localeCompare(
        stableCandidateKey(b.candidate, b.frameId),
      )
    })
    return list
  }

  private findCandidate(
    tab: TabState,
    frameId: number,
    source: SourceRef,
  ): OwnedCandidate | null {
    const session = tab.sessions.get(frameId)
    if (!session) return null
    const candidate = session.candidates.find((item) =>
      sourceMatches(item.source, source),
    )
    if (!candidate) return null
    return {
      tabId: session.tabId,
      frameId,
      candidate,
      session,
    }
  }

  private isSameOwnerCandidate(
    candidate: OwnedCandidate,
    tab: TabState,
  ): boolean {
    return (
      !!tab.owner &&
      tab.owner.frameId === candidate.frameId &&
      sourceMatches(tab.owner.source, candidate.candidate.source)
    )
  }

  private grantCandidate(
    tabId: number,
    candidate: OwnedCandidate,
    now: number,
  ): void {
    const tab = this.getTab(tabId)
    const token = this.createToken()
    const expiresAt = now + this.ownershipTimeoutMs
    tab.owner = {
      frameId: candidate.frameId,
      token,
      source: candidate.candidate.source,
      score: candidate.candidate.score,
      grantedAt: now,
      expiresAt,
      releasing: false,
    }
    tab.pending = null
    tab.rivalKey = null
    this.hooks.grant({
      tabId,
      frameId: candidate.frameId,
      token,
      source: candidate.candidate.source,
      expiresAt,
    })
  }

  private requestSwitch(
    tabId: number,
    best: OwnedCandidate,
    reason: string,
    now: number,
  ): void {
    const tab = this.getTab(tabId)
    if (!tab.owner) {
      this.grantCandidate(tabId, best, now)
      return
    }
    const owner = tab.owner
    tab.owner = { ...owner, releasing: true }
    tab.pending = {
      frameId: best.frameId,
      source: best.candidate.source,
      score: best.candidate.score,
      createdAt: now,
    }
    tab.rivalKey = null
    this.hooks.revoke({
      tabId,
      frameId: owner.frameId,
      token: owner.token,
      reason,
    })
  }

  private requestRevoke(
    tabId: number,
    reason: string,
    replacement: OwnedCandidate | null,
    now: number,
  ): void {
    const tab = this.getTab(tabId)
    if (!tab.owner) {
      if (replacement) this.grantCandidate(tabId, replacement, now)
      return
    }
    const owner = tab.owner
    tab.owner = { ...owner, releasing: true }
    tab.pending = replacement
      ? {
          frameId: replacement.frameId,
          source: replacement.candidate.source,
          score: replacement.candidate.score,
          createdAt: now,
        }
      : null
    tab.rivalKey = null
    this.hooks.revoke({
      tabId,
      frameId: owner.frameId,
      token: owner.token,
      reason,
    })
  }

  private grantPendingOrArbitrate(tabId: number, now: number): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    const pending = tab.pending
    tab.pending = null
    if (pending) {
      const candidate = this.findCandidate(tab, pending.frameId, pending.source)
      if (candidate && candidate.candidate.ready && candidate.candidate.visible) {
        this.grantCandidate(tabId, candidate, now)
        return
      }
    }
    this.arbitrate(tabId, now)
  }

  private refreshPending(tab: TabState): void {
    if (!tab.pending) return
    const candidate = this.findCandidate(
      tab,
      tab.pending.frameId,
      tab.pending.source,
    )
    if (
      candidate &&
      candidate.candidate.ready &&
      candidate.candidate.visible &&
      candidate.session.frameVisible
    ) {
      return
    }
    tab.pending = null
    // Eski sahip hâlâ bırakmadıysa yeni hedef sonraki güncellemede seçilir.
  }

  private expireOwner(tabId: number, now: number): void {
    const tab = this.tabs.get(tabId)
    if (!tab || !tab.owner) return
    const owner = tab.owner
    tab.owner = null
    tab.pending = null
    tab.rivalKey = null
    this.hooks.revoke({
      tabId,
      frameId: owner.frameId,
      token: owner.token,
      reason: 'expired',
    })
    this.arbitrate(tabId, now)
  }
}

