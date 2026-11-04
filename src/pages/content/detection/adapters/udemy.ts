/**
 * Udemy (Shaka Player) oynatıcı adaptörü.
 *
 * Oynatıcı kapsayıcısı kararlı üst kapsayıcıdır; altyazı kapsayıcısı yeniden
 * oluşturulsa bile kaynak kimliği korunur. Transkript ve menüler kaynak kabul
 * edilmez.
 *
 * Udemy altyazıyı videonun altında gösterebildiğinde blok oynatıcı kökünün
 * dışında veya içinde, videoya yerel bir kapsayıcı içinde durur. Bu blok
 * yalnızca video altı geometrisi doğrulandığında video altı yerleşim hedefi
 * olur.
 */

import { AdapterCandidate, AdapterContext } from './types'
import { buildDomEvidence, findPlayerRoot, hostEndsWith } from './utils'
import {
  classTokens,
  getElementRect,
  horizontalOverlapRatio,
  UDEMY_MAX_LOCAL_CONTAINER_AREA_RATIO,
  isBelowVideoRelation,
  isExcludedTextElement,
  isOwnUiElement,
  isStyleVisible,
  normalizeComparableText,
  readVisibleText,
  rectArea,
  sharesPlayerContainer,
  textLines,
} from '../text'

/**
 * Udemy'nin video altı "well" altyazı bloğunun CSS-module taban adı.
 *
 * Derleme başına değişen hash son eki (ör. `9Y7tq`) sabitlenmez; yalnızca
 * kararlı taban ad eşleşir. Gerçek DOM'da blokta data-purpose yoktur ve metin
 * ayrı bir `well-module--text--<hash>` span'ındadır.
 */
const WELL_CAPTION_BASE = 'well-module--container--'
const WELL_CAPTION_SELECTOR = `[class*='${WELL_CAPTION_BASE}']`
const WELL_TEXT_BASE = 'well-module--text--'
/**
 * Well kabuğu genel bir bileşen olabilir (duyuru/Q&A). Yalnız cue metnini
 * taşıyan span'ı olan well'ler altyazı kaynağı sayılır.
 */
const WELL_CUE_TEXT_SELECTOR = [
  `[class*='${WELL_TEXT_BASE}']`,
  '[data-purpose="captions-cue-text"]',
  '[data-purpose="captions-cue"]',
].join(',')

/**
 * Udemy dış yerleşim satırı. Hash son eki değişebilir; yalnız taban ad
 * sabitlenir. Well anchor'ı bu satırın torunudur, satır da content column'un
 * doğrudan çocuğudur.
 */
const APP_BODY_ROW_BASE = 'app--body-container--'
const APP_CONTENT_COLUMN_BASE = 'app--content-column--'
/** Anchor'dan dış satıra kadar izin verilen en fazla ata adımı. */
const MAX_MOUNT_ANCESTORS = 16

/** Oynatıcı kökü içinde güvenilen, kararlı altyazı seçicileri. */
const INSIDE_CAPTION_SELECTORS = [
  '.shaka-text-container',
  '.shaka-text-wrapper',
  '[data-purpose="captions-cue"]',
  '[data-purpose="captions-cue-text"]',
]

/**
 * Video çevresindeki yerel kapsayıcılarda aranan seçiciler. Kararlı
 * data-purpose nitelikleri sınıf adlarından önce gelir. Well bloğu oynatıcı
 * kökünün içinde de bulunabildiği için bu liste tek başına "dış" değildir;
 * konum kararı geometriyle verilir.
 */
const EXTERNAL_CAPTION_SELECTORS = [
  // Udemy'nin güncel video altı bloğu data-purpose taşımaz; hash'li CSS-module
  // sınıfı tek kararlı işarettir. Aday öğe dar metin span'ı değil bu bloktur.
  WELL_CAPTION_SELECTOR,
  // Kararlı data-purpose nitelikleri sınıf adlarından önce gelir. Geniş
  // [data-purpose*="caption"] / [class*="caption"] seçicileri ayar menüsü,
  // düğme veya etiketleri altyazı sanabildiği için kullanılmaz.
  '[data-purpose="captions-display"]',
  '[data-purpose="captions"]',
  '[data-purpose="subtitle"]',
  '[data-purpose="subtitles"]',
  ...INSIDE_CAPTION_SELECTORS,
  '.captions-display',
  '.udemy-captions',
]

