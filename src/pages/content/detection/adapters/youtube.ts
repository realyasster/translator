/**
 * YouTube oynatıcı adaptörü.
 *
 * Kararlı üst kapsayıcı #movie_player'dır. Yalnızca görünür caption penceresi
 * okunur; ayarlar menüsü ve transkript dışlanır. Farklı pencereler birleştirilmez.
 */

import { AdapterCandidate, AdapterContext } from './types'
import { buildDomEvidence, findPlayerRoot, hostEndsWith } from './utils'
import {
  getElementRect,
  isExcludedTextElement,
  isStyleVisible,
  readVisibleText,
  rectArea,
  textLines,
} from '../text'

const CAPTION_CONTAINER_SELECTOR = '.ytp-caption-window-container'
const CAPTION_WINDOW_SELECTOR =
  '.ytp-caption-window-container .caption-window, .ytp-caption-window-container .ytp-caption-window'

export class YouTubeAdapter {
  public static matches(hostname: string): boolean {
    return hostEndsWith(hostname, 'youtube.com')
  }

  public getCandidate(context: AdapterContext): AdapterCandidate | null {
    const { entry } = context
    if (!entry.visible) return null

    const playerRoot = findPlayerRoot(entry.video)
    if (!playerRoot || !playerRoot.contains(entry.video)) return null

    const container =
      (playerRoot.querySelector(CAPTION_CONTAINER_SELECTOR) as HTMLElement | null) ||
      null
    if (!container || !isStyleVisible(container, context.window)) return null
    if (isExcludedTextElement(container)) return null

    const window = this.pickCaptionWindow(container, context)
    if (!window) {
      // Altyazı penceresi henüz yok: bağlı kaynak boş metinle korunur.
      return this.buildCandidate(context, container, '')
    }

    return this.buildCandidate(
      context,
      window,
      this.readWindowText(window, context),
    )
  }

  private readWindowText(window: HTMLElement, context: AdapterContext): string {
    const segments = Array.from(
      window.querySelectorAll('.ytp-caption-segment'),
    )
      .map((segment) => readVisibleText(segment, { win: context.window }))
      .filter(Boolean)
    if (segments.length) return segments.join(' ')
    return readVisibleText(window, { win: context.window })
  }

  private pickCaptionWindow(
    container: HTMLElement,
    context: AdapterContext,
  ): HTMLElement | null {
    let windows: Element[] = []
    try {
      windows = Array.from(container.querySelectorAll(CAPTION_WINDOW_SELECTOR))
    } catch {
      windows = []
    }
    if (!windows.length) {
      windows = Array.from(container.children)
    }

    const visible = windows.filter(
      (el) =>
        isStyleVisible(el, context.window) &&
        !isExcludedTextElement(el) &&
        readVisibleText(el, { win: context.window }).length > 0,
    )
    if (!visible.length) return null
    // Aynı altyazıyı taşıyan bağımsız pencereler birleştirilmez; en büyük
    // görünür pencere tek kaynak olarak seçilir.
    visible.sort(
      (a, b) => rectArea(getElementRect(b)) - rectArea(getElementRect(a)),
    )
    return visible[0] as HTMLElement
  }

  private buildCandidate(
    context: AdapterContext,
    element: HTMLElement,
    text: string,
  ): AdapterCandidate {
    const { entry } = context
    const lines = textLines(text)
    const rect = getElementRect(element) || entry.rect
    return {
      sourceId: `player:youtube:${entry.id}:captions`,
      kind: 'player-dom',
      videoId: entry.id,
      element,
      text,
      lines,
      rect,
      evidence: buildDomEvidence(entry, element, text, lines, rect, {
        verifiedPlayerContainer: true,
        sharesPlayerContainer: true,
        forceHint: true,
      }),
      reason: 'youtube caption window',
    }
  }
}
