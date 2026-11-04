/**
 * DOM metin okuma ve aday gruplama yardımcıları.
 *
 * Kurallar:
 *  - Yalnızca görünür metin düğümleri okunur.
 *  - Menü, düğme, zaman sayacı, form alanı ve eklenti arayüzü dışlanır.
 *  - DOM sırası korunur; <br> ve blok sınırları satır olarak tutulur.
 *  - Aynı içeriğin üst/alt öğe olarak tekrar okunması engellenir.
 */

import { Rect } from '../../../types/detection'

const OWN_UI_IDS = new Set([
  'udemy-translate-floating-subtitle',
  'subtitle-position-menu',
])

const HARD_EXCLUDE_TOKENS = [
  'transcript',
  'caption-menu',
  'settings',
  'settings-menu',
  'settingsmenu',
  'overflow-menu',
  'overlay-menu',
  'context-menu',
  'contextmenu',
  'dropdown-menu',
  'chat',
  'comment',
  'comments',
  'toolbar',
  'control-bar',
  'controlbar',
  'controls-container',
  'controlscontainer',
  'progress-bar',
  'progressbar',
  'time-display',
  'timedisplay',
  'current-time',
  'duration-display',
  'sidebar',
  'navigation',
  'cookie',
  'consent',
  'advertisement',
  'ad-banner',
  'adbanner',
  'promo-banner',
  'header',
  'footer',
  'menu',
]

/**
 * Udemy Q&A/transcript benzeri bölüm kabukları. Alt dize eşleşmesi
 * ("question" -> "questionnaire") gerçek altyazıları dışlamasın diye yalnızca
 * tam sözcük olarak aranır. Video içeren bir kabuk (ör. ders içerik kolonu)
 * altyazıyı dışlamaz; oynatıcı o kabuğun içinde kalabilir.
 */
const SECTION_EXCLUDE_TOKENS = [
  'question',
  'q&a',
  'qa-section',
  'discussion',
  'course-content',
  'curriculum',
]

const SECTION_EXCLUDE_RE = new RegExp(
  `(?:^|[^a-z0-9])(?:${SECTION_EXCLUDE_TOKENS.map((token) =>
    token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ).join('|')})(?=[^a-z0-9]|$)`,
  'i',
)

function hasSectionExcludeToken(el: Element): boolean {
  return SECTION_EXCLUDE_RE.test(elementTokens(el))
}

function containsVideo(el: Element): boolean {
  try {
    return !!el.querySelector('video')
  } catch {
    return false
  }
}

const INTERACTIVE_SELECTOR = [
  'button',
  'input',
  'select',
  'textarea',
  'option',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="slider"]',
  '[role="switch"]',
  '[contenteditable="true"]',
].join(',')

const MENU_ROLE_SELECTOR =
  '[role="menu"],[role="menuitem"],[role="dialog"],[role="tablist"]'

const SUBTITLE_HINT_RE =
  /caption|subtitle|cue|timedtext|shaka-text|ytp-caption|text-track|subtitles/i

export function getWindow(el: Node | null): Window | null {
  if (!el) return null
  const doc = el.nodeType === 9 ? (el as Document) : el.ownerDocument
  return doc?.defaultView ?? (typeof window !== 'undefined' ? window : null)
}

export function normalizeComparableText(raw: string | null | undefined): string {
  return (raw || '').replace(/\s+/g, ' ').trim()
}

export function textLines(text: string): string[] {
  return (text || '')
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
}

export function isOwnUiElement(el: Element): boolean {
  let current: Element | null = el
  let depth = 0
  while (current && depth < 12) {
    if (OWN_UI_IDS.has(current.id)) return true
    if (
      current.hasAttribute &&
      current.hasAttribute('data-subtitle-translator-ui')
    ) {
      return true
    }
    const className =
      typeof current.className === 'string' ? current.className : ''
    if (
      className.includes('udemy-translate-floating-subtitle') ||
      className.includes('subtitle-position-menu')
    ) {
      return true
    }
    current = current.parentElement
    depth += 1
  }
  return false
}