/** Sınıf listesinde verilen taban adı taşıyan bir token var mı? */
function hasClassTokenPrefix(el: Element | null, prefix: string): boolean {
  if (!el) return false
  const normalized = prefix.toLowerCase()
  return classTokens(el).some((token) => token.startsWith(normalized))
}

/** Sınıf listesinde kararlı well blok taban adını taşıyor mu? */
function isWellCaptionContainer(el: Element): boolean {
  return hasClassTokenPrefix(el, WELL_CAPTION_BASE)
}

/** Well gerçekten cue metni taşıyan bir span içeriyor mu? */
function hasWellCaptionText(el: HTMLElement): boolean {
  try {
    const text = el.querySelector(WELL_CUE_TEXT_SELECTOR)
    return !!text && !isOwnUiElement(text)
  } catch {
    return false
  }
}

/** Dış aramada bakılan en fazla üst kapsayıcı sayısı. */
const MAX_EXTERNAL_ANCESTORS = 6
/** Dış arama sonucunun (negatif dahil) kısa süreli önbelleği. */
const EXTERNAL_SCAN_CACHE_MS = 300

interface CaptionChoice {
  element: HTMLElement
  belowVideo: boolean
  selectorPriority: number
  depth: number
  order: number
  overlap: number
  gap: number
}

export interface ResolvedCaption {
  element: HTMLElement
  belowVideo: boolean
  /**
   * Well kaynakları için güvenli dış ekleme noktası. `null` güvenli hedef
   * yok; `undefined` legacy anchor-sonrası davranışı.
   */
  mountAfter?: HTMLElement | null
}

export class UdemyAdapter {
  /**
   * Aynı video için son geçerli seçim; cue aralığında floating/below
   * arasında gidip gelmeyi engeller. WeakMap anahtarı video öğesidir, böylece
   * kaldırılan videoların girdileri çöp toplamaya bırakılır.
   */
  private lastChoices = new WeakMap<HTMLVideoElement, ResolvedCaption>()

  /** Dış blok aramasının negatif sonuçları dahil kısa süreli önbelleği. */
  private externalChoices = new WeakMap<
    HTMLVideoElement,
    { choice: CaptionChoice | null; checkedAt: number }
  >()

  public static matches(hostname: string): boolean {
    return hostEndsWith(hostname, 'udemy.com')
  }

  public reset(): void {
    this.lastChoices = new WeakMap<HTMLVideoElement, ResolvedCaption>()
    this.externalChoices = new WeakMap<
      HTMLVideoElement,
      { choice: CaptionChoice | null; checkedAt: number }
    >()
  }

  public getCandidate(context: AdapterContext): AdapterCandidate | null {
    const { entry } = context
    if (!entry.visible) return null

    const resolved = this.resolvePresentationTarget(context)
    if (!resolved) return null

    const { element, belowVideo, mountAfter } = resolved
    const text = readVisibleText(element, { win: context.window })
    const lines = textLines(text)
    const rect = getElementRect(element) || entry.rect
    const sourceId = `player:udemy:${entry.id}:captions`
    const videoRect = entry.rect || getElementRect(entry.video)

    return {
      sourceId,
      kind: 'player-dom',
      videoId: entry.id,
      element,
      text,
      lines,
      rect,
      evidence: buildDomEvidence(entry, element, text, lines, rect, {
        // Video dışı blok "doğrulanmış oynatıcı kapsayıcısı" sayılmaz.
        verifiedPlayerContainer: !belowVideo,
        verifiedCaptionBlock: belowVideo,
        sharesPlayerContainer: belowVideo
          ? sharesPlayerContainer(
              entry.video,
              element,
              videoRect,
              UDEMY_MAX_LOCAL_CONTAINER_AREA_RATIO,
            )
          : true,
        verifiedBelowVideoRelation: belowVideo,
        forceHint: true,
      }),
      presentation: {
        mode: belowVideo ? 'below-caption' : 'floating',
        anchor: belowVideo ? element : null,
        mountAfter: belowVideo ? mountAfter : undefined,
      },
      reason: belowVideo
        ? 'udemy verified below-video caption block'
        : 'udemy shaka caption container',
    }
  }

