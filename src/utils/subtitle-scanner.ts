export interface SubtitleCandidate {
  selector: string
  count: number
  sample: string
  score: number
  reason: string
}

const POSITIVE_HINTS = [
  'shaka-text', 'cue-text', 'caption', 'subtitle', 'timedtext',
  'transcript', 'caption-text', 'player-caption', 'videojs',
]

const NEGATIVE_HINTS = [
  'dropdown', 'menu', 'nav', 'header', 'footer', 'sidebar',
  'button', 'tab', 'modal', 'popup', 'tooltip', 'breadcrumb',
  'ad-', 'banner', 'promo', 'cookie', 'consent', 'language',
]

const UI_TEXT_REGEXES: RegExp[] = [
  /\b\d+\s*more\b/i,
  /\|\s*\|/,
  /\bclick here\b/i,
  /\bsign in\b/i,
  /\bsign up\b/i,
  /\blog in\b/i,
  /\bclose\b/i,
  /^\s*[a-z]{2}\s*\[(auto|en|off)\]\s*$/i,
]

const LANG_WORDS = new Set([
  'english', 'turkish', 'türkçe', 'chinese', 'spanish', 'french',
  'german', 'portuguese', 'japanese', 'korean', 'arabic', 'hindi',
  'russian', 'italian', 'dutch', 'polish',
])

function looksLikeUIText(text: string): boolean {
  const t = (text || '').trim()
  if (!t) return true
  if (UI_TEXT_REGEXES.some((re) => re.test(t))) return true
  const lower = t.toLowerCase()
  if (LANG_WORDS.has(lower)) return true
  return false
}

function buildSelector(el: Element): string {
  const parts: string[] = []
  let cur: Element | null = el
  let depth = 0
  while (cur && cur !== document.body && cur !== document.documentElement && depth < 6) {
    let part = cur.tagName.toLowerCase()
    if (cur.id && /^[a-zA-Z][\w-]*$/.test(cur.id)) {
      part += `#${cur.id}`
      parts.unshift(part)
      break
    }
    if (cur.className && typeof cur.className === 'string') {
      const cls = cur.className
        .trim()
        .split(/\s+/)
        .filter((c) => /^[a-zA-Z][\w-]*$/.test(c))
        .filter((c) => !/^(active|open|show|hide|visible|selected|current|js-)/.test(c))
        .filter((c) => c.length < 30)
        .slice(0, 2)
      if (cls.length > 0) {
        part += '.' + cls.join('.')
      }
    }
    const parent: Element | null = cur.parentElement
    if (parent) {
      const curTag = cur.tagName
      const sameTagSiblings = Array.from(parent.children).filter(
        (c) => c.tagName === curTag,
      )
      if (sameTagSiblings.length > 1) {
        const idx = sameTagSiblings.indexOf(cur) + 1
        part += `:nth-of-type(${idx})`
      }
    }
    parts.unshift(part)
    cur = parent
    depth++
  }
  return parts.join(' > ')
}

export interface ScanResult {
  candidates: SubtitleCandidate[]
  best: SubtitleCandidate | null
  totalScanned: number
  framesScanned: number
}