export function classTokens(el: Element): string[] {
  const className =
    typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '')
  return className
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
}

/** CSS-module görünüm sınıfı: no-sidebar bir sidebar kanıtı değildir. */
const NO_SIDEBAR_TOKEN_RE = /(?:^|[-_])no[-_]sidebar(?=--|$)/g

function isNoSidebarClassToken(token: string): boolean {
  // Yalnız gerçek no-sidebar sınırları muaf. Token içinde kalan başka bir
  // "sidebar" sözcüğü (ör. sidebar-panel--no-sidebar--x) muafiyeti kaldırır.
  const remainder = token.replace(NO_SIDEBAR_TOKEN_RE, '')
  return !remainder.includes('sidebar')
}

/**
 * Gerçek sidebar/sidebar-panel kanıtı yalnız sınıf token'larında ayrı ayrı
 * değerlendirilir. `no-sidebar` istisnası sınıf token'ına özeldir; id, role,
 * aria-label veya data-* niteliklerindeki sidebar işareti dışlamayı sürdürür.
 */
function hasSidebarExclusion(el: Element): boolean {
  const classes = classTokens(el)
  if (
    classes.some(
      (token) => token.includes('sidebar') && !isNoSidebarClassToken(token),
    )
  ) {
    return true
  }
  const otherTokens = [
    el.id || '',
    el.getAttribute('role') || '',
    el.getAttribute('aria-label') || '',
    el.getAttribute('data-purpose') || '',
    el.getAttribute('data-testid') || '',
    el.tagName || '',
  ]
    .join(' ')
    .toLowerCase()
  return otherTokens.includes('sidebar')
}

function elementTokens(el: Element): string {
  return [
    classTokens(el).join(' '),
    el.id || '',
    el.getAttribute('role') || '',
    el.getAttribute('aria-label') || '',
    el.getAttribute('data-purpose') || '',
    el.getAttribute('data-testid') || '',
    el.tagName || '',
  ]
    .join(' ')
    .toLowerCase()
}

/** Eklenti arayüzü, etkileşimli kontrol, menü, transkript ve sohbet dışlanır. */
export function isExcludedTextElement(el: Element): boolean {
  if (!el || !el.tagName) return true
  if (isOwnUiElement(el)) return true

  const tag = el.tagName.toLowerCase()
  if (
    tag === 'script' ||
    tag === 'style' ||
    tag === 'noscript' ||
    tag === 'template' ||
    tag === 'head' ||
    tag === 'title' ||
    tag === 'meta' ||
    tag === 'link' ||
    tag === 'svg' ||
    tag === 'canvas'
  ) {
    return true
  }

  if (el.closest(INTERACTIVE_SELECTOR)) return true
  if (el.closest(MENU_ROLE_SELECTOR)) return true

  let current: Element | null = el
  let depth = 0
  while (current && depth < 10) {
    const tokens = elementTokens(current)
    // Sidebar ayrı değerlendirilir: `no-sidebar` sınıfı gerçek sidebar
    // kanıtı sayılmaz, diğer hard-exclude işaretleri aynen sürer.
    if (
      HARD_EXCLUDE_TOKENS.some(
        (token) => token !== 'sidebar' && tokens.includes(token),
      )
    ) {
      return true
    }
    if (hasSidebarExclusion(current)) return true
    // Q&A/curriculum gibi bölüm kabukları yalnızca videoyu içermiyorsa
    // dışlanır. Ders sayfasının tamamını saran course-content gerçek
    // altyazıyı yutmasın.
    if (
      hasSectionExcludeToken(current) &&
      !containsVideo(current)
    ) {
      return true
    }
    current = current.parentElement
    depth += 1
  }
  return false
}

