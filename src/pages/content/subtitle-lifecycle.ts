/**
 * Altyazı yaşam döngüsü durum makinesi.
 *
 * DOM'a ve chrome API'lerine dokunmaz; böylece Jest fake timer'ları ile
 * deterministik olarak test edilebilir. Sorumlulukları:
 *
 *  - tek kaynak algılama yolu (normalize + 200 ms kararlılık)
 *  - kaynak sürümü (epoch): her yeni kaynakta artar, eski yanıtları geçersizleştirir
 *  - aktif istek sahipliği
 *  - görünür İngilizce/Türkçe çifti
 *  - boşluk (kaynak yok) zamanlayıcıları: 1500 ms grace, 6000 ms tavan
 */

export interface LifecycleTiming {
  /** Yeni kaynağın gönderilmesi için gereken kararlılık süresi. */
  stabilityMs: number
  /** Kaynak kaybolduktan sonra kutunun görünür kaldığı süre. */
  graceMs: number
  /** Boşluk başlangıcından itibaren en uzun görünür kalma süresi. */
  maxGapMs: number
}

export const DEFAULT_TIMING: LifecycleTiming = {
  stabilityMs: 200,
  graceMs: 1500,
  maxGapMs: 6000,
}

export interface VisiblePair {
  source: string
  translation: string
}

export interface LifecycleHandlers {
  /** Kararlı yeni kaynak: çeviri isteği başlatılmalı. */
  onTranslate: (source: string, epoch: number) => void
  /** Görünür çift gizlendi; sürüm geçersizleştirildi, port kapatılmalı. */
  onHide: (epoch: number) => void
}

/** Trim + ardışık boşluk normalizasyonu. Karşılaştırma her zaman bununla yapılır. */
export function normalizeSource(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw.replace(/\s+/g, ' ').trim()
}

export class SubtitleLifecycle {
  private readonly handlers: LifecycleHandlers
  private readonly timing: LifecycleTiming

  private active = false
  private currentEpoch = 0

  private candidate = ''
  private stabilityTimer: ReturnType<typeof setTimeout> | null = null

  private gapStartedAt: number | null = null
  private hideTimer: ReturnType<typeof setTimeout> | null = null

  private request: { source: string; epoch: number } | null = null
  private visible: VisiblePair | null = null

  /** invalidate() sonrası aynı kaynak yeniden değerlendirilsin. */
  private forceReevaluate = false

  constructor(handlers: LifecycleHandlers, timing: Partial<LifecycleTiming> = {}) {
    this.handlers = handlers
    this.timing = { ...DEFAULT_TIMING, ...timing }
  }

  public get epoch(): number {
    return this.currentEpoch
  }

  public get isActive(): boolean {
    return this.active
  }

  public get visiblePair(): VisiblePair | null {
    return this.visible
  }

  public get pendingSource(): string {
    return this.candidate
  }

  public get hasActiveRequest(): boolean {
    return this.request !== null
  }

  public get gapSince(): number | null {
    return this.gapStartedAt
  }

  /** invalidate() sonrası "aynı kaynak yine de yeniden değerlendirilsin" bayrağı. */
  public get needsReevaluation(): boolean {
    return this.forceReevaluate
  }

  /** Taramayı etkinleştirir; önceki oturumdan kalan işi geçersizleştirir. */
  public activate(): void {
    if (this.active) return
    this.active = true
    this.candidate = ''
    this.forceReevaluate = false
    this.clearStabilityTimer()
    this.clearGap()
    this.request = null
    this.bump()
  }

  /**
   * Taramayı durdurur ve tüm zamanlayıcıları temizler.
   * Görünür çift korunur (kutu DOM'dan kaldırılacaksa yönetici halleder).
   */
  public deactivate(): void {
    this.active = false
    this.clearStabilityTimer()
    this.clearGap()
    this.request = null
    this.candidate = ''
    this.forceReevaluate = false
    this.bump()
  }

  /** Sürümü artırır: bekleyen/eski tüm yanıtları geçersiz kılar. */
  public invalidate(): void {
    this.clearStabilityTimer()
    this.candidate = ''
    this.request = null
    // Görünür çift DOM'da kalır (state ile tutarlı); aynı kaynak yine de
    // "yeniden değerlendir" bayrağıyla yeniden istenir.
    this.forceReevaluate = true
    this.bump()
  }

  /** @returns sürüm hâlâ güncel mi */
  public isEpochCurrent(epoch: number): boolean {
    return this.active && epoch === this.currentEpoch
  }