  /**
   * Text kaynağından bağımsız yerleşim hedefi. Player-dom adayı ve native
   * text-track yolu aynı seçim/cache mantığını kullanır.
   */
  public resolvePresentationTarget(
    context: AdapterContext,
  ): ResolvedCaption | null {
    const { entry } = context
    if (!entry.visible) return null
    const playerRoot = findPlayerRoot(entry.video)
    if (!playerRoot || !playerRoot.contains(entry.video)) return null
    return this.resolveCaption(playerRoot, context)
  }

  /**
   * Native text-track kaynağı seçiliyken aynı videonun doğrulanmış video altı
   * DOM hedefini çözer. Video içi altyazıda null döner (floating).
   */
  public resolveBelowVideoLayout(
    context: AdapterContext,
  ): ResolvedCaption | null {
    const resolved = this.resolvePresentationTarget(context)
    return resolved?.belowVideo ? resolved : null
  }

  private resolveCaption(
    playerRoot: HTMLElement,
    context: AdapterContext,
  ): ResolvedCaption | null {
    // Önceki seçim hâlâ geçerliyse korunur. Böylece cue arasında kısa metin
    // boşlukları mod değişimine (floating <-> below) yol açmaz.
    const previous = this.lastChoices.get(context.entry.video)
    if (previous && this.isChoiceValid(previous, playerRoot, context)) {
      if (!previous.belowVideo) {
        // Video içi seçim korunur; ancak doğrulanmış video altı blok
        // görünürse aynı tercih sırasıyla ona yükseltilir.
        const external = this.getExternalChoice(playerRoot, context)
        if (external) {
          const resolved = this.withMountAfter(
            { element: external.element, belowVideo: true },
            context,
          )
          this.lastChoices.set(context.entry.video, resolved)
          return resolved
        }
      } else {
        // Dış satır yeniden oluşturulmuş olabilir; anchor kimliği değişmese
        // bile mount hedefi tazelenir.
        const refreshed = this.withMountAfter(previous, context)
        if (refreshed.mountAfter !== previous.mountAfter) {
          this.lastChoices.set(context.entry.video, refreshed)
          return refreshed
        }
      }
      return previous
    }

    const resolved = this.resolveFreshCaption(playerRoot, context)
    if (!resolved) {
      this.lastChoices.delete(context.entry.video)
      return null
    }
    this.lastChoices.set(context.entry.video, resolved)
    return resolved
  }

  private resolveFreshCaption(
    playerRoot: HTMLElement,
    context: AdapterContext,
  ): ResolvedCaption | null {
    // Tek tercih sırası: doğrulanmış video altı blok, video içi metinli
    // kapsayıcıdan önce gelir. resolveCaption'daki yükseltme yolu da aynı
    // sırayı kullanır; böylece ilk seçim ile sonraki seçim çelişmez.
    const external = this.getExternalChoice(playerRoot, context)
    if (external) {
      return this.withMountAfter(
        { element: external.element, belowVideo: true },
        context,
      )
    }

    const inside = this.collectInside(playerRoot, context)
    const insideWithText = this.pickInside(inside, context, true)
    if (insideWithText) {
      return { element: insideWithText.element, belowVideo: false }
    }

    const insideWithoutText = this.pickInside(inside, context, false)
    if (insideWithoutText) {
      return { element: insideWithoutText.element, belowVideo: false }
    }
    return null
  }

  /** Below seçime mountAfter sözleşmesini ekler. */
  private withMountAfter(
    resolved: ResolvedCaption,
    context: AdapterContext,
  ): ResolvedCaption {
    if (!resolved.belowVideo) return resolved
    if (
      resolved.mountAfter instanceof HTMLElement &&
      this.isValidMountRow(resolved.mountAfter, resolved.element, context)
    ) {
      // Önceki hedef hâlâ geçerliyse 16 ata + getComputedStyle yürüyüşü
      // tekrarlanmaz.
      return resolved
    }
    return {
      ...resolved,
      mountAfter: this.resolveMountAfter(resolved.element, context),
    }
  }