/** Görünürlük: hesaplanmış stil ve gizleme nitelikleri (geometri değil). */
export function isStyleVisible(el: Element, win?: Window | null): boolean {
  if (!el || !el.isConnected) return false
  const view = win ?? getWindow(el)
  if (!view?.getComputedStyle) return true

  let current: Element | null = el
  let depth = 0
  while (current && depth < 8) {
    if (current.hasAttribute('hidden')) return false
    if (current.getAttribute('aria-hidden') === 'true') return false
    try {
      const style = view.getComputedStyle(current)
      if (!style) break
      if (style.display === 'none') return false
      if (style.visibility === 'hidden' || style.visibility === 'collapse') {
        return false
      }
      if (style.opacity !== '' && Number(style.opacity) === 0) return false
      if ((style as any).contentVisibility === 'hidden') return false
    } catch {
      // getComputedStyle bazı detached düğümlerde hata verebilir.
    }
    current = current.parentElement
    depth += 1
  }
  return true
}

const BLOCK_DISPLAYS = new Set([
  'block',
  'flex',
  'grid',
  'list-item',
  'table',
  'table-row',
  'flow-root',
])

interface ReadOptions {
  win?: Window | null
  maxNodes?: number
}

/**
 * Bir öğenin görünür metnini DOM sırasıyla okur.
 * HTML olarak yorumlanmaz; çeviri kutusuna düz metin olarak aktarılır.
 */
export function readVisibleText(
  element: Element | null,
  options: ReadOptions = {},
): string {
  if (!element) return ''
  const win = options.win ?? getWindow(element)
  if (!isStyleVisible(element, win)) return ''
  // Eklenti kendi arayüz metnini hiçbir zaman altyazı metnine katmaz.
  if (isOwnUiElement(element)) return ''
  if (isExcludedTextElement(element)) return ''

  const parts: string[] = []
  let visited = 0
  const maxNodes = options.maxNodes ?? 800

  const visit = (node: Node): void => {
    if (visited > maxNodes) return
    visited += 1

    if (node.nodeType === 3) {
      const parent = node.parentElement
      if (
        parent &&
        (isOwnUiElement(parent) ||
          isExcludedTextElement(parent) ||
          !isStyleVisible(parent, win))
      ) {
        return
      }
      // Kaynak HTML'deki girinti satır sonu üretmemeli; yalnızca <br> ve blok
      // sınırları satır olarak korunur.
      const value = (node.nodeValue || '').replace(/\s+/g, ' ')
      if (value) parts.push(value)
      return
    }

    if (node.nodeType !== 1) return
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    if (tag === 'br') {
      parts.push('\n')
      return
    }
    if (isOwnUiElement(el)) return
    if (isExcludedTextElement(el)) return
    if (!isStyleVisible(el, win)) return

    let display = ''
    try {
      display = win?.getComputedStyle ? win.getComputedStyle(el).display : ''
    } catch {
      display = ''
    }
    const isBlock = BLOCK_DISPLAYS.has(display)
    const hasTextChild = el.childNodes.length > 0
    if (isBlock && hasTextChild && parts.length > 0) parts.push('\n')

    for (const child of Array.from(el.childNodes)) visit(child)

    if (isBlock && hasTextChild) parts.push('\n')
  }

  visit(element)

  return parts
    .join('')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function getElementRect(el: Element): Rect | null {
  try {
    const rect = el.getBoundingClientRect()
    if (!rect) return null
    const width = Math.max(0, rect.width || rect.right - rect.left)
    const height = Math.max(0, rect.height || rect.bottom - rect.top)
    return { left: rect.left || 0, top: rect.top || 0, width, height }
  } catch {
    return null
  }
}

export function rectArea(rect: Rect | null): number {
  if (!rect) return 0
  return Math.max(0, rect.width) * Math.max(0, rect.height)
}

export function intersectRects(a: Rect | null, b: Rect | null): Rect | null {
  if (!a || !b) return null
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.left + a.width, b.left + b.width)
  const bottom = Math.min(a.top + a.height, b.top + b.height)
  if (right <= left || bottom <= top) return null
  return { left, top, width: right - left, height: bottom - top }
}

export function intersectionArea(a: Rect | null, b: Rect | null): number {
  return rectArea(intersectRects(a, b))
}

