import { DetectionEngine, DetectionVisibility } from '../detection-engine'
import { UdemyAdapter } from '../adapters/udemy'
import { SubtitlePresentation } from '../presentation'
import {
  CandidateSummary,
  DetectionAuthority,
  DetectionFrameReport,
  DetectionStatus,
  DetectionTransport,
  DetectionTransportHandlers,
  Rect,
  SourceKind,
} from '../../../../types/detection'

function mockRect(
  el: Element,
  rect: { left: number; top: number; width: number; height: number },
): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }),
  })
}

class FakeVisibility implements DetectionVisibility {
  public known = true
  public documentVisible = true
  public region: Rect | null = { left: 0, top: 0, width: 1280, height: 720 }

  public start(): void {}
  public stop(): void {}
  public broadcastToChildren(): void {}
  public isKnown(): boolean {
    return this.known
  }
  public getVisibleRegion(): Rect | null {
    return this.region
  }
  public isDocumentVisible(): boolean {
    return this.documentVisible
  }
  public isFrameVisible(): boolean {
    return this.known && this.documentVisible && !!this.region
  }
}

class FakeTransport implements DetectionTransport {
  public reports: DetectionFrameReport[] = []
  public grants: DetectionAuthority[] = []
  public releases: string[] = []
  public last: DetectionFrameReport | null = null
  private handlers: DetectionTransportHandlers | null = null
  private current: DetectionAuthority | null = null
  private tokenCounter = 0

  public start(
    report: DetectionFrameReport | null,
    handlers: DetectionTransportHandlers,
  ): void {
    this.handlers = handlers
    if (report) this.update(report)
  }

  public update(report: DetectionFrameReport): void {
    this.reports.push(report)
    this.last = report
    if (!this.current) {
      const best = report.candidates.find((candidate) => candidate.ready)
      if (best) this.grant(best)
    }
  }

  public release(token: string): void {
    this.releases.push(token)
    if (this.current?.token === token) this.current = null
  }

  public stop(): void {
    this.handlers = null
    this.current = null
  }

  public authority(): DetectionAuthority | null {
    return this.current
  }

  public grant(candidate: CandidateSummary): void {
    this.tokenCounter += 1
    this.current = {
      token: `token_${this.tokenCounter}`,
      source: candidate.source,
      expiresAt: Date.now() + 6000,
    }
    this.grants.push(this.current)
    this.handlers?.onGrant(this.current)
  }

  public revoke(reason = 'test-revoke'): void {
    if (!this.current) return
    const token = this.current.token
    this.current = null
    this.handlers?.onRevoke(token, reason)
  }
}

interface Fixture {
  engine: DetectionEngine
  transport: FakeTransport
  visibility: FakeVisibility
  video: HTMLVideoElement
  caption: HTMLElement
  samples: Array<{ text: string; kind: SourceKind }>
  statuses: DetectionStatus[]
  setText: (text: string) => void
  advanceMedia: (amount: number) => void
}

function buildFixture(options: {
  withVideo?: boolean
  text?: string
  secondCaption?: boolean
} = {}): Fixture {
  const { withVideo = true, text = 'First subtitle', secondCaption = false } =
    options
  document.body.innerHTML = withVideo
    ? `
      <div id="player">
        <video id="video"></video>
        <div class="x9q2" id="caption">${text}</div>
        ${secondCaption ? '<div class="x9q3" id="caption2">Second candidate</div>' : ''}
      </div>
    `
    : '<div id="page">No video here</div>'

  const visibility = new FakeVisibility()
  const transport = new FakeTransport()
  let mediaTime = 1
  let video: HTMLVideoElement | null = null

  if (withVideo) {
    video = document.getElementById('video') as HTMLVideoElement
    Object.defineProperty(video, 'paused', {
      configurable: true,
      get: () => false,
    })
    Object.defineProperty(video, 'ended', {
      configurable: true,
      get: () => false,
    })
    Object.defineProperty(video, 'readyState', {
      configurable: true,
      get: () => 4,
    })
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => mediaTime,
    })
    Object.defineProperty(video, 'currentSrc', {
      configurable: true,
      get: () => 'https://example.com/video.mp4',
    })
    mockRect(video, { left: 0, top: 0, width: 800, height: 450 })
    mockRect(document.getElementById('player') as HTMLElement, {
      left: 0,
      top: 0,
      width: 800,
      height: 450,
    })
    mockRect(document.getElementById('caption') as HTMLElement, {
      left: 100,
      top: 350,
      width: 600,
      height: 40,
    })
    if (secondCaption) {
      mockRect(document.getElementById('caption2') as HTMLElement, {
        left: 100,
        top: 300,
        width: 600,
        height: 40,
      })
    }
  }

  const engine = new DetectionEngine({
    document,
    window,
    documentId: 'doc_test',
    hostname: 'example.com',
    transport,
    visibility,
  })

  const samples: Array<{ text: string; kind: SourceKind }> = []
  const statuses: DetectionStatus[] = []
  engine.subscribe(
    (sample) => samples.push({ text: sample.text, kind: sample.source.kind }),
    (status) => statuses.push(status),
  )

  const holder = {
    engine,
    transport,
    visibility,
    video: video as HTMLVideoElement,
    caption: document.getElementById('caption') as HTMLElement,
    samples,
    statuses,
    setText: (next: string) => {
      const el = document.getElementById('caption')
      if (el) el.textContent = next
    },
    advanceMedia: (amount: number) => {
      mediaTime += amount
    },
  }
  return holder
}

