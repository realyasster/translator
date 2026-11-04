/**
 * Altyazı adayı puanlama, eleme ve bağlanma koşulları.
 *
 * Puanlama saf fonksiyondur: DOM'a, saate ve tarayıcı API'lerine dokunmaz.
 * Bu sayede eşikler ve davranış kanıtı deterministik olarak test edilebilir.
 */

import {
  BEHAVIOR_WINDOW_MS,
  CONNECT_THRESHOLD,
  MAX_SAMPLES_PER_CANDIDATE,
  MIN_CHANGE_SPACING_MS,
  RIVAL_SCORE_GAP,
  SourceKind,
} from '../../../types/detection'

export interface CandidateEvidence {
  /** Etkin yerel altyazı kanalında geçerli cue. */
  nativeActiveCue?: boolean
  /** Doğrulanmış oynatıcı adaptörünün kesin altyazı kapsayıcısı. */
  verifiedPlayerContainer?: boolean
  /**
   * Oynatıcı kökü dışında, kararlı altyazı seçicisiyle eşleşen ve video altı
   * geometrisi doğrulanmış blok. Oynatıcı kapsayıcısı kanıtıyla karıştırılmaz.
   */
  verifiedCaptionBlock?: boolean
  /** Videoyla ortak yerel oynatıcı kapsayıcısı. */
  sharesPlayerContainer?: boolean
  /** Video alanıyla güçlü geometrik ilişki. */
  strongGeometry?: boolean
  /**
   * Udemy'nin doğrulanmış video altı altyazı ilişkisi.
   * Video ile örtüşen güçlü geometriyle birlikte iki kez sayılmaz.
   */
  verifiedBelowVideoRelation?: boolean
  /** Oynatma sırasında doğrulanan metin değişimleri. */
  verifiedTextChanges?: boolean
  /** Kısa, sınırlı satırlı metin yapısı. */
  shortLimitedLines?: boolean
  /** Altyazıyla ilişkili sınıf veya nitelik ipucu. */
  subtitleHint?: boolean
  /** Uzun veya yoğun metin bloğu. */
  longDenseText?: boolean
}

export type InvalidReason =
  | 'hidden'
  | 'detached'
  | 'unrelated-video'
  | 'interactive-control'
  | 'menu'
  | 'transcript'
  | 'chat'
  | 'plugin-ui'
  | 'video-invisible'
  | 'frame-invisible'

export const SCORE_WEIGHTS = {
  nativeActiveCue: 100,
  verifiedPlayerContainer: 40,
  verifiedCaptionBlock: 40,
  sharesPlayerContainer: 25,
  strongGeometry: 25,
  verifiedBelowVideoRelation: 25,
  verifiedTextChanges: 35,
  shortLimitedLines: 10,
  subtitleHint: 5,
  longDenseText: -20,
} as const

/** Kanıtlardan 0-100 arası güven puanı üretir. */
export function scoreCandidate(evidence: CandidateEvidence): number {
  let score = 0
  if (evidence.nativeActiveCue) score += SCORE_WEIGHTS.nativeActiveCue
  if (evidence.verifiedPlayerContainer) {
    score += SCORE_WEIGHTS.verifiedPlayerContainer
  }
  if (evidence.verifiedCaptionBlock) {
    score += SCORE_WEIGHTS.verifiedCaptionBlock
  }
  if (evidence.sharesPlayerContainer) score += SCORE_WEIGHTS.sharesPlayerContainer
  // Video üstü örtüşme ile video altı ilişki aynı geometrik bağı iki kez
  // ödüllendirmemeli.
  if (evidence.strongGeometry) {
    score += SCORE_WEIGHTS.strongGeometry
  } else if (evidence.verifiedBelowVideoRelation) {
    score += SCORE_WEIGHTS.verifiedBelowVideoRelation
  }
  if (evidence.verifiedTextChanges) score += SCORE_WEIGHTS.verifiedTextChanges
  if (evidence.shortLimitedLines) score += SCORE_WEIGHTS.shortLimitedLines
  if (evidence.subtitleHint) score += SCORE_WEIGHTS.subtitleHint
  if (evidence.longDenseText) score += SCORE_WEIGHTS.longDenseText
  return Math.max(0, Math.min(100, Math.round(score)))
}

export interface BehaviorSample {
  text: string
  mediaTime: number
  observedAt: number
}

export interface BehaviorMetrics {
  /** Son 30 saniyedeki nitelikli metin değişimi sayısı. */
  changeCount: number
  /** Değişimlerin tamamı son 30 saniyelik aralıkta mı? */
  withinWindow: boolean
  /** Değişimler birbirinden en az 500 ms uzakta mı? */
  spacingOk: boolean
  /** Video zamanı değişimler sırasında ilerledi mi? */
  mediaAdvanced: boolean
}