export function intersectionRatio(a: Rect | null, b: Rect | null): number {
  const area = rectArea(a)
  if (!area) return 0
  return intersectionArea(a, b) / area
}

export function nearestCommonAncestor(
  a: Element | null,
  b: Element | null,
): Element | null {
  if (!a || !b) return null
  const ancestors = new Set<Element>()
  let current: Element | null = a
  let depth = 0
  while (current && depth < 40) {
    ancestors.add(current)
    current = current.parentElement
    depth += 1
  }
  current = b
  depth = 0
  while (current && depth < 40) {
    if (ancestors.has(current)) return current
    current = current.parentElement
    depth += 1
  }
  return null
}

export function hasSubtitleHint(el: Element): boolean {
  return SUBTITLE_HINT_RE.test(elementTokens(el))
}

function isStableClassToken(token: string): boolean {
  if (!token) return false
  if (token.length > 28) return false
  if (!/^[a-zA-Z_][\w-]*$/.test(token)) return false
  if (/^(active|open|show|shown|hide|hidden|visible|selected|current|playing|paused|ended|js-)/.test(token)) {
    return false
  }
  // Uzun hash benzeri parçalar (örn. "css-1x2y3z", "a8f3b2c1") elenir.
  if (/^[a-z]{0,3}[0-9a-f]{6,}$/i.test(token)) return false
  return true
}

/**
 * Kaynak öğe yeniden oluşturulsa bile aynı yapısal yuvayı temsil eden
 * kararlı bir anahtar üretir.
 */
export function candidateKey(el: Element, scopeRoot?: Element | null): string {
  const parts: string[] = []
  let current: Element | null = el
  let depth = 0
  while (current && depth < 8) {
    const tag = current.tagName.toLowerCase()
    let part = tag
    if (current.id) {
      part += `#${current.id}`
      parts.unshift(part)
      break
    }
    const className =
      typeof current.className === 'string' ? current.className : ''
    const classes = className
      .trim()
      .split(/\s+/)
      .filter(isStableClassToken)
      .slice(0, 2)
    if (classes.length) part += `.${classes.join('.')}`
    const parent: Element | null = current.parentElement
    if (parent) {
      const sameTag = Array.from(parent.children).filter(
        (child) => child.tagName === current!.tagName,
      )
      if (sameTag.length > 1) {
        part += `:nth-of-type(${sameTag.indexOf(current) + 1})`
      }
    }
    parts.unshift(part)
    if (scopeRoot && parent === scopeRoot) break
    current = parent
    depth += 1
  }
  return parts.join('>')
}

export interface TextCandidateGroup {
  element: Element
  text: string
  lines: string[]
  rect: Rect | null
  key: string
}

export interface CollectTextOptions {
  video?: HTMLVideoElement | null
  videoRect?: Rect | null
  win?: Window | null
  maxCandidates?: number
  maxNodes?: number
}

interface CandidateNode {
  element: Element
  text: string
  lines: string[]
  rect: Rect | null
  depth: number
}

function elementDepth(el: Element, boundary: Element | null): number {
  let depth = 0
  let current: Element | null = el
  while (current && current !== boundary) {
    depth += 1
    current = current.parentElement
  }
  return depth
}

/**
 * Bir kök içindeki metin kapsayıcılarını aday gruplarına indirger.
 * Aynı metin ağacının üst/alt öğeleri tek adaydır; bağımsız kapsayıcılar
 * birleştirilmez.
 */