function step(fixture: Fixture, text: string): void {
  fixture.setText(text)
  fixture.advanceMedia(1)
  // Gerçek altyazı satırları en az 500 ms görünür kalır; sentetik testte de
  // davranış penceresine uygun aralık kullanılır.
  jest.advanceTimersByTime(1200)
  fixture.engine.evaluateNow()
}

beforeEach(() => {
  jest.useFakeTimers()
  document.body.innerHTML = ''
})

afterEach(() => {
  jest.useRealTimers()
})

describe('DetectionEngine discovery', () => {
  it('video yokken sürekli metin taraması yapmaz ve video arar', () => {
    const fixture = buildFixture({ withVideo: false })
    fixture.engine.start()
    fixture.engine.evaluateNow()

    const status = fixture.engine.getStatus()
    expect(status.phase).toBe('searching')
    expect(status.reason).toBe('video-not-found')
    expect(fixture.transport.last?.candidates).toEqual([])
    fixture.engine.stop()
  })

  it('görünürlük zinciri doğrulanmadan aday göndermez', () => {
    const fixture = buildFixture()
    fixture.visibility.known = false
    fixture.engine.start()
    fixture.engine.evaluateNow()

    expect(fixture.engine.getStatus().reason).toBe('frame-visibility-unknown')
    expect(fixture.transport.last?.candidates).toEqual([])
    fixture.engine.stop()
  })

  it('anlamsız sınıflarda davranış kanıtından sonra bağlanır ve örnek üretir', () => {
    const fixture = buildFixture({ text: 'One' })
    fixture.engine.start()
    jest.advanceTimersByTime(200)
    fixture.engine.evaluateNow()
    expect(fixture.transport.grants).toHaveLength(0)

    step(fixture, 'Two')
    step(fixture, 'Three')

    expect(fixture.transport.grants).toHaveLength(1)
    expect(fixture.transport.grants[0].source.kind).toBe('generic-dom')
    expect(fixture.transport.grants[0].source.sourceId).toContain('caption')

    jest.advanceTimersByTime(0)
    fixture.engine.evaluateNow()
    expect(fixture.samples.map((sample) => sample.text)).toContain('Three')
    expect(fixture.engine.getStatus().phase).toBe('connected')

    fixture.engine.stop()
  })

  it('iki güçlü bağımsız aday varken bağlanmayı bekletir', () => {
    const fixture = buildFixture({ text: 'One', secondCaption: true })
    fixture.engine.start()
    jest.advanceTimersByTime(200)
    fixture.engine.evaluateNow()

    for (const text of ['Two', 'Three', 'Four']) {
      fixture.setText(text)
      const second = document.getElementById('caption2')
      if (second) second.textContent = `${text} B`
      fixture.advanceMedia(1)
      jest.advanceTimersByTime(600)
      fixture.engine.evaluateNow()
    }

    expect(fixture.transport.grants).toHaveLength(0)
    expect(
      fixture.engine
        .getStatus()
        .reason,
    ).toBe('ambiguous-second-candidate')

    // İkinci aday kaldırılınca tek aday güvenle bağlanır.
    document.getElementById('caption2')?.remove()
    jest.advanceTimersByTime(600)
    fixture.engine.evaluateNow()
    expect(fixture.transport.grants).toHaveLength(1)

    fixture.engine.stop()
  })

  it('satır aralarında kaynak bağlantısını korur', () => {
    const fixture = buildFixture({ text: 'One' })
    fixture.engine.start()
    jest.advanceTimersByTime(200)
    fixture.engine.evaluateNow()
    step(fixture, 'Two')
    step(fixture, 'Three')
    step(fixture, 'Four')
    jest.advanceTimersByTime(0)
    fixture.engine.evaluateNow()

    const grantsBefore = fixture.transport.grants.length
    expect(fixture.engine.getStatus().phase).toBe('connected')

    fixture.setText('')
    jest.advanceTimersByTime(600)
    fixture.engine.evaluateNow()
    expect(fixture.engine.getStatus().phase).toBe('waiting')
    expect(fixture.transport.grants).toHaveLength(grantsBefore)

    fixture.setText('Five')
    fixture.advanceMedia(1)
    jest.advanceTimersByTime(600)
    fixture.engine.evaluateNow()
    expect(fixture.engine.getStatus().phase).toBe('connected')
    expect(fixture.samples.map((sample) => sample.text)).toContain('Five')
    expect(fixture.transport.grants).toHaveLength(grantsBefore)

    fixture.engine.stop()
  })

  it('video içeriği değişince yeni nesil kaynak ister', () => {
    const fixture = buildFixture({ text: 'One' })
    fixture.engine.start()
    jest.advanceTimersByTime(200)
    fixture.engine.evaluateNow()
    step(fixture, 'Two')
    step(fixture, 'Three')
    step(fixture, 'Four')
    jest.advanceTimersByTime(0)
    fixture.engine.evaluateNow()
    expect(fixture.engine.getStatus().phase).toBe('connected')

    fixture.transport.revoke('source-changed')
    Object.defineProperty(fixture.video, 'currentSrc', {
      configurable: true,
      get: () => 'https://example.com/other.mp4',
    })
    fixture.video.dispatchEvent(new Event('loadedmetadata'))
    fixture.setText('Same text')
    jest.advanceTimersByTime(100)
    fixture.engine.evaluateNow()

    const latest = fixture.transport.last
    expect(latest?.candidates[0]?.source.generation).toBeGreaterThan(1)
    fixture.engine.stop()
  })

  it('oynayan videoda kaynak doğrulanamazsa unavailable gösterir', () => {
    const fixture = buildFixture({ withVideo: true })
    fixture.caption.remove()
    fixture.engine.start()
    fixture.engine.evaluateNow()
    expect(fixture.engine.getStatus().phase).toBe('searching')

    jest.advanceTimersByTime(10000)
    fixture.engine.evaluateNow()
    expect(fixture.engine.getStatus().phase).toBe('unavailable')
    expect(fixture.engine.getStatus().reason).toBe('no-readable-subtitles')
    fixture.engine.stop()
  })

  it('aynı altyazıyı taşıyan native ve player kopyası bağlanmayı kilitlemez', () => {
    document.body.innerHTML = `
      <div id="movie_player">
        <video id="video"></video>
        <div class="ytp-caption-window-container">
          <div class="caption-window"><span class="ytp-caption-segment">Same caption</span></div>
        </div>
      </div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
    Object.defineProperty(video, 'paused', {
      configurable: true,
      get: () => false,
    })
    Object.defineProperty(video, 'ended', {
      configurable: true,
      get: () => false,
    })
    Object.defineProperty(video, 'readyState', {
      configurable: true,
      get: () => 4,
    })
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => 1,
    })
    Object.defineProperty(video, 'currentSrc', {
      configurable: true,
      get: () => 'https://example.com/video.mp4',
    })
    const track = {
      kind: 'subtitles',
      mode: 'showing',
      language: 'en',
      id: 'track1',
      activeCues: [{ startTime: 0, text: 'Same caption' }],
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }
    Object.defineProperty(video, 'textTracks', {
      configurable: true,
      value: {
        length: 1,
        0: track,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      },
    })
    mockRect(video, { left: 0, top: 0, width: 800, height: 450 })
    mockRect(document.getElementById('movie_player') as HTMLElement, {
      left: 0,
      top: 0,
      width: 800,
      height: 450,
    })
    mockRect(document.querySelector('.ytp-caption-window-container') as HTMLElement, {
      left: 100,
      top: 350,
      width: 600,
      height: 60,
    })
    mockRect(document.querySelector('.caption-window') as HTMLElement, {
      left: 100,
      top: 350,
      width: 600,
      height: 60,
    })
    mockRect(document.querySelector('.ytp-caption-segment') as HTMLElement, {
      left: 100,
      top: 350,
      width: 200,
      height: 30,
    })

    const transport = new FakeTransport()
    const engine = new DetectionEngine({
      document,
      window,
      documentId: 'doc_youtube',
      hostname: 'www.youtube.com',
      transport,
      visibility: new FakeVisibility(),
    })
    engine.start()
    jest.advanceTimersByTime(200)
    engine.evaluateNow()

    expect(transport.grants).toHaveLength(1)
    expect(transport.grants[0].source.kind).toBe('text-track')
    expect(transport.last?.candidates).toHaveLength(1)
    engine.stop()
  })

  it('on kez durdur/başlat algılama durumunu ve aboneleri çoğaltmaz', () => {
    const fixture = buildFixture({ text: 'One' })
    for (let i = 0; i < 10; i += 1) {
      fixture.engine.start()
      fixture.engine.stop()
    }
    fixture.engine.start()
    fixture.engine.evaluateNow()

    // Tek abonelik: aynı örnek numunesi bir kez yayınlanır.
    const samplesBefore = fixture.samples.length
    fixture.engine.evaluateNow()
    expect(fixture.samples.length).toBe(samplesBefore)
    fixture.engine.stop()
  })
})

interface PresentationFixture {
  engine: DetectionEngine
  transport: FakeTransport
  video: HTMLVideoElement
  below: HTMLElement | null
  inside: HTMLElement | null
  mountRow: HTMLElement | null
  presentations: Array<SubtitlePresentation | null>
  events: string[]
  samples: Array<{ text: string; kind: SourceKind }>
}

function buildUdemyPresentationFixture(options: {
  mode?: 'inside' | 'below' | 'well'
  nativeText?: string
  mountRow?: 'valid' | 'missing' | 'wrongParent' | 'hidden'
  expanded?: boolean
} = {}): PresentationFixture {
  const {
    mode = 'below',
    nativeText,
    mountRow = 'valid',
    expanded = false,
  } = options
  const wellHtml =
    '<div class="well-module--container--9Y7tq" id="below"><span class="well-module--text--pTRTZ">Same caption</span></div>'
  const playerHtml = `
    <div class="shaka-video-container" id="player">
      <video id="video"></video>
      ${mode === 'inside' ? '<div class="shaka-text-container" id="inside">Same caption</div>' : ''}
    </div>
  `
  let html: string
  if (mode === 'well') {
    let contentBody: string
    if (mountRow === 'missing') {
      contentBody = `${playerHtml}${wellHtml}`
    } else if (mountRow === 'wrongParent') {
      contentBody = `<div id="wrong-column"><div class="app--body-container--RJZF2" id="mount-row">${playerHtml}${wellHtml}</div></div>`
    } else {
      contentBody = `<div class="app--body-container--RJZF2" id="mount-row"${mountRow === 'hidden' ? ' style="display:none"' : ''}>${playerHtml}${wellHtml}</div>`
    }
    html = `
      <div id="lesson">
        <div class="app--content-column--LnPGp${
          expanded
            ? ' curriculum-item-view--no-sidebar--LGmz- app--no-sidebar--oqmAw'
            : ''
        }" id="app-content">
          ${contentBody}
          <div id="tabs">Comments and learning tools</div>
        </div>
      </div>
    `
  } else {
    html = `
      <div id="lesson">
        ${playerHtml}
        ${mode === 'below' ? '<div data-purpose="captions-display" id="below">Same caption</div>' : ''}
      </div>
    `
  }
  document.body.innerHTML = html
  const video = document.getElementById('video') as HTMLVideoElement
  Object.defineProperty(video, 'paused', { configurable: true, get: () => false })
  Object.defineProperty(video, 'ended', { configurable: true, get: () => false })
  Object.defineProperty(video, 'readyState', { configurable: true, get: () => 4 })
  Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 1 })
  Object.defineProperty(video, 'currentSrc', {
    configurable: true,
    get: () => 'https://example.com/udemy.mp4',
  })
  mockRect(video, { left: 0, top: 0, width: 800, height: 450 })
  mockRect(document.getElementById('player') as HTMLElement, {
    left: 0,
    top: 0,
    width: 800,
    height: 450,
  })
  mockRect(document.getElementById('lesson') as HTMLElement, {
    left: 0,
    top: 0,
    width: 800,
    height: 700,
  })
  const mountRowEl = document.getElementById('mount-row')
  if (mountRowEl) {
    mockRect(mountRowEl as HTMLElement, {
      left: 0,
      top: 0,
      width: 800,
      height: 520,
    })
  }
  const appContent = document.getElementById('app-content')
  if (appContent) {
    mockRect(appContent as HTMLElement, {
      left: 0,
      top: 0,
      width: 800,
      height: 700,
    })
  }
  const tabs = document.getElementById('tabs')
  if (tabs) {
    mockRect(tabs as HTMLElement, {
      left: 0,
      top: 520,
      width: 800,
      height: 180,
    })
  }
  const inside = document.getElementById('inside')
  const below = document.getElementById('below')
  if (inside) {
    mockRect(inside, { left: 100, top: 350, width: 600, height: 60 })
  }
  if (below) {
    mockRect(below, { left: 100, top: 470, width: 600, height: 60 })
  }
  if (nativeText) {
    const track = {
      kind: 'subtitles',
      mode: 'showing',
      language: 'en',
      id: 'track1',
      activeCues: [{ startTime: 0, text: nativeText }],
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }
    Object.defineProperty(video, 'textTracks', {
      configurable: true,
      value: {
        length: 1,
        0: track,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      },
    })
  }

  const transport = new FakeTransport()
  const engine = new DetectionEngine({
    document,
    window,
    documentId: 'doc_udemy',
    hostname: 'www.udemy.com',
    transport,
    visibility: new FakeVisibility(),
  })

  const presentations: Array<SubtitlePresentation | null> = []
  const events: string[] = []
  const samples: Array<{ text: string; kind: SourceKind }> = []
  engine.subscribePresentation((presentation) => {
    presentations.push(presentation)
    events.push('presentation')
  })
  engine.subscribe((sample) => {
    samples.push({ text: sample.text, kind: sample.source.kind })
    events.push('sample')
  }, () => undefined)

  return {
    engine,
    transport,
    video,
    below,
    inside,
    mountRow: mountRowEl as HTMLElement | null,
    presentations,
    events,
    samples,
  }
}

function connectUdemy(fixture: PresentationFixture): void {
  fixture.engine.start()
  jest.advanceTimersByTime(200)
  fixture.engine.evaluateNow()
  jest.advanceTimersByTime(0)
  fixture.engine.evaluateNow()
}

describe('DetectionEngine presentation stream', () => {
  it('yerleşimi yeni metin örneğinden önce ve video altı olarak yayınlar', () => {
    const fixture = buildUdemyPresentationFixture({ mode: 'below' })
    connectUdemy(fixture)

    expect(fixture.engine.getStatus().phase).toBe('connected')
    const presentation = fixture.engine.getPresentation()
    expect(presentation?.mode).toBe('below-caption')
    expect(presentation?.anchor).toBe(fixture.below)
    expect(presentation?.source.sourceId).toBe(
      `player:udemy:${presentation?.source.videoId}:captions`,
    )
    expect(fixture.samples.length).toBeGreaterThanOrEqual(1)
    expect(fixture.events.slice(-2)).toEqual(['presentation', 'sample'])
    fixture.engine.stop()
  })

  it('well video altı bloğunu yerleşim ve metin kaynağı olarak yayınlar', () => {
    const fixture = buildUdemyPresentationFixture({ mode: 'well' })
    connectUdemy(fixture)

    expect(fixture.engine.getStatus().phase).toBe('connected')
    const presentation = fixture.engine.getPresentation()
    expect(presentation?.mode).toBe('below-caption')
    expect(presentation?.anchor).toBe(fixture.below)
    expect(presentation?.mountAfter).toBe(fixture.mountRow)
    expect(fixture.samples.at(-1)?.text).toBe('Same caption')
    expect(fixture.samples.at(-1)?.kind).toBe('player-dom')

    const candidate = fixture.transport.last?.candidates.find(
      (item) => item.source.kind === 'player-dom',
    )
    expect(candidate?.score).toBeGreaterThanOrEqual(80)
    expect(candidate?.source.sourceId).toBe(
      `player:udemy:${candidate?.source.videoId}:captions`,
    )
    fixture.engine.stop()
  })

  it('normal -> genişletilmiş -> normal görünümde well kaynağı kalır', () => {
    const fixture = buildUdemyPresentationFixture({ mode: 'well' })
    connectUdemy(fixture)
    expect(fixture.engine.getStatus().phase).toBe('connected')
    const first = fixture.engine.getPresentation()
    expect(first?.anchor).toBe(fixture.below)
    expect(first?.mountAfter).toBe(fixture.mountRow)
    expect(fixture.samples.at(-1)?.text).toBe('Same caption')
    const sourceId = first?.source.sourceId
    const generation = first?.source.generation
    const presentationCount = fixture.presentations.length
    const sampleCount = fixture.samples.length
    const grantCount = fixture.transport.grants.length

    const content = document.getElementById('app-content') as HTMLElement
    content.classList.add(
      'curriculum-item-view--no-sidebar--LGmz-',
      'app--no-sidebar--oqmAw',
    )
    fixture.engine.evaluateNow()

    expect(fixture.engine.getStatus().phase).toBe('connected')
    expect(fixture.engine.getPresentation()?.source.sourceId).toBe(sourceId)
    expect(fixture.engine.getPresentation()?.source.generation).toBe(generation)
    expect(fixture.engine.getPresentation()?.anchor).toBe(fixture.below)
    expect(fixture.engine.getPresentation()?.mountAfter).toBe(
      fixture.mountRow,
    )
    expect(fixture.presentations).toHaveLength(presentationCount)
    expect(fixture.samples).toHaveLength(sampleCount)
    expect(fixture.transport.grants).toHaveLength(grantCount)

    content.classList.remove(
      'curriculum-item-view--no-sidebar--LGmz-',
      'app--no-sidebar--oqmAw',
    )
    fixture.engine.evaluateNow()
    expect(fixture.engine.getStatus().phase).toBe('connected')
    expect(fixture.engine.getPresentation()?.anchor).toBe(fixture.below)
    expect(fixture.engine.getPresentation()?.mountAfter).toBe(
      fixture.mountRow,
    )
    expect(fixture.engine.getStatus().reason).not.toBe('subtitle-not-found')
    fixture.engine.stop()
  })

  it('fullscreen içindeki anchor’ın dış mount hedefini korur', () => {
    const fixture = buildUdemyPresentationFixture({ mode: 'well' })
    connectUdemy(fixture)
    const row = fixture.mountRow as HTMLElement
    const player = document.getElementById('player') as HTMLElement
    const fullscreenRoot = document.createElement('div')
    fullscreenRoot.id = 'engine-fullscreen-root'
    fullscreenRoot.className =
      'curriculum-item-view--content--aaJOw curriculum-item-fullscreen--X'
    row.appendChild(fullscreenRoot)
    fullscreenRoot.appendChild(player)
    fullscreenRoot.appendChild(fixture.below as HTMLElement)

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: fullscreenRoot,
    })
    document.dispatchEvent(new Event('fullscreenchange'))
    jest.advanceTimersByTime(0)
    fixture.engine.evaluateNow()

    const presentation = fixture.engine.getPresentation()
    expect(presentation?.mode).toBe('below-caption')
    expect(presentation?.anchor).toBe(fixture.below)
    // Dışarıdaki mount hedefi fullscreen nedeniyle erken null yapılmaz.
    expect(presentation?.mountAfter).toBe(row)

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    })
    document.dispatchEvent(new Event('fullscreenchange'))
    jest.advanceTimersByTime(0)
    fixture.engine.evaluateNow()
    expect(fixture.engine.getPresentation()?.mountAfter).toBe(row)
    fixture.engine.stop()
  })

  it('anchor kalıcı kopunca kurtarma sonrası floating yayınlar, geri gelince below olur', () => {
    const fixture = buildUdemyPresentationFixture({ mode: 'well' })
    connectUdemy(fixture)
    const well = fixture.below as HTMLElement
    const row = fixture.mountRow as HTMLElement
    const wellParent = well.parentElement as HTMLElement

    well.remove()
    fixture.engine.evaluateNow()
    expect(fixture.engine.getPresentation()?.mode).toBe('below-caption')
    expect(fixture.engine.getPresentation()?.anchor).toBeNull()

    jest.advanceTimersByTime(1100)
    expect(fixture.engine.getPresentation()?.mode).toBe('floating')
    expect(fixture.engine.getPresentation()?.anchor).toBeNull()

    wellParent.appendChild(well)
    fixture.engine.evaluateNow()
    expect(fixture.engine.getPresentation()?.mode).toBe('below-caption')
    expect(fixture.engine.getPresentation()?.anchor).toBe(well)
    expect(fixture.engine.getPresentation()?.mountAfter).toBe(row)
    fixture.engine.stop()
  })

  it('resetAfterRestore motor geçmişini ve adaptör önbelleğini temizler', () => {
    const spy = jest.spyOn(UdemyAdapter.prototype, 'reset')
    try {
      const fixture = buildUdemyPresentationFixture({ mode: 'well' })
      connectUdemy(fixture)
      expect((fixture.engine as any).histories.size).toBeGreaterThan(0)
      expect((fixture.engine as any).lastKnown.size).toBeGreaterThan(0)

      fixture.engine.resetAfterRestore()

      expect(spy).toHaveBeenCalled()
      expect((fixture.engine as any).histories.size).toBe(0)
      expect((fixture.engine as any).lastKnown.size).toBe(0)
      fixture.engine.stop()
    } finally {
      spy.mockRestore()
    }
  })

  it('mount satırı yokken below niyeti floating’e dönmez', () => {
    const fixture = buildUdemyPresentationFixture({
      mode: 'well',
      mountRow: 'missing',
    })
    connectUdemy(fixture)

    const presentation = fixture.engine.getPresentation()
    expect(presentation?.mode).toBe('below-caption')
    expect(presentation?.anchor).toBe(fixture.below)
    expect(presentation?.mountAfter).toBeNull()
    fixture.engine.stop()
  })

  it('mount satırı değişince yalnız presentation yenilenir', () => {
    const fixture = buildUdemyPresentationFixture({ mode: 'well' })
    connectUdemy(fixture)
    const presentationCount = fixture.presentations.length
    const sampleCount = fixture.samples.length
    const grantCount = fixture.transport.grants.length
    const oldRow = fixture.mountRow as HTMLElement
    const player = document.getElementById('player') as HTMLElement
    const content = document.getElementById(
      'app-content',
    ) as HTMLElement

    const nextRow = document.createElement('div')
    nextRow.id = 'mount-row-next'
    nextRow.className = 'app--body-container--NEXT1'
    oldRow.replaceWith(nextRow)
    nextRow.appendChild(player)
    nextRow.appendChild(fixture.below as HTMLElement)
    mockRect(nextRow, { left: 0, top: 0, width: 800, height: 520 })

    fixture.engine.evaluateNow()
    expect(fixture.presentations).toHaveLength(presentationCount + 1)
    expect(fixture.presentations.at(-1)?.mountAfter).toBe(nextRow)
    expect(fixture.presentations.at(-1)?.anchor).toBe(fixture.below)
    expect(fixture.samples).toHaveLength(sampleCount)
    expect(fixture.transport.grants).toHaveLength(grantCount)
    expect(nextRow.parentElement).toBe(content)
    fixture.engine.stop()
  })

  it('well bloğu eklenince video altına, kaldırılınca video içine döner', () => {
    const fixture = buildUdemyPresentationFixture({ mode: 'inside' })
    connectUdemy(fixture)
    expect(fixture.engine.getPresentation()?.mode).toBe('floating')

    const well = document.createElement('div')
    well.id = 'well'
    well.className = 'well-module--container--9Y7tq'
    well.innerHTML =
      '<span class="well-module--text--pTRTZ">Same caption</span>'
    document.getElementById('lesson')?.appendChild(well)
    mockRect(well, { left: 100, top: 470, width: 600, height: 60 })
    jest.advanceTimersByTime(350)
    fixture.engine.evaluateNow()

    expect(fixture.engine.getPresentation()?.mode).toBe('below-caption')
    expect(fixture.engine.getPresentation()?.anchor).toBe(well)

    well.remove()
    jest.advanceTimersByTime(350)
    fixture.engine.evaluateNow()
    expect(fixture.engine.getPresentation()?.mode).toBe('floating')
    expect(fixture.engine.getPresentation()?.anchor).toBeNull()
    fixture.engine.stop()
  })

  it('aynı yerleşimi tekrar yayınlamaz; yeni aboneye mevcut değeri verir', () => {
    const fixture = buildUdemyPresentationFixture({ mode: 'below' })
    connectUdemy(fixture)
    const count = fixture.presentations.length

    fixture.engine.evaluateNow()
    fixture.engine.evaluateNow()
    expect(fixture.presentations).toHaveLength(count)

    const late: Array<SubtitlePresentation | null> = []
    fixture.engine.subscribePresentation((presentation) => {
      late.push(presentation)
    })
    expect(late).toHaveLength(1)
    expect(late[0]?.anchor).toBe(fixture.below)
    fixture.engine.stop()
  })

  it('DOM hedefi yenilenince yalnızca anchor değişikliğini bildirir', () => {
    const fixture = buildUdemyPresentationFixture({ mode: 'below' })
    connectUdemy(fixture)
    const sampleCount = fixture.samples.length
    const count = fixture.presentations.length

    const replacement = document.createElement('div')
    replacement.id = 'below-replacement'
    replacement.setAttribute('data-purpose', 'captions-display')
    replacement.textContent = 'Same caption'
    fixture.below?.remove()
    document.getElementById('lesson')?.appendChild(replacement)
    mockRect(replacement, { left: 100, top: 470, width: 600, height: 60 })

    fixture.engine.evaluateNow()
    expect(fixture.presentations).toHaveLength(count + 1)
    expect(fixture.presentations[count]?.mode).toBe('below-caption')
    expect(fixture.presentations[count]?.anchor).toBe(replacement)
    expect(fixture.samples).toHaveLength(sampleCount)
    fixture.engine.stop()
  })

  it('aynı metinle mod değişimini bildirir ve yeni örnek üretmez', () => {
    const fixture = buildUdemyPresentationFixture({ mode: 'inside' })
    connectUdemy(fixture)
    expect(fixture.engine.getPresentation()?.mode).toBe('floating')
    const sampleCount = fixture.samples.length
    const count = fixture.presentations.length

    fixture.inside?.remove()
    const below = document.createElement('div')
    below.id = 'below'
    below.setAttribute('data-purpose', 'captions-display')
    below.textContent = 'Same caption'
    document.getElementById('lesson')?.appendChild(below)
    mockRect(below, { left: 100, top: 470, width: 600, height: 60 })
    // Dış arama negatif cache'i (300 ms) sona ersin.
    jest.advanceTimersByTime(350)

    fixture.engine.evaluateNow()
    expect(fixture.presentations).toHaveLength(count + 1)
    expect(fixture.presentations[count]?.mode).toBe('below-caption')
    expect(fixture.presentations[count]?.anchor).toBe(below)
    expect(fixture.samples).toHaveLength(sampleCount)
    fixture.engine.stop()
  })

  it('native track metin kaynağında da aynı videonun Udemy anchorını çözer', () => {
    const fixture = buildUdemyPresentationFixture({
      mode: 'well',
      nativeText: 'Native caption',
    })
    connectUdemy(fixture)

    expect(fixture.transport.grants[0].source.kind).toBe('text-track')
    expect(fixture.samples.at(-1)?.text).toBe('Native caption')
    expect(fixture.engine.getPresentation()?.mode).toBe('below-caption')
    expect(fixture.engine.getPresentation()?.anchor).toBe(fixture.below)
    expect(fixture.engine.getPresentation()?.mountAfter).toBe(
      fixture.mountRow,
    )
    fixture.engine.stop()
  })

  it('yetki kaybı, stop ve dispose yerleşimi null yapar', () => {
    const fixture = buildUdemyPresentationFixture({ mode: 'below' })
    connectUdemy(fixture)
    expect(fixture.engine.getPresentation()).not.toBeNull()

    fixture.transport.revoke('authority-lost')
    expect(fixture.engine.getPresentation()).toBeNull()
    expect(fixture.presentations.at(-1)).toBeNull()

    connectUdemy(fixture)
    expect(fixture.engine.getPresentation()).not.toBeNull()
    fixture.engine.stop()
    expect(fixture.engine.getPresentation()).toBeNull()
    expect(fixture.presentations.at(-1)).toBeNull()

    connectUdemy(fixture)
    expect(fixture.engine.getPresentation()).not.toBeNull()
    fixture.engine.dispose()
    expect(fixture.engine.getPresentation()).toBeNull()
  })

  it('anchor kaybolunca native metin sürerken floating yerleşime döner', () => {
    const fixture = buildUdemyPresentationFixture({
      mode: 'below',
      nativeText: 'Native caption',
    })
    connectUdemy(fixture)
    expect(fixture.engine.getPresentation()?.mode).toBe('below-caption')
    const sampleCount = fixture.samples.length

    fixture.below?.remove()
    fixture.engine.evaluateNow()

    expect(fixture.engine.getStatus().phase).toBe('connected')
    expect(fixture.engine.getPresentation()?.mode).toBe('floating')
    expect(fixture.engine.getPresentation()?.anchor).toBeNull()
    expect(fixture.samples).toHaveLength(sampleCount)
    fixture.engine.stop()
  })

  it('native anchor çözümünü her değerlendirmede yeniden çalıştırmaz', () => {
    const spy = jest.spyOn(UdemyAdapter.prototype, 'resolveBelowVideoLayout')
    try {
      const fixture = buildUdemyPresentationFixture({
        mode: 'below',
        nativeText: 'Native caption',
      })
      connectUdemy(fixture)
      const callsAfterConnect = spy.mock.calls.length
      expect(callsAfterConnect).toBeGreaterThanOrEqual(1)

      fixture.engine.evaluateNow()
      fixture.engine.evaluateNow()
      fixture.engine.evaluateNow()
      expect(spy.mock.calls.length).toBe(callsAfterConnect)
      fixture.engine.stop()
    } finally {
      spy.mockRestore()
    }
  })

  it('native negatif anchor sonucu kısa süre cache’lenir', () => {
    const spy = jest.spyOn(UdemyAdapter.prototype, 'resolveBelowVideoLayout')
    try {
      const fixture = buildUdemyPresentationFixture({
        mode: 'inside',
        nativeText: 'Native caption',
      })
      connectUdemy(fixture)
      const callsAfterConnect = spy.mock.calls.length
      expect(callsAfterConnect).toBeGreaterThanOrEqual(1)

      fixture.engine.evaluateNow()
      fixture.engine.evaluateNow()
      expect(spy.mock.calls.length).toBe(callsAfterConnect)
      expect(fixture.engine.getPresentation()?.mode).toBe('floating')
      fixture.engine.stop()
    } finally {
      spy.mockRestore()
    }
  })

  it('native cache kullanımda mount satırı yapısal kurallarını doğrular', () => {
    const fixture = buildUdemyPresentationFixture({
      mode: 'well',
      nativeText: 'Native caption',
    })
    connectUdemy(fixture)
    expect(fixture.engine.getPresentation()?.mountAfter).toBe(
      fixture.mountRow,
    )

    const row = fixture.mountRow as HTMLElement
    const content = document.getElementById('app-content') as HTMLElement
    const wrongParent = document.createElement('div')
    content.appendChild(wrongParent)
    wrongParent.appendChild(row)
    fixture.engine.evaluateNow()

    // Row hâlâ bağlı/görünür ve anchor'ı içeriyor, ancak content-column
    // çocuğu değil; cache bu hedefi geçerli saymamalı.
    expect(fixture.engine.getStatus().phase).toBe('connected')
    expect(fixture.engine.getPresentation()?.mode).toBe('below-caption')
    expect(fixture.engine.getPresentation()?.mountAfter).toBeNull()
    fixture.engine.stop()
  })

  it('tam ekran değişimi below niyetini korur; görünümü manager yönetir', () => {
    const fixture = buildUdemyPresentationFixture({ mode: 'below' })
    connectUdemy(fixture)
    expect(fixture.engine.getPresentation()?.mode).toBe('below-caption')

    const player = document.getElementById('player') as HTMLElement
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: player,
    })
    document.dispatchEvent(new Event('fullscreenchange'))
    jest.advanceTimersByTime(200)
    fixture.engine.evaluateNow()

    // Dedektör below niyetini floating'e çevirmez; anchor kaynak olarak
    // kullanılabilir kalır. Tam ekran floating'i manager'ın kontrollü
    // istisnasıdır.
    expect(fixture.engine.getPresentation()?.mode).toBe('below-caption')
    expect(fixture.engine.getPresentation()?.anchor).toBe(fixture.below)

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    })
    document.dispatchEvent(new Event('fullscreenchange'))
    jest.advanceTimersByTime(200)
    fixture.engine.evaluateNow()
    expect(fixture.engine.getPresentation()?.mode).toBe('below-caption')
    fixture.engine.stop()
  })
})