  /**
   * Well anchor'ın güvenli dış ekleme noktasını bulur.
   *
   * Well olmayan eski bloklar `undefined` (anchor-sonrası legacy davranış)
   * döndürür. Well için en yakın geçerli `app--body-container--*` atası
   * doğrulanır; geçici geçersiz en yakın satır daha dıştaki adayları
   * engellemez. Sayfa genelinde arama yoktur.
   */
  private resolveMountAfter(
    anchor: HTMLElement,
    context: AdapterContext,
  ): HTMLElement | null | undefined {
    if (!isWellCaptionContainer(anchor)) return undefined

    let current: HTMLElement | null = anchor.parentElement
    let depth = 0
    while (current && depth < MAX_MOUNT_ANCESTORS) {
      if (hasClassTokenPrefix(current, APP_BODY_ROW_BASE)) {
        if (this.isValidMountRow(current, anchor, context)) return current
      }
      current = current.parentElement
      depth += 1
    }
    return null
  }

  /**
   * Dedektörün native cache kullanımı için dış satır doğrulaması. Bulma,
   * önceki seçim ve önbellek aynı yapısal kuralları kullanır.
   */
  public isValidMountTarget(
    row: HTMLElement,
    anchor: HTMLElement,
    context: AdapterContext,
  ): boolean {
    return this.isValidMountRow(row, anchor, context)
  }

  /** Dış satır gerçekten aynı videoyu/anchor'ı kapsayan content-column çocuğu mu? */
  private isValidMountRow(
    row: HTMLElement,
    anchor: HTMLElement,
    context: AdapterContext,
  ): boolean {
    const { entry } = context
    if (row.ownerDocument !== entry.video.ownerDocument) return false
    if (!row.isConnected || !row.parentElement) return false
    if (!row.contains(entry.video) || !row.contains(anchor)) return false
    if (!hasClassTokenPrefix(row.parentElement, APP_CONTENT_COLUMN_BASE)) {
      return false
    }
    if (isOwnUiElement(row)) return false
    return isStyleVisible(row, context.window)
  }

  /**
   * Dış blok araması negatif sonuçla birlikte kısa süre önbelleklenir; cue
   * aralıklarında her evaluation'da tam subtree taraması yapılmaz.
   */
  private getExternalChoice(
    playerRoot: HTMLElement,
    context: AdapterContext,
  ): CaptionChoice | null {
    const video = context.entry.video
    const cached = this.externalChoices.get(video)
    if (cached && context.now - cached.checkedAt < EXTERNAL_SCAN_CACHE_MS) {
      if (!cached.choice) return null
      // Önbellekteki seçim, ilk bulmayla aynı koşullardan geçer: bağlı,
      // görünür, video altı geometrili ve yerel kapsayıcı içinde olmalı.
      // Oynatıcı kökünün içinde olması tek başına geçersiz kılmaz.
      if (this.isValidBelowCaption(cached.choice.element, context)) {
        return cached.choice
      }
    }

    const choice = this.pickExternal(
      this.collectExternal(playerRoot, context),
    )
    this.externalChoices.set(video, { choice, checkedAt: context.now })
    return choice
  }

  private isChoiceValid(
    choice: ResolvedCaption,
    playerRoot: HTMLElement,
    context: AdapterContext,
  ): boolean {
    const element = choice.element

    if (!choice.belowVideo) {
      if (!element.isConnected) return false
      if (!isStyleVisible(element, context.window)) return false
      if (isExcludedTextElement(element) || isOwnUiElement(element)) return false
      return playerRoot.contains(element) && element !== context.entry.video
    }

    // Video altı blok oynatıcı kökünün içinde yalnızca well bloğu olabilir
    // (collect yoluyla tutarlı); diğer seçiciler video içi yolda kalır.
    if (playerRoot.contains(element) && !isWellCaptionContainer(element)) {
      return false
    }
    return this.isValidBelowCaption(element, context)
  }

  /**
   * Video altı altyazı bloğunun ortak doğrulaması. Bulma, önceki seçimi
   * koruma ve önbellek doğrulaması aynı koşulları kullanır.
   */
  private isValidBelowCaption(
    element: HTMLElement,
    context: AdapterContext,
  ): boolean {
    if (!this.isUsableCaptionElement(element, context)) return false
    if (isWellCaptionContainer(element) && !hasWellCaptionText(element)) {
      return false
    }
    return this.hasValidBelowGeometry(element, context)
  }