function scanDocument(root: Document | ShadowRoot, depth: number = 0): SubtitleCandidate[] {
  if (depth > 4) return []
  const allElements = Array.from(root.querySelectorAll('*'))
  const candidates: SubtitleCandidate[] = []
  const seen = new Set<string>()

  const buckets = new Map<
    string,
    { selector: string; elements: Element[]; sample: string; score: number; reason: string }
  >()

  for (const el of allElements) {
    if (el.shadowRoot) {
      candidates.push(...scanDocument(el.shadowRoot, depth + 1))
    }

    const tag = el.tagName.toLowerCase()
    if (!['div', 'span', 'p', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) continue

    const text = (el.textContent || '').trim()
    if (!text) continue
    if (text.length > 600) continue
    if (looksLikeUIText(text)) continue

    const directText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent?.trim() || '')
      .join(' ')
      .trim()
    const effectiveText = directText || text
    if (effectiveText.length < 8) continue

    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue
    if (rect.left < 0 || rect.left > window.innerWidth) continue

    const lowerClass = (el.className && typeof el.className === 'string'
      ? el.className.toLowerCase()
      : '') + ' ' + (el.id || '').toLowerCase()
    const lowerTag = el.tagName.toLowerCase()
    let score = 0
    let reason = ''
    const matchedClass = POSITIVE_HINTS.find((h) => lowerClass.includes(h))
    if (matchedClass) {
      score += 30
      reason = `class*="${matchedClass}"`
    }
    if (lowerClass.includes('shaka')) {
      score += 25
      reason = 'shaka container'
    }
    if (lowerTag === 'span' && effectiveText.length >= 10 && effectiveText.length <= 300) {
      score += 10
    }
    const vh = window.innerHeight
    const vw = window.innerWidth
    if (rect.bottom > vh * 0.5 && rect.top < vh && rect.width > vw * 0.2) {
      score += 15
      reason += ' · bottom area'
    }
    if (effectiveText.length >= 20 && effectiveText.length <= 200) {
      score += 5
    }
    if (effectiveText.length > 250) {
      score -= 15
    }
    const negHit = NEGATIVE_HINTS.find((h) => lowerClass.includes(h))
    if (negHit) {
      score -= 50
      reason += ` · ui:${negHit}`
    }
    if (el.children.length === 0) {
      score += 3
    }

    if (score <= 0) continue

    const selector = buildSelector(el)
    if (!selector || seen.has(selector)) continue
    seen.add(selector)

    const bucket = buckets.get(selector) ?? {
      selector,
      elements: [] as Element[],
      sample: effectiveText.slice(0, 80),
      score,
      reason: reason.trim(),
    }
    bucket.elements.push(el)
    if (!bucket.sample || bucket.sample.length < effectiveText.length) {
      bucket.sample = effectiveText.slice(0, 80)
    }
    buckets.set(selector, bucket)

    candidates.push({
      selector,
      count: bucket.elements.length,
      sample: bucket.sample,
      score,
      reason: reason.trim(),
    })
  }

  return candidates
}

export function scanSubtitleElements(): ScanResult {
  const allCandidates: SubtitleCandidate[] = []
  let totalScanned = 0
  let framesScanned = 0

  try {
    const mainDoc = document
    const mainCandidates = scanDocument(mainDoc, 0)
    allCandidates.push(...mainCandidates)
    totalScanned += mainDoc.querySelectorAll('*').length
    framesScanned++

    for (const iframe of Array.from(mainDoc.querySelectorAll('iframe'))) {
      try {
        const doc = iframe.contentDocument
        if (doc) {
          const frameCandidates = scanDocument(doc, 0)
          for (const c of frameCandidates) {
            allCandidates.push({
              ...c,
              selector: `iframe >>> ${c.selector}`,
              reason: c.reason + ' · iframe',
            })
          }
          totalScanned += doc.querySelectorAll('*').length
          framesScanned++
        }
      } catch {
        // cross-origin iframe
      }
    }
  } catch (e) {
    console.warn('Scan error:', e)
  }

  const debug = (window as any).__udemy_translate_debug
  if (debug) {
    console.log(
      '[Auto-detect] Scanned',
      totalScanned,
      'elements across',
      framesScanned,
      'frame(s). Candidates:',
      allCandidates.length,
    )
  }

  allCandidates.sort((a, b) => b.score - a.score)
  const dedup = new Map<string, SubtitleCandidate>()
  for (const c of allCandidates) {
    if (!dedup.has(c.selector)) dedup.set(c.selector, c)
  }
  const sorted = Array.from(dedup.values())
  return {
    candidates: sorted.slice(0, 20),
    best: sorted[0] ?? null,
    totalScanned,
    framesScanned,
  }
}