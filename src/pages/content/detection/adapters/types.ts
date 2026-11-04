import { InvalidReason, CandidateEvidence } from '../scoring'
import { Rect, SourceKind } from '../../../../types/detection'
import { VideoEntry } from '../video-registry'
import { AdapterPresentationHint } from '../presentation'

export interface AdapterCandidate {
  sourceId: string
  kind: SourceKind
  videoId: string
  element: Element | null
  text: string
  lines: string[]
  rect: Rect | null
  evidence: CandidateEvidence
  invalidReason?: InvalidReason
  reason?: string
  /**
   * Content tarafı yerleşim ipucu. Uzak katmana taşınmaz; yalnızca
   * dedektörün SubtitlePresentation üretmesinde kullanılır.
   */
  presentation?: AdapterPresentationHint
}

export interface AdapterContext {
  entry: VideoEntry
  document: Document
  window: Window
  now: number
  hostname: string
}