  /** Yalnız geometri kontrolü; legacy seçicide eşleşen öğe ayrıca doğrulanır. */
  private hasValidBelowGeometry(
    element: HTMLElement,
    context: AdapterContext,
  ): boolean {
    const videoRect = context.entry.rect || getElementRect(context.entry.video)
    const rect = getElementRect(element)
    if (!isBelowVideoRelation(rect, videoRect)) return false
    return sharesPlayerContainer(
      context.entry.video,
      element,
      videoRect,
      UDEMY_MAX_LOCAL_CONTAINER_AREA_RATIO,
    )
  }

  private collectInside(
    playerRoot: HTMLElement,
    context: AdapterContext,
  ): CaptionChoice[] {
    const choices: CaptionChoice[] = []
    const seen = new Set<Element>()
    let order = 0

    INSIDE_CAPTION_SELECTORS.forEach((selector, priority) => {
      for (const el of this.query(playerRoot, selector)) {
        if (seen.has(el)) continue
        seen.add(el)
        if (!this.isUsableCaptionElement(el, context)) continue
        choices.push({
          element: el,
          belowVideo: false,
          selectorPriority: priority,
          depth: this.depth(el, playerRoot),
          order,
          overlap: 1,
          gap: 0,
        })
        order += 1
      }
    })
    return choices
  }

  private collectExternal(
    playerRoot: HTMLElement,
    context: AdapterContext,
  ): CaptionChoice[] {
    const { entry } = context
    const videoRect = entry.rect || getElementRect(entry.video)
    const videoArea = rectArea(videoRect)
    if (!videoRect || videoArea <= 0) return []

    // En dıştaki uygun yerel kapsayıcı bulunur. İç kapsayıcılar onun alt
    // ağacında olduğundan tek bir sorgu yeterlidir; aynı subtree altı kez
    // taranmaz.
    let scanRoot: HTMLElement | null = null
    let current: HTMLElement | null = entry.video.parentElement
    let depth = 0
    while (current && depth < MAX_EXTERNAL_ANCESTORS) {
      const area = rectArea(getElementRect(current))
      // Genel sayfa taraması yapma: yalnızca videoya yakın yerel
      // kapsayıcılar. Geniş içerik kolonu/yan panel dışarıda kalır.
      if (
        area > 0 &&
        area <= videoArea * UDEMY_MAX_LOCAL_CONTAINER_AREA_RATIO
      ) {
        scanRoot = current
      }
      current = current.parentElement
      depth += 1
    }
    if (!scanRoot) return []

    const choices: CaptionChoice[] = []
    const seen = new Set<Element>()
    const seenBlocks = new Set<HTMLElement>()
    let order = 0

    EXTERNAL_CAPTION_SELECTORS.forEach((selector, priority) => {
      for (const el of this.query(scanRoot!, selector)) {
        // forEach callback'i içindeki for-of'ta return tüm seçiciyi iptal
        // ederdi; yalnızca bu öğe atlanmalı.
        if (seen.has(el)) continue
        seen.add(el)
        // Well bloğu oynatıcı kökünün içinde de olabilir; yalnızca bu blok
        // için erken eleme yapılmaz. Diğer seçiciler video içi yolda kalır.
        const wellContainer = isWellCaptionContainer(el)
        if (!wellContainer && playerRoot.contains(el)) continue
        if (!this.isUsableCaptionElement(el, context)) continue

        // Well bloğu zaten dış bloktur; metin span'ına değil bu öğeye
        // sabitlenir. Diğer seçicilerde geometri dar cue span'ında değil,
        // aynı metni taşıyan altyazı bloğunda ölçülür.
        const block = wellContainer
          ? el
          : this.climbToCaptionBlock(el, context, videoRect)
        if (seenBlocks.has(block)) continue
        seenBlocks.add(block)

        // Bulma, önceki seçim ve önbellek aynı doğrulamayı kullanır. Legacy
        // seçicide eşleşen öğe doğrulanır, geometri tırmanılan blokta ölçülür.
        if (wellContainer) {
          if (!this.isValidBelowCaption(block, context)) continue
        } else if (!this.hasValidBelowGeometry(block, context)) {
          continue
        }
        const rect = getElementRect(block)
        if (!rect) continue

        choices.push({
          element: block,
          belowVideo: true,
          selectorPriority: priority,
          depth: this.depth(block),
          order,
          overlap: horizontalOverlapRatio(rect, videoRect),
          gap: Math.max(0, rect.top - (videoRect.top + videoRect.height)),
        })
        order += 1
      }
    })

    return choices
  }

