import { NativeTrackAdapter } from '../adapters/native-track'
import { VideoEntry } from '../video-registry'

interface FakeTrack {
  kind: string
  mode: string
  language: string
  id: string
  activeCues: Array<{ startTime: number; text: string }>
  listeners: Record<string, Array<() => void>>
  addEventListener: (name: string, fn: () => void) => void
  removeEventListener: (name: string, fn: () => void) => void
}

function makeTrack(
  kind = 'subtitles',
  mode = 'showing',
  cues: Array<{ startTime: number; text: string }> = [],
): FakeTrack {
  const listeners: Record<string, Array<() => void>> = {}
  return {
    kind,
    mode,
    language: 'en',
    id: `${kind}_${mode}`,
    activeCues: cues,
    listeners,
    addEventListener: (name, fn) => {
      listeners[name] = listeners[name] || []
      listeners[name].push(fn)
    },
    removeEventListener: (name, fn) => {
      listeners[name] = (listeners[name] || []).filter((item) => item !== fn)
    },
  }
}

function makeList(tracks: FakeTrack[]) {
  const listeners: Record<string, Array<() => void>> = {}
  const list: any = {
    length: tracks.length,
    addEventListener: (name: string, fn: () => void) => {
      listeners[name] = listeners[name] || []
      listeners[name].push(fn)
    },
    removeEventListener: (name: string, fn: () => void) => {
      listeners[name] = (listeners[name] || []).filter((item) => item !== fn)
    },
    emit: (name: string) => {
      ;(listeners[name] || []).slice().forEach((fn) => fn())
    },
  }
  tracks.forEach((track, index) => {
    list[index] = track
  })
  return list
}

function makeVideo(tracks: FakeTrack[]): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperty(video, 'textTracks', {
    configurable: true,
    value: makeList(tracks),
  })
  return video
}

function makeEntry(video: HTMLVideoElement): VideoEntry {
  return {
    id: 'video_1',
    video,
    root: document,
    generation: 1,
    contentKey: 'src',
    paused: false,
    ended: false,
    readyState: 4,
    currentTime: 1,
    currentSrc: 'https://example.com/video.mp4',
    fullscreen: false,
    visible: true,
    visibleArea: 800 * 450,
    rect: { left: 0, top: 0, width: 800, height: 450 },
    lastSeenAt: 0,
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('NativeTrackAdapter', () => {
  it('aktif cue metinlerini kanal sırasıyla birleştirir', () => {
    const track = makeTrack('subtitles', 'showing', [
      { startTime: 2, text: 'Second line' },
      { startTime: 1, text: 'First line' },
    ])
    const video = makeVideo([track])
    const adapter = new NativeTrackAdapter()
    adapter.attach(video)
    const candidates = adapter.getCandidates(makeEntry(video))
    expect(candidates).toHaveLength(1)
    expect(candidates[0].text).toBe('First line\nSecond line')
    expect(candidates[0].kind).toBe('text-track')
    expect(candidates[0].evidence.nativeActiveCue).toBe(true)
    adapter.detach()
  })

  it('kapalı/gizli kanalın moduna dokunmaz ve aday üretmez', () => {
    const disabled = makeTrack('subtitles', 'disabled', [
      { startTime: 0, text: 'Hidden cue' },
    ])
    const hidden = makeTrack('captions', 'hidden', [
      { startTime: 0, text: 'Hidden cue 2' },
    ])
    const video = makeVideo([disabled, hidden])
    const adapter = new NativeTrackAdapter()
    adapter.attach(video)
    expect(adapter.getCandidates(makeEntry(video))).toEqual([])
    expect(disabled.mode).toBe('disabled')
    expect(hidden.mode).toBe('hidden')
    adapter.detach()
  })

  it('subtitle/caption dışındaki kanalları değerlendirmez', () => {
    const track = makeTrack('metadata', 'showing', [
      { startTime: 0, text: 'metadata' },
    ])
    const video = makeVideo([track])
    const adapter = new NativeTrackAdapter()
    adapter.attach(video)
    expect(adapter.getCandidates(makeEntry(video))).toEqual([])
    adapter.detach()
  })

  it('etkin cue yokken adayı boş metinle korur', () => {
    const track = makeTrack('subtitles', 'showing', [])
    const video = makeVideo([track])
    const adapter = new NativeTrackAdapter()
    adapter.attach(video)
    const candidates = adapter.getCandidates(makeEntry(video))
    expect(candidates).toHaveLength(1)
    expect(candidates[0].text).toBe('')
    adapter.detach()
  })

  it('sonradan eklenen track için aday üretir ve değişikliği bildirir', () => {
    const tracks: FakeTrack[] = []
    const video = makeVideo(tracks)
    const onChange = jest.fn()
    const adapter = new NativeTrackAdapter()
    adapter.attach(video, onChange)

    const added = makeTrack('subtitles', 'showing', [
      { startTime: 0, text: 'Added track' },
    ])
    const list = (video as any).textTracks as any
    tracks.push(added)
    list.length = tracks.length
    list[0] = added
    list.emit('addtrack')

    expect(onChange).toHaveBeenCalled()
    const candidates = adapter.getCandidates(makeEntry(video))
    expect(candidates[0].text).toBe('Added track')
    adapter.detach()
  })

  it('cuechange olayı değişiklik bildirir', () => {
    const track = makeTrack('subtitles', 'showing', [
      { startTime: 0, text: 'Before' },
    ])
    const video = makeVideo([track])
    const onChange = jest.fn()
    const adapter = new NativeTrackAdapter()
    adapter.attach(video, onChange)

    track.activeCues = [{ startTime: 0, text: 'After' }]
    ;(track.listeners.cuechange || []).forEach((fn) => fn())

    expect(onChange).toHaveBeenCalled()
    expect(adapter.getCandidates(makeEntry(video))[0].text).toBe('After')
    adapter.detach()
  })

  it('detach sonrası cuechange dinleyicilerini temizler', () => {
    const track = makeTrack('subtitles', 'showing', [])
    const video = makeVideo([track])
    const adapter = new NativeTrackAdapter()
    adapter.attach(video)
    adapter.detach()
    expect((track.listeners.cuechange || []).length).toBe(0)
  })
})