export function collectTextCandidates(
  root: Document | ShadowRoot | Element,
  options: CollectTextOptions = {},
): TextCandidateGroup[] {
  const win = options.win ?? (typeof window !== 'undefined' ? window : null)
  const doc =
    root.nodeType === 9
      ? (root as Document)
      : ((root as Element | ShadowRoot).ownerDocument as Document)
  if (!doc) return []

  const walkRoot: Element | null =
    root.nodeType === 9
      ? doc.body || doc.documentElement
      : root.nodeType === 11
        ? ((root as ShadowRoot).firstElementChild as Element | null)
        : (root as Element)
  if (!walkRoot) return []

  const boundary = root.nodeType === 1 ? (root as Element) : null
  const video = options.video ?? null
  const videoRect = options.videoRect ?? (video ? getElementRect(video) : null)
  const maxCandidates = options.maxCandidates ?? 100
  const maxNodes = options.maxNodes ?? 4000

  const nodes: CandidateNode[] = []
  let visited = 0
  let walker: TreeWalker
  try {
    walker = doc.createTreeWalker(walkRoot, 1, null)
  } catch {
    return []
  }

  let node: Node | null = walker.currentNode
  while (node && visited < maxNodes && nodes.length < maxCandidates * 3) {
    visited += 1
    const el = node as Element
    if (el !== walkRoot && el.nodeType === 1) {
      if (video && (el === video || el.contains(video))) {
        // Video'yu içeren oynatıcı kökü aday değildir; alt öğelere devam.
      } else {
        const quickText = (el.textContent || '').trim()
        if (quickText && quickText.length <= 600) {
          const rect = getElementRect(el)
          const overlapsVideo =
            !videoRect || (rect ? intersectionArea(rect, videoRect) > 0 : true)
          if (overlapsVideo && isStyleVisible(el, win) && !isExcludedTextElement(el)) {
            const text = readVisibleText(el, { win })
            if (text) {
              const lines = textLines(text)
              if (lines.length) {
                nodes.push({
                  element: el,
                  text,
                  lines,
                  rect,
                  depth: elementDepth(el, boundary),
                })
              }
            }
          }
        }
      }
    }
    node = walker.nextNode()
  }

  const normalized = nodes.map((n) => normalizeComparableText(n.text))
  const reps: CandidateNode[] = []

  for (let i = 0; i < nodes.length; i += 1) {
    const current = nodes[i]
    let rep = current
    let parent: Element | null = current.element.parentElement
    let climb = 0
    while (
      parent &&
      parent !== boundary &&
      parent !== walkRoot &&
      climb < 6 &&
      !isExcludedTextElement(parent) &&
      !(video && parent.contains(video)) &&
      isStyleVisible(parent, win)
    ) {
      const parentText = readVisibleText(parent, { win })
      if (normalizeComparableText(parentText) !== normalized[i]) break
      if (!parentText) break
      rep = {
        element: parent,
        text: parentText,
        lines: textLines(parentText),
        rect: getElementRect(parent),
        depth: elementDepth(parent, boundary),
      }
      parent = parent.parentElement
      climb += 1
    }
    if (
      !reps.some(
        (existing) =>
          existing.element === rep.element &&
          normalizeComparableText(existing.text) ===
            normalizeComparableText(rep.text),
      )
    ) {
      reps.push(rep)
    }
  }

  // Üst kapsayıcı aynı metin ağacını içeriyorsa alt adayı ele.
  const kept: CandidateNode[] = []
  reps.sort((a, b) => a.depth - b.depth)
  for (const rep of reps) {
    const repText = normalizeComparableText(rep.text)
    const absorbed = kept.some((parent) => {
      if (!parent.element.contains(rep.element)) return false
      const parentText = normalizeComparableText(parent.text)
      return parentText.includes(repText)
    })
    if (!absorbed) kept.push(rep)
  }

  return kept
    .slice(0, maxCandidates)
    .map((rep) => ({
      element: rep.element,
      text: rep.text,
      lines: rep.lines,
      rect: rep.rect,
      key: candidateKey(rep.element, boundary),
    }))
}

/**
 * Udemy video altı bloğu için video ile yerel ortak kapsayıcının alan üst
 * sınırı. Geniş içerik kolonu, yan panel veya Q&A bölümünün "oynatıcı
 * kapsayıcısı" sayılmasını engeller. Diğer adaptörler genel sınırı kullanır.
 */
export const UDEMY_MAX_LOCAL_CONTAINER_AREA_RATIO = 3

/**
 * Genel adaptörlerde (generic-dom) videoyla ortak kapsayıcının alan üst
 * sınırı. Sayfa kabuğunu dışlar ama oynatıcı çevresindeki geniş sarmalayıcıyı
 * kabul eder.
 */