  /**
   * Tek kaynak algılama yolu. Aynı kaynağın tekrar tekrar taranması
   * kararlılık (debounce) süresini sıfırlamaz.
   */
  public observe(rawSource: string | null | undefined): void {
    if (!this.active) return

    const source = normalizeSource(rawSource)

    if (!source) {
      this.beginGap()
      return
    }

    // Kaynak geri geldi: bekleyen gizlemeyi iptal et.
    this.clearGap()

    // Uçuştaki istek zaten bu kaynak için: yeni istek üretme (istek
    // sürerken DOM'un bir tarama boş kalması bunu tetiklememeli).
    // Yalnızca istek HÂLÂ GÜNCEL sürüme aitse geçerlidir: epoch'u geçmiş bir
    // istek sahip değildir, yoksa bayat kayıt yüzünden güncel adayın
    // timer'ı ayakta kalırken erken dönülür.
    if (
      this.request !== null &&
      this.request.source === source &&
      this.request.epoch === this.currentEpoch
    ) {
      this.clearStabilityTimer()
      this.candidate = source
      return
    }

    // Aynı aday zaten bekliyor: debounce'u uzatma.
    if (source === this.candidate) return

    // Aynı altyazı hâlihazırda ekranda ve istek yok: yeni istek üretme.
    // Ancak başka bir adayın bekleyen timer'ı iptal edilmeli; aksi halde
    // 200 ms sonra o aday için onTranslate tetiklenip ekrandaki doğru çifti
    // ezer (göz kırpma). Uçuştaki iş de epoch artırılarak geçersizleşir —
    // zaten ekranda gösterilen bir kaynağın tekrar çevrilmesi gereksizdir.
    if (
      !this.forceReevaluate &&
      source === this.visible?.source &&
      this.request === null
    ) {
      this.clearStabilityTimer()
      this.candidate = source
      this.bump()
      return
    }

    this.forceReevaluate = false
    this.candidate = source
    // Yeni kaynak: uçuştaki (varsa) iş artık sahipsiz kaldı.
    this.request = null
    const epoch = this.bump()
    this.clearStabilityTimer()
    this.stabilityTimer = setTimeout(() => {
      this.stabilityTimer = null
      if (!this.active || epoch !== this.currentEpoch) return
      this.handlers.onTranslate(source, epoch)
    }, this.timing.stabilityMs)
  }

  /**
   * İsteğin sahipliğini alır. Yalnızca güncel sürüm için başarılı olur.
   */
  public beginRequest(source: string, epoch: number): boolean {
    if (!this.isEpochCurrent(epoch)) return false
    this.request = { source, epoch }
    return true
  }

  /** İsteği serbest bırakır (hata/iptal yolları için). */
  public releaseRequest(epoch: number): void {
    if (this.request && this.request.epoch === epoch) {
      this.request = null
    }
    if (this.gapStartedAt !== null) {
      this.scheduleGapHide()
    }
  }

  /**
   * Güncel isteği tamamlar ve görünür çifti atomik olarak günceller.
   * @returns sürüm güncel değilse false (hiçbir şey yazılmaz)
   */
  public completeRequest(epoch: number, pair: VisiblePair): boolean {
    if (!this.isEpochCurrent(epoch)) return false
    this.request = null
    this.visible = { ...pair }
    if (this.gapStartedAt !== null) {
      this.scheduleGapHide()
    }
    return true
  }

  /** Görünür çifti hemen gizler ve sürümü geçersizleştirir. */
  public hideNow(): void {
    this.performHide()
  }

  public dispose(): void {
    this.deactivate()
    this.visible = null
  }

  private bump(): number {
    this.currentEpoch += 1
    return this.currentEpoch
  }

  private beginGap(): void {
    // Kaybolan kaynağın henüz gönderilmemiş isteğini iptal et.
    this.clearStabilityTimer()

    if (this.request !== null) {
      // Uçuştaki istek hâlâ bu kaynağı çeviriyor: aynı altyazı geri
      // geldiğinde yeni istek üretilmemesi için adayı koru. Burada epoch
      // artırılmaz; aksi halde uçuştaki istek boşa düşer.
      this.candidate = this.request.source
    } else {
      this.candidate = ''
    }

    // Gizlenecek görünür çift ya da bekleyen istek yoksa boşluk saati
    // başlatmanın anlamı yok (boş yere epoch bump / onHide üretme).
    if (this.visible === null && this.request === null) {
      this.gapStartedAt = null
      return
    }

    if (this.gapStartedAt === null) {
      this.gapStartedAt = this.now()
    }
    // Tekrarlanan boş taramalar boşluk başlangıcını kaydırmaz.
    this.scheduleGapHide()
  }

  private scheduleGapHide(): void {
    if (this.gapStartedAt === null) return
    const graceEnd = this.gapStartedAt + this.timing.graceMs
    const capEnd = this.gapStartedAt + this.timing.maxGapMs

    // Güncel istek bekleniyorsa eski çifti tavana (maxGapMs) kadar koru;
    // istek bitince en fazla grace kadar daha tut.
    const deadline = this.request !== null ? capEnd : Math.max(graceEnd, this.now())

    this.scheduleHide(Math.min(deadline, capEnd))
  }

  private scheduleHide(deadline: number): void {
    this.clearHideTimer()
    const delay = Math.max(0, deadline - this.now())
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null
      this.performHide()
    }, delay)
  }

  private performHide(): void {
    this.clearHideTimer()
    this.clearStabilityTimer()
    this.clearGap()
    this.visible = null
    this.request = null
    this.candidate = ''
    this.forceReevaluate = false
    const epoch = this.bump()
    if (this.active) {
      this.handlers.onHide(epoch)
    }
  }

  private clearGap(): void {
    this.clearHideTimer()
    this.gapStartedAt = null
  }

  private clearStabilityTimer(): void {
    if (this.stabilityTimer !== null) {
      clearTimeout(this.stabilityTimer)
      this.stabilityTimer = null
    }
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
  }

  private now(): number {
    return Date.now()
  }
}