  /**
   * Cue span'ından aynı metni taşıyan blok kapsayıcıya çıkar. Böylece
   * geometri ve kardeş ekleme noktası dar span yerine altyazı bloğudur.
   */
  private climbToCaptionBlock(
    el: HTMLElement,
    context: AdapterContext,
    videoRect: ReturnType<typeof getElementRect>,
  ): HTMLElement {
    const text = normalizeComparableText(
      readVisibleText(el, { win: context.window }),
    )
    if (!text) return el

    const videoArea = rectArea(videoRect)
    let current = el
    let parent = el.parentElement
    let climb = 0
    while (parent && climb < 4) {
      const tag = parent.tagName.toLowerCase()
      if (tag === 'body' || tag === 'html') break
      if (parent === context.entry.video || parent.contains(context.entry.video)) {
        break
      }
      if (isExcludedTextElement(parent) || isOwnUiElement(parent)) break
      const parentRect = getElementRect(parent)
      if (!parentRect || rectArea(parentRect) <= 0) break
      if (
        videoArea > 0 &&
        rectArea(parentRect) >
          videoArea * UDEMY_MAX_LOCAL_CONTAINER_AREA_RATIO
      ) {
        break
      }
      const parentText = normalizeComparableText(
        readVisibleText(parent, { win: context.window }),
      )
      if (!parentText || parentText !== text) break
      current = parent
      parent = parent.parentElement
      climb += 1
    }
    return current
  }

  private pickInside(
    choices: CaptionChoice[],
    context: AdapterContext,
    requireText: boolean,
  ): CaptionChoice | null {
    const candidates = choices.filter((choice) => {
      if (!requireText) return true
      return readVisibleText(choice.element, { win: context.window }).length > 0
    })
    if (!candidates.length) return null
    candidates.sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth
      if (a.selectorPriority !== b.selectorPriority) {
        return a.selectorPriority - b.selectorPriority
      }
      return a.order - b.order
    })
    return candidates[0]
  }

  private pickExternal(choices: CaptionChoice[]): CaptionChoice | null {
    if (!choices.length) return null

    // İç içe altyazı öğeleri tek kaynağa indirgenir: dıştaki blok seçilir.
    const outermost = choices.filter(
      (choice) =>
        !choices.some(
          (other) => other !== choice && other.element.contains(choice.element),
        ),
    )
    const candidates = outermost.length ? outermost : choices
    candidates.sort((a, b) => {
      if (a.selectorPriority !== b.selectorPriority) {
        return a.selectorPriority - b.selectorPriority
      }
      if (a.overlap !== b.overlap) return b.overlap - a.overlap
      if (a.gap !== b.gap) return a.gap - b.gap
      if (a.depth !== b.depth) return a.depth - b.depth
      return a.order - b.order
    })
    return candidates[0]
  }

  private isUsableCaptionElement(
    el: Element,
    context: AdapterContext,
  ): el is HTMLElement {
    if (!el || !el.tagName) return false
    if (el === context.entry.video || el.contains(context.entry.video)) {
      return false
    }
    if (!el.isConnected) return false
    if (!isStyleVisible(el, context.window)) return false
    if (isExcludedTextElement(el)) return false
    if (isOwnUiElement(el)) return false
    const rect = getElementRect(el)
    if (rect && rectArea(rect) <= 0) return false
    return true
  }

  private query(root: ParentNode, selector: string): HTMLElement[] {
    let found: NodeListOf<Element>
    try {
      found = root.querySelectorAll(selector)
    } catch {
      return []
    }
    return Array.from(found) as HTMLElement[]
  }

  private depth(el: Element, boundary: Element | null = null): number {
    let depth = 0
    let current: Element | null = el
    while (current && current !== boundary) {
      depth += 1
      current = current.parentElement
    }
    return depth
  }
}