export const DEFAULT_PLAYER_CONTAINER_AREA_RATIO = 8

/** Adayın video ile ortak, sınırlı bir oynatıcı kapsayıcısı var mı? */
export function sharesPlayerContainer(
  video: HTMLVideoElement,
  candidate: Element,
  videoRect: Rect | null,
  maxAreaRatio = DEFAULT_PLAYER_CONTAINER_AREA_RATIO,
): boolean {
  const common = nearestCommonAncestor(video, candidate)
  if (!common) return false
  const tag = common.tagName.toLowerCase()
  if (tag === 'body' || tag === 'html') return false
  const commonRect = getElementRect(common)
  const videoArea = rectArea(videoRect)
  const commonArea = rectArea(commonRect)
  if (videoArea <= 0 || commonArea <= 0) return false
  // Tüm sayfayı kapsayan ortak kapsayıcı "yerel oynatıcı" sayılmaz.
  return commonArea <= videoArea * maxAreaRatio
}

export function strongGeometricRelation(
  candidateRect: Rect | null,
  videoRect: Rect | null,
): boolean {
  const ratio = intersectionRatio(candidateRect, videoRect)
  return ratio >= 0.5
}

/** Video altı altyazı bloğunun video alt kenarına izin verilen uzaklığı. */
export const BELOW_VIDEO_MAX_GAP_PX = 160
/** Dar olan bloğun genişliğine göre gereken en az yatay kesişim. */
export const BELOW_VIDEO_MIN_HORIZONTAL_OVERLAP = 0.6
/**
 * Video genişliğine göre gereken en az yatay kesişim. Dar bir rozet/etiket
 * kendi genişliğine göre %100 kesişse bile bu eşiği geçemez.
 */
export const BELOW_VIDEO_MIN_VIDEO_WIDTH_OVERLAP = 0.3

/** İki dikdörtgenin yatay kesişiminin dar blok genişliğine oranı. */
export function horizontalOverlapRatio(
  a: Rect | null,
  b: Rect | null,
): number {
  if (!a || !b) return 0
  const narrower = Math.min(a.width, b.width)
  if (narrower <= 0) return 0
  const left = Math.max(a.left, b.left)
  const right = Math.min(a.left + a.width, b.left + b.width)
  return Math.max(0, right - left) / narrower
}

/**
 * Aday gerçekten videonun altında ve onunla aynı hizada mı?
 *
 * Video üstünde kalan içerik, 160 px'den uzak bloklar ve yatay olarak
 * videoyla hizasız (dar bloğun %60'ından az kesişen) bloklar reddedilir.
 */
export function isBelowVideoRelation(
  candidateRect: Rect | null,
  videoRect: Rect | null,
): boolean {
  if (!candidateRect || !videoRect) return false
  const videoBottom = videoRect.top + videoRect.height
  // Küçük yuvarlama payı: blok video alt kenarına yapışık olabilir.
  if (candidateRect.top < videoBottom - 1) return false
  if (candidateRect.top - videoBottom > BELOW_VIDEO_MAX_GAP_PX) return false
  if (
    horizontalOverlapRatio(candidateRect, videoRect) <
    BELOW_VIDEO_MIN_HORIZONTAL_OVERLAP
  ) {
    return false
  }
  if (videoRect.width <= 0) return false
  const left = Math.max(candidateRect.left, videoRect.left)
  const right = Math.min(
    candidateRect.left + candidateRect.width,
    videoRect.left + videoRect.width,
  )
  const overlapWidth = Math.max(0, right - left)
  return overlapWidth / videoRect.width >= BELOW_VIDEO_MIN_VIDEO_WIDTH_OVERLAP
}

export function isLongDenseText(text: string, lines: string[]): boolean {
  return text.length > 300 || lines.length > 6
}

export function isShortLimitedText(text: string, lines: string[]): boolean {
  return text.length > 0 && text.length <= 300 && lines.length > 0 && lines.length <= 4
}






