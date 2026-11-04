/**
 * Background kaynak koordinatörüyle iletişim kuran runtime portu.
 *
 * - Durum değişiminde bildirim; patlamalarda en fazla 250 ms'de bir güncelleme.
 * - İki saniyede bir heartbeat; yetki altı saniye içinde yenilenmezse sona erer.
 * - Port koparsa çeviri durur; background yeniden başlarsa frame yeniden kayıt
 *   olur ve önceki yetkiyi kullanmaz.
 */

import {
  DetectionAuthority,
  DetectionCommand,
  DetectionFrameReport,
  DetectionRequest,
  DetectionTransport,
  DetectionTransportHandlers,
  DETECTION_PORT_NAME,
  HEARTBEAT_INTERVAL_MS,
  OWNERSHIP_TIMEOUT_MS,
} from '../../../types/detection'
import {
  isExpectedBfcachePortClose,
  readRuntimeLastError,
} from '../../../utils/port-errors'
import { isContentPageSuspended } from '../page-lifecycle'

const MAX_UPDATE_INTERVAL_MS = 250
const RECONNECT_DELAY_MS = 1000

export interface DetectionPortOptions {
  documentId: string
  url: string
  now?: () => number
  connect?: () => chrome.runtime.Port
}

export class DetectionPort implements DetectionTransport {
  private readonly documentId: string
  private url: string
  private readonly now: () => number
  private readonly connectFactory: () => chrome.runtime.Port

  private port: chrome.runtime.Port | null = null
  private handlers: DetectionTransportHandlers | null = null
  private latestReport: DetectionFrameReport | null = null
  private authorityData: DetectionAuthority | null = null
  private started = false
  private lastSentAt = 0
  private updateTimer: number | null = null
  private heartbeatTimer: number | null = null
  private reconnectTimer: number | null = null

  constructor(options: DetectionPortOptions) {
    this.documentId = options.documentId
    this.url = options.url
    this.now = options.now ?? (() => Date.now())
    this.connectFactory =
      options.connect ??
      (() => chrome.runtime.connect({ name: DETECTION_PORT_NAME }))
  }

  public start(
    report: DetectionFrameReport | null,
    handlers: DetectionTransportHandlers,
  ): void {
    if (this.started) return
    this.started = true
    this.handlers = handlers
    this.latestReport = report
    this.connect()
    this.heartbeatTimer = window.setInterval(
      () => this.heartbeat(),
      HEARTBEAT_INTERVAL_MS,
    )
  }

  public update(report: DetectionFrameReport): void {
    this.latestReport = report
    this.url = report.url
    if (!this.started) return
    const elapsed = this.now() - this.lastSentAt
    if (elapsed >= MAX_UPDATE_INTERVAL_MS) {
      this.flushUpdate()
      return
    }
    if (this.updateTimer !== null) return
    this.updateTimer = window.setTimeout(() => {
      this.updateTimer = null
      this.flushUpdate()
    }, Math.max(0, MAX_UPDATE_INTERVAL_MS - elapsed))
  }

  public release(token: string): void {
    this.authorityData = null
    this.post({ type: 'SOURCE_RELEASED', token })
  }

  public stop(): void {
    this.started = false
    if (this.updateTimer !== null) {
      window.clearTimeout(this.updateTimer)
      this.updateTimer = null
    }
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.authorityData = null
    this.handlers = null
    this.latestReport = null
    const port = this.port
    this.port = null
    if (port) {
      try {
        port.disconnect()
      } catch {
        // zaten kapalı
      }
    }
  }

  public authority(): DetectionAuthority | null {
    if (!this.authorityData) return null
    if (this.now() >= this.authorityData.expiresAt) {
      this.authorityData = null
      return null
    }
    return this.authorityData
  }

  private connect(): void {
    if (!this.started) return
    let port: chrome.runtime.Port
    try {
      port = this.connectFactory()
    } catch {
      this.scheduleReconnect()
      return
    }
    this.port = port

    port.onMessage.addListener((message: DetectionCommand) => {
      this.handleCommand(message)
    })
    port.onDisconnect.addListener(() => {
      // lastError callback başında, sahiplik erken dönüşünden önce okunur.
      const lastError = readRuntimeLastError()
      if (this.port !== port) return
      this.port = null
      this.authorityData = null
      if (this.started && this.handlers) {
        const pageSuspended = isContentPageSuspended()
        const bfcache = isExpectedBfcachePortClose(
          lastError,
          pageSuspended,
        )
        // Durum nedeni serbest hata metni değil sabit enum olmalı.
        this.handlers.onDisconnect(
          bfcache ? 'port-bfcache' : 'port-closed',
        )
        if (!bfcache && lastError) {
          console.debug('Detection port closed:', lastError.message)
        }
        // Yalnız sayfa gerçekten BFCache'te askıdaysa reconnect atlanır.
        if (!(bfcache && pageSuspended)) this.scheduleReconnect()
      }
    })

    this.post({
      type: 'DETECTION_REGISTER',
      documentId: this.documentId,
      url: this.url,
    })
    if (this.latestReport) this.flushUpdate()
  }

  private scheduleReconnect(): void {
    if (!this.started || this.reconnectTimer !== null) return
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, RECONNECT_DELAY_MS)
  }

  private handleCommand(message: DetectionCommand): void {
    if (!message || typeof message !== 'object') return
    if (message.type === 'SOURCE_GRANT') {
      const previous = this.authorityData
      this.authorityData = {
        token: message.token,
        source: message.source,
        expiresAt: message.expiresAt,
      }
      const changed =
        !previous ||
        previous.token !== message.token ||
        previous.source.sourceId !== message.source.sourceId ||
        previous.source.generation !== message.source.generation ||
        previous.source.videoId !== message.source.videoId
      if (changed && this.handlers) {
        this.handlers.onGrant(this.authorityData)
      }
      return
    }
    if (message.type === 'SOURCE_REVOKE') {
      const current = this.authorityData
      // Geç kalmış iptal, yeni token'ı etkisizleştirmemeli.
      if (current && current.token !== message.token) return
      this.authorityData = null
      if (this.handlers) {
        this.handlers.onRevoke(message.token, message.reason || 'revoked')
      }
    }
  }

  private heartbeat(): void {
    if (!this.started) return
    const data = this.authorityData
    if (!data) return
    if (this.now() >= data.expiresAt) {
      // Süre doldu: yetki sona erdi.
      this.authorityData = null
      if (this.handlers) this.handlers.onAuthorityExpired()
      return
    }
    this.post({ type: 'SOURCE_HEARTBEAT', token: data.token })
  }

  private flushUpdate(): void {
    if (this.updateTimer !== null) {
      window.clearTimeout(this.updateTimer)
      this.updateTimer = null
    }
    if (!this.started || !this.latestReport) return
    this.lastSentAt = this.now()
    this.post({
      ...this.latestReport,
      type: 'DETECTION_UPDATE',
      observedAt: this.now(),
    })
  }

  private post(message: DetectionRequest): void {
    const port = this.port
    if (!port) return
    try {
      port.postMessage(message)
    } catch {
      // Port kapanmış olabilir; onDisconnect yeniden bağlanmayı yönetir.
    }
  }
}




