/**
 * Genel DOM adaptörü.
 *
 * Bilinen oynatıcı adaptörü yoksa video çevresindeki görünür metin
 * kapsayıcıları incelenir. Puanlama davranış kanıtı olmadan bağlanmaz.
 */

import { AdapterCandidate, AdapterContext } from './types'
import { buildDomEvidence, findPlayerRoot } from './utils'
import {
  candidateKey,
  collectTextCandidates,
  getElementRect,
  hasSubtitleHint,
  isExcludedTextElement,
  isStyleVisible,
  normalizeComparableText,
  readVisibleText,
  rectArea,
  textLines,
} from '../text'

const EXTERNAL_HINT_SELECTOR = [
  '[class*="caption"]',
  '[class*="subtitle"]',
  '[class*="cue"]',
  '[data-purpose*="caption"]',
  '[data-purpose*="subtitle"]',
].join(',')

interface GenericGroup {
  element: Element
  text: string
  lines: string[]
  rect: ReturnType<typeof getElementRect>
  key: string
}

export class GenericDomAdapter {
  public getCandidates(context: AdapterContext): AdapterCandidate[] {
    const { entry, window: win, document: doc } = context
    if (!entry.visible) return []

    const playerRoot = findPlayerRoot(entry.video) || entry.video.parentElement
    const videoRect = entry.rect || getElementRect(entry.video)
    const groups: GenericGroup[] = []

    if (playerRoot && playerRoot.contains(entry.video)) {
      for (const group of collectTextCandidates(playerRoot, {
        video: entry.video,
        videoRect,
        win,
        maxCandidates: 100,
      })) {
        groups.push({
          element: group.element,
          text: group.text,
          lines: group.lines,
          rect: group.rect,
          key: candidateKey(group.element, playerRoot),
        })
      }
    }

    this.collectExternalGroups(doc, win, entry, videoRect, groups)

    const seen = new Set<string>()
    const candidates: AdapterCandidate[] = []
    for (const group of groups) {
      if (!group.text) continue
      const dedupeKey = `${group.key}::${normalizeComparableText(group.text)}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)

      const evidence = buildDomEvidence(
        entry,
        group.element,
        group.text,
        group.lines,
        group.rect,
      )
      const related = evidence.sharesPlayerContainer || evidence.strongGeometry
      candidates.push({
        sourceId: `generic:${entry.id}:${group.key}`,
        kind: 'generic-dom',
        videoId: entry.id,
        element: group.element,
        text: group.text,
        lines: group.lines,
        rect: group.rect,
        evidence,
        invalidReason: related ? undefined : 'unrelated-video',
        reason: hasSubtitleHint(group.element)
          ? 'generic dom candidate with subtitle hint'
          : 'generic dom candidate with behaviour evidence',
      })
    }

    return candidates.slice(0, 100)
  }

  private collectExternalGroups(
    doc: Document,
    win: Window,
    entry: AdapterContext['entry'],
    videoRect: ReturnType<typeof getElementRect>,
    groups: GenericGroup[],
  ): void {
    let elements: Element[] = []
    try {
      elements = Array.from(doc.querySelectorAll(EXTERNAL_HINT_SELECTOR))
    } catch {
      elements = []
    }
    const selected: Element[] = []
    for (const el of elements.slice(0, 200)) {
      if (el.contains(entry.video) || el === entry.video) continue
      if (!isStyleVisible(el, win)) continue
      if (isExcludedTextElement(el)) continue
      const rect = getElementRect(el)
      if (!rect || rectArea(rect) <= 0) continue
      selected.push(el)
    }

    // Aynı metin ağacının üst/alt öğeleri tek gruba indirgenir.
    const reps: Element[] = []
    for (const el of selected) {
      const text = readVisibleText(el, { win })
      if (!text) continue
      let rep = el
      let parent = el.parentElement
      let depth = 0
      while (
        parent &&
        depth < 4 &&
        !isExcludedTextElement(parent) &&
        !parent.contains(entry.video)
      ) {
        const parentText = readVisibleText(parent, { win })
        if (normalizeComparableText(parentText) !== normalizeComparableText(text)) {
          break
        }
        rep = parent
        parent = parent.parentElement
        depth += 1
      }
      if (!reps.some((existing) => existing === rep)) reps.push(rep)
    }

    for (const rep of reps) {
      const text = readVisibleText(rep, { win })
      if (!text) continue
      groups.push({
        element: rep,
        text,
        lines: textLines(text),
        rect: getElementRect(rep),
        key: candidateKey(rep, null),
      })
    }
  }
}

