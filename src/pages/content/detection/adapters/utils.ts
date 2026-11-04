import { CandidateEvidence } from '../scoring'
import { Rect } from '../../../../types/detection'
import { VideoEntry } from '../video-registry'
import {
  getElementRect,
  hasSubtitleHint,
  isLongDenseText,
  isShortLimitedText,
  sharesPlayerContainer,
  strongGeometricRelation,
} from '../text'

const PLAYER_SELECTOR = [
  '[data-purpose="video-player"]',
  '.shaka-video-container',
  '.video-player',
  '.udemy-video-player',
  '#movie_player',
  '.html5-video-player',
  '.html5-video-container',
  'ytd-player',
  '.video-js',
  '.jwplayer',
  '.plyr',
].join(',')

const PLAYER_HINT_RE = /player|video|shaka|ytp|media/i

/** Videonun en yakın yerel oynatıcı kapsayıcısını bulur. */
export function findPlayerRoot(video: HTMLVideoElement): HTMLElement | null {
  try {
    const closest = video.closest(PLAYER_SELECTOR) as HTMLElement | null
    if (closest && closest !== (video.parentElement as HTMLElement)) {
      return closest
    }
  } catch {
    // yoksay
  }

  let current: HTMLElement | null = video.parentElement
  let depth = 0
  while (current && depth < 6) {
    const tag = current.tagName.toLowerCase()
    if (tag === 'body' || tag === 'html') break
    const className =
      typeof current.className === 'string' ? current.className : ''
    const hint = `${className} ${current.id || ''}`
    if (PLAYER_HINT_RE.test(hint)) return current
    current = current.parentElement
    depth += 1
  }
  return video.parentElement
}

export function buildDomEvidence(
  entry: VideoEntry,
  element: Element,
  text: string,
  lines: string[],
  rect: Rect | null,
  options: {
    verifiedPlayerContainer?: boolean
    verifiedCaptionBlock?: boolean
    nativeActiveCue?: boolean
    sharesPlayerContainer?: boolean
    verifiedBelowVideoRelation?: boolean
    forceHint?: boolean
  } = {},
): CandidateEvidence {
  const videoRect = entry.rect ?? getElementRect(entry.video)
  const candidateRect = rect ?? getElementRect(element)
  return {
    nativeActiveCue: options.nativeActiveCue,
    verifiedPlayerContainer: options.verifiedPlayerContainer,
    verifiedCaptionBlock: options.verifiedCaptionBlock,
    sharesPlayerContainer:
      options.sharesPlayerContainer ??
      sharesPlayerContainer(entry.video, element, videoRect),
    strongGeometry: strongGeometricRelation(candidateRect, videoRect),
    verifiedBelowVideoRelation: options.verifiedBelowVideoRelation,
    verifiedTextChanges: false,
    shortLimitedLines: isShortLimitedText(text, lines),
    subtitleHint: options.forceHint || hasSubtitleHint(element),
    longDenseText: isLongDenseText(text, lines),
  }
}

export function hostEndsWith(hostname: string, domain: string): boolean {
  const host = (hostname || '').toLowerCase()
  return host === domain || host.endsWith(`.${domain}`)
}