/**
 * Aday başına sınırlı davranış geçmişi.
 *
 * Yalnızca boş olmayan metinler arasındaki gerçek geçişler değişim sayılır.
 * Video zamanı ilerlemiyorsa (duraklama) yeni davranış kanıtı üretilmez.
 */
export class CandidateHistory {
  private samples: BehaviorSample[] = []
  private changes: BehaviorSample[] = []
  private bestScore = 0

  public record(
    text: string,
    mediaTime: number,
    observedAt: number,
  ): void {
    const trimmed = (text || '').trim()
    const previous = this.samples[this.samples.length - 1]
    if (previous && previous.text === trimmed) {
      // Aynı satırın yeniden okunması davranış geçmişini büyütmez ve
      // değişim zamanını kaydırmaz.
      previous.mediaTime = Math.max(previous.mediaTime, mediaTime)
      return
    }
    this.samples.push({ text: trimmed, mediaTime, observedAt })
    if (this.samples.length > MAX_SAMPLES_PER_CANDIDATE) {
      this.samples.splice(0, this.samples.length - MAX_SAMPLES_PER_CANDIDATE)
    }

    if (
      previous &&
      previous.text &&
      trimmed &&
      previous.text !== trimmed &&
      mediaTime > previous.mediaTime &&
      observedAt - previous.observedAt >= MIN_CHANGE_SPACING_MS
    ) {
      this.changes.push({ text: trimmed, mediaTime, observedAt })
      if (this.changes.length > MAX_SAMPLES_PER_CANDIDATE) {
        this.changes.splice(0, this.changes.length - MAX_SAMPLES_PER_CANDIDATE)
      }
    }
  }

  public metrics(now: number, windowMs = BEHAVIOR_WINDOW_MS): BehaviorMetrics {
    const recent = this.changes.filter(
      (change) => now - change.observedAt <= windowMs,
    )
    let spacingOk = true
    let mediaAdvanced = true
    for (let i = 1; i < recent.length; i += 1) {
      if (
        recent[i].observedAt - recent[i - 1].observedAt <
        MIN_CHANGE_SPACING_MS
      ) {
        spacingOk = false
      }
      if (recent[i].mediaTime <= recent[i - 1].mediaTime) {
        mediaAdvanced = false
      }
    }
    // Tek değişim varsa medya ilerleme kanıtı ilk örnekten gelir; ayrıca
    // ikinci değişim koşulu aranacağı için burada yalnızca aralık denetlenir.
    return {
      changeCount: recent.length,
      withinWindow: recent.length === this.changes.length,
      spacingOk,
      mediaAdvanced,
    }
  }

  public updateBestScore(score: number): number {
    this.bestScore = Math.max(this.bestScore, score)
    return this.bestScore
  }

  public getBestScore(): number {
    return this.bestScore
  }

  public get lastSample(): BehaviorSample | null {
    return this.samples[this.samples.length - 1] ?? null
  }

  public get lastNonEmptyText(): string {
    for (let i = this.samples.length - 1; i >= 0; i -= 1) {
      if (this.samples[i].text) return this.samples[i].text
    }
    return ''
  }

  /** İleri/geri sarma sonrası davranış kanıtı sıfırlanır. */
  public reset(): void {
    this.samples = []
    this.changes = []
    this.bestScore = 0
  }
}

export interface ConnectionInput {
  score: number
  kind: SourceKind
  hasText: boolean
  /** Aynı video için ikinci bağımsız adayın puanı (yoksa null). */
  secondIndependentScore: number | null
  changeCount: number
  changesWithinWindow: boolean
  changeSpacingOk: boolean
  mediaAdvanced: boolean
}

export interface ConnectionResult {
  ready: boolean
  reason: string
}

/**
 * Bağlanma koşulları. Eşik sağlanmazsa gözlem sürer; en iyi adaya zorla
 * bağlanılmaz.
 */
export function evaluateConnection(input: ConnectionInput): ConnectionResult {
  if (!input.hasText) {
    return { ready: false, reason: 'empty-current-line' }
  }
  if (input.score < CONNECT_THRESHOLD) {
    return { ready: false, reason: 'low-confidence' }
  }
  if (
    input.secondIndependentScore !== null &&
    input.score - input.secondIndependentScore < RIVAL_SCORE_GAP
  ) {
    return { ready: false, reason: 'ambiguous-second-candidate' }
  }

  if (input.kind === 'generic-dom') {
    const behaviorOk =
      input.changeCount >= 2 &&
      input.changesWithinWindow &&
      input.changeSpacingOk &&
      input.mediaAdvanced
    if (!behaviorOk) {
      return { ready: false, reason: 'insufficient-behavior-evidence' }
    }
  }

  return { ready: true, reason: 'verified' }
}



