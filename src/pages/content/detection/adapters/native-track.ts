/**
 * Yerel TextTrack adaptörü.
 *
 * Yalnızca subtitles/captions türleri ve mode==='showing' kanallar seçilebilir.
 * Kapalı/gizli kanalın modu değiştirilmez. Etkin cue bulunmaması kanalın
 * kaybolduğu anlamına gelmez; aday boş metinle korunur.
 */

import { AdapterCandidate } from './types'
import { VideoEntry } from '../video-registry'
import { buildDomEvidence } from './utils'
import { textLines } from '../text'

export class NativeTrackAdapter {
  private video: HTMLVideoElement | null = null
  private list: TextTrackList | null = null
  private onChange: (() => void) | null = null
  private cueHandlers = new Map<TextTrack, () => void>()
  private listHandlers: Array<[string, EventListener]> = []

  public attach(video: HTMLVideoElement, onChange?: () => void): void {
    if (this.video === video) {
      if (onChange) this.onChange = onChange
      return
    }
    this.detach()
    this.video = video
    this.onChange = onChange ?? this.onChange

    const list = (video as any).textTracks as TextTrackList | undefined
    if (!list) return
    this.list = list

    const refresh = () => {
      this.syncTracks()
      if (this.onChange) this.onChange()
    }
    const handlers: Array<[string, EventListener]> = [
      ['addtrack', refresh],
      ['removetrack', refresh],
      ['change', refresh],
    ]
    for (const [name, handler] of handlers) {
      try {
        list.addEventListener(name, handler)
        this.listHandlers.push([name, handler])
      } catch {
        // TextTrackList olayları desteklemiyorsa sessizce geç.
      }
    }
    this.syncTracks()
  }

  public detach(): void {
    if (this.list) {
      for (const [name, handler] of this.listHandlers) {
        try {
          this.list.removeEventListener(name, handler)
        } catch {
          // yoksay
        }
      }
    }
    this.listHandlers = []
    for (const [track, handler] of Array.from(this.cueHandlers.entries())) {
      try {
        track.removeEventListener('cuechange', handler)
      } catch {
        // yoksay
      }
    }
    this.cueHandlers.clear()
    this.list = null
    this.video = null
    this.onChange = null
  }

  public getCandidates(entry: VideoEntry): AdapterCandidate[] {
    const video = entry.video
    const list = (video as any).textTracks as TextTrackList | undefined
    if (!list) return []

    const candidates: AdapterCandidate[] = []
    const tracks = Array.from(list as unknown as TextTrack[])
    for (let index = 0; index < tracks.length; index += 1) {
      const track = tracks[index]
      if (!track) continue
      if (track.kind !== 'subtitles' && track.kind !== 'captions') continue
      if (track.mode !== 'showing') continue

      const cues = this.readActiveCues(track)
      const text = cues
        .map((cue) => this.cueText(cue))
        .filter(Boolean)
        .join('\n')
      const lines = textLines(text)
      const language = track.language || 'und'
      const identity = track.id || language
      const sourceId = `native:${entry.id}:${index}:${identity}`

      candidates.push({
        sourceId,
        kind: 'text-track',
        videoId: entry.id,
        element: null,
        text,
        lines,
        rect: entry.rect,
        evidence: buildDomEvidence(
          entry,
          video,
          text,
          lines,
          entry.rect,
          {
            nativeActiveCue: cues.length > 0,
            sharesPlayerContainer: true,
            forceHint: true,
          },
        ),
        reason: 'showing text track',
      })
    }
    return candidates
  }

  private syncTracks(): void {
    const list = this.list
    if (!list) return
    const tracks = Array.from(list as unknown as TextTrack[])
    const active = new Set(tracks)

    for (const [track, handler] of Array.from(this.cueHandlers.entries())) {
      if (!active.has(track)) {
        try {
          track.removeEventListener('cuechange', handler)
        } catch {
          // yoksay
        }
        this.cueHandlers.delete(track)
      }
    }

    for (const track of tracks) {
      if (this.cueHandlers.has(track)) continue
      const handler = () => {
        if (this.onChange) this.onChange()
      }
      try {
        track.addEventListener('cuechange', handler)
        this.cueHandlers.set(track, handler)
      } catch {
        // yoksay
      }
    }
  }

  private readActiveCues(track: TextTrack): TextTrackCue[] {
    const cues = (track as any).activeCues as TextTrackCueList | null
    if (!cues) return []
    const list = Array.from(cues as unknown as TextTrackCue[])
    return list.sort((a, b) => {
      const startA = Number((a as any).startTime) || 0
      const startB = Number((b as any).startTime) || 0
      return startA - startB
    })
  }

  private cueText(cue: TextTrackCue): string {
    const raw = String((cue as any).text || '')
    // WebVTT işaretlemesi çeviriye HTML olarak taşınmaz.
    return raw
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim()
  }
}

