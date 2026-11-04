import { UdemyAdapter } from '../adapters/udemy'
import { YouTubeAdapter } from '../adapters/youtube'
import { GenericDomAdapter } from '../adapters/generic-dom'
import { AdapterContext } from '../adapters/types'
import { VideoEntry } from '../video-registry'
import { scoreCandidate } from '../scoring'
import { isBelowVideoRelation } from '../text'

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

function makeVideo(): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperty(video, 'paused', {
    configurable: true,
    get: () => false,
  })
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => 1,
  })
  Object.defineProperty(video, 'currentSrc', {
    configurable: true,
    get: () => 'https://example.com/video.mp4',
  })
  return video
}

function makeEntry(
  video: HTMLVideoElement,
  rect: { left: number; top: number; width: number; height: number } = {
    left: 0,
    top: 0,
    width: 800,
    height: 450,
  },
): VideoEntry {
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
    visibleArea: rect.width * rect.height,
    rect,
    lastSeenAt: 0,
  }
}

function makeContext(entry: VideoEntry, hostname: string): AdapterContext {
  return {
    entry,
    document,
    window,
    now: 1000,
    hostname,
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('UdemyAdapter', () => {
  function buildDom(): {
    video: HTMLVideoElement
    player: HTMLElement
    caption: HTMLElement
  } {
    document.body.innerHTML = `
      <div class="shaka-video-container" id="player">
        <video id="video"></video>
        <div class="shaka-text-container" id="caption"><span>Hello from Udemy</span></div>
      </div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
    const player = document.getElementById('player') as HTMLElement
    const caption = document.getElementById('caption') as HTMLElement
    mockRect(video, { left: 0, top: 0, width: 800, height: 450 })
    mockRect(player, { left: 0, top: 0, width: 800, height: 450 })
    mockRect(caption, { left: 100, top: 350, width: 600, height: 60 })
    return { video, player, caption }
  }

  it('Shaka altyazı kapsayıcısını doğrulanmış kaynak olarak okur', () => {
    const { video } = buildDom()
    const adapter = new UdemyAdapter()
    const candidate = adapter.getCandidate(makeContext(makeEntry(video), 'www.udemy.com'))
    expect(candidate).not.toBeNull()
    expect(candidate?.text).toBe('Hello from Udemy')
    expect(candidate?.kind).toBe('player-dom')
    expect(candidate?.evidence.verifiedPlayerContainer).toBe(true)
    expect(candidate?.evidence.sharesPlayerContainer).toBe(true)
    expect(candidate?.invalidReason).toBeUndefined()
  })

  it('aynı sınıf adını taşıyan menüyü altyazıdan ayırır', () => {
    const { video } = buildDom()
    const player = document.getElementById('player') as HTMLElement
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    menu.innerHTML =
      '<div class="shaka-text-container"><span>Settings menu</span></div>'
    player.appendChild(menu)
    mockRect(menu, { left: 0, top: 0, width: 200, height: 200 })
    mockRect(menu.firstElementChild as HTMLElement, {
      left: 0,
      top: 0,
      width: 200,
      height: 200,
    })

    const candidate = new UdemyAdapter().getCandidate(
      makeContext(makeEntry(video), 'www.udemy.com'),
    )
    expect(candidate?.text).toBe('Hello from Udemy')
  })

  it('transkript içindeki kapsayıcıyı kaynak kabul etmez', () => {
    document.body.innerHTML = `
      <div class="shaka-video-container" id="player">
        <video id="video"></video>
        <div data-purpose="transcript">
          <div class="shaka-text-container" id="transcript-cue"><span>Transcript line</span></div>
        </div>
      </div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
    const player = document.getElementById('player') as HTMLElement
    mockRect(video, { left: 0, top: 0, width: 800, height: 450 })
    mockRect(player, { left: 0, top: 0, width: 800, height: 450 })
    mockRect(document.getElementById('transcript-cue') as HTMLElement, {
      left: 0,
      top: 0,
      width: 600,
      height: 60,
    })

    expect(
      new UdemyAdapter().getCandidate(
        makeContext(makeEntry(video), 'www.udemy.com'),
      ),
    ).toBeNull()
  })

  it('altyazı kapsayıcısı yeniden oluşturulsa da kaynak kimliği korunur', () => {
    const { video, player, caption } = buildDom()
    const adapter = new UdemyAdapter()
    const first = adapter.getCandidate(
      makeContext(makeEntry(video), 'www.udemy.com'),
    )
    caption.remove()
    const replacement = document.createElement('div')
    replacement.className = 'shaka-text-container'
    replacement.innerHTML = '<span>New container</span>'
    player.appendChild(replacement)
    mockRect(replacement, { left: 100, top: 350, width: 600, height: 60 })
    const second = adapter.getCandidate(
      makeContext(makeEntry(video), 'www.udemy.com'),
    )
    expect(first?.sourceId).toBe(second?.sourceId)
    expect(second?.text).toBe('New container')
  })

  function buildBelowDom(options: {
    text?: string
    gap?: number
    left?: number
    width?: number
    inner?: string
    dataPurpose?: string
  } = {}): {
    video: HTMLVideoElement
    player: HTMLElement
    caption: HTMLElement
  } {
    const {
      text = 'Below video caption',
      gap = 20,
      left = 100,
      width = 600,
      inner = '',
      dataPurpose = 'captions-display',
    } = options
    document.body.innerHTML = `
      <div id="lesson">
        <div class="shaka-video-container" id="player">
          <video id="video"></video>
          ${inner}
        </div>
        <div data-purpose="${dataPurpose}" id="below">${text}</div>
      </div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
    const player = document.getElementById('player') as HTMLElement
    const caption = document.getElementById('below') as HTMLElement
    mockRect(video, { left: 0, top: 0, width: 800, height: 450 })
    mockRect(player, { left: 0, top: 0, width: 800, height: 450 })
    mockRect(document.getElementById('lesson') as HTMLElement, {
      left: 0,
      top: 0,
      width: 800,
      height: 700,
    })
    mockRect(caption, { left, top: 450 + gap, width, height: 60 })
    return { video, player, caption }
  }

  it('video altındaki doğrulanmış bloğu video altı yerleşim hedefi yapar', () => {
    const { video, caption } = buildBelowDom()
    const candidate = new UdemyAdapter().getCandidate(
      makeContext(makeEntry(video), 'www.udemy.com'),
    )

    expect(candidate).not.toBeNull()
    expect(candidate?.text).toBe('Below video caption')
    expect(candidate?.sourceId).toBe('player:udemy:video_1:captions')
    expect(candidate?.evidence.verifiedBelowVideoRelation).toBe(true)
    // Oynatıcı dışındaki blok "doğrulanmış oynatıcı kapsayıcısı" sayılmaz.
    expect(candidate?.evidence.verifiedPlayerContainer).toBe(false)
    expect(candidate?.evidence.verifiedCaptionBlock).toBe(true)
    // Blok videoyla örtüşmez; bağlantı geometri dışındaki kanıtla kurulur.
    expect(candidate?.evidence.strongGeometry).toBe(false)
    expect(scoreCandidate(candidate!.evidence)).toBeGreaterThanOrEqual(80)
    expect(candidate?.presentation?.mode).toBe('below-caption')
    expect(candidate?.presentation?.anchor).toBe(caption)
  })

  it('video altı yerleşim hedefini native track için de çözer', () => {
    const { video, caption } = buildBelowDom()
    const adapter = new UdemyAdapter()
    expect(
      adapter.resolveBelowVideoLayout(
        makeContext(makeEntry(video), 'www.udemy.com'),
      )?.element,
    ).toBe(caption)
  })

  /** Udemy'nin gerçek video altı well DOM'u (hash son ekleri değişken). */
  function buildWellDom(options: {
    containerHash?: string
    textHash?: string
    text?: string
    gap?: number
    left?: number
    width?: number
    insidePlayer?: boolean
    hidden?: boolean
  } = {}): {
    video: HTMLVideoElement
    player: HTMLElement
    container: HTMLElement
    well: HTMLElement
    wellText: HTMLElement
  } {
    const {
      containerHash = '9Y7tq',
      textHash = 'pTRTZ',
      text = 'Well caption text',
      gap = 0,
      left = 0,
      width = 2378,
      insidePlayer = false,
      hidden = false,
    } = options
    const playerClass = `video-player-module--video-player--ZGjpj${
      insidePlayer ? ' shaka-video-container' : ''
    }`
    document.body.innerHTML = `
      <div id="lesson">
        <div id="player" data-purpose="shaka-video-player" class="${playerClass}">
          <div id="video-container" class="video-player-module--video-container--dsN0B">
            <video id="video"></video>
          </div>
          <div id="well" class="well-module--container--${containerHash}"${
            hidden ? ' style="display:none"' : ''
          }>
            <span id="well-text" class="well-module--text--${textHash}">${text}</span>
          </div>
        </div>
      </div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
    const player = document.getElementById('player') as HTMLElement
    const container = document.getElementById(
      'video-container',
    ) as HTMLElement
    const well = document.getElementById('well') as HTMLElement
    const wellText = document.getElementById('well-text') as HTMLElement
    mockRect(video, { left: 0, top: 56, width: 2378, height: 895 })
    mockRect(container, { left: 0, top: 56, width: 2378, height: 895 })
    mockRect(player, { left: 0, top: 56, width: 2378, height: 991 })
    mockRect(document.getElementById('lesson') as HTMLElement, {
      left: 0,
      top: 0,
      width: 2378,
      height: 1100,
    })
    mockRect(well, { left, top: 951 + gap, width, height: 96 })
    // Dar metin span'ı videoyla hizasız; geometri dış blokta ölçülmeli.
    mockRect(wellText, {
      left: left + Math.max(0, width / 2 - 150),
      top: 960 + gap,
      width: 300,
      height: 40,
    })
    return { video, player, container, well, wellText }
  }

  function makeWellContext(video: HTMLVideoElement): AdapterContext {
    return makeContext(
      makeEntry(video, { left: 0, top: 56, width: 2378, height: 895 }),
      'www.udemy.com',
    )
  }

  /** Gerçek Udemy dış satırını ve kırpma katmanlarını temsil eden fixture. */
  function buildWellMountDom(options: {
    mount?: 'valid' | 'missing' | 'wrongParent' | 'hidden' | 'otherVideo'
    rowHash?: string
    columnHash?: string
    expanded?: boolean
  } = {}): {
    video: HTMLVideoElement
    well: HTMLElement
    row: HTMLElement | null
    content: HTMLElement
    clipOuter: HTMLElement
    tabs: HTMLElement
  } {
    const {
      mount = 'valid',
      rowHash = 'RJZF2',
      columnHash = 'LnPGp',
      expanded = false,
    } = options
    const well = `
      <div id="well" class="well-module--container--9Y7tq">
        <span class="well-module--text--pTRTZ">Mount target caption</span>
      </div>
    `
    const player = (withWell: boolean): string => `
      <div id="player" data-purpose="shaka-video-player" class="video-player-module--video-player--ZGjpj">
        <div id="video-container" class="video-player-module--video-container--dsN0B">
          <video id="video"></video>
        </div>
        ${withWell ? well : ''}
      </div>
    `
    const viewClass = expanded
      ? ' curriculum-item-view--no-sidebar--LGmz-'
      : ''
    const clipped = (withWell: boolean): string => `
      <div id="clip-outer" class="curriculum-item-view--scaled-height-limiter--lEOjL${viewClass}" style="overflow:hidden">
        <div id="clip-inner" class="video-viewer--container--3yIje" style="overflow:hidden">
          ${player(withWell)}
        </div>
      </div>
    `
    const rowClass = `app--body-container--${rowHash}`
    let body = ''
    if (mount === 'missing') {
      body = clipped(true)
    } else if (mount === 'wrongParent') {
      body = `<div id="wrong-column">${`<div id="mount-row" class="${rowClass}">${clipped(true)}</div>`}</div>`
    } else if (mount === 'hidden') {
      body = `<div id="mount-row" class="${rowClass}" style="display:none">${clipped(true)}</div>`
    } else if (mount === 'otherVideo') {
      body = `
        ${player(false)}
        <div id="mount-row" class="${rowClass}">
          <video id="other-video"></video>
          ${well}
        </div>
      `
    } else {
      body = `<div id="mount-row" class="${rowClass}">${clipped(true)}</div>`
    }

    document.body.innerHTML = `
      <div id="lesson">
        <div id="app-content" class="app--content-column--${columnHash}${
          expanded ? ' app--no-sidebar--oqmAw' : ''
        }">
          ${body}
          <div id="tabs">Comments and learning tools</div>
        </div>
      </div>
    `

    const video = document.getElementById('video') as HTMLVideoElement
    const row = document.getElementById('mount-row')
    const content = document.getElementById('app-content') as HTMLElement
    const clipOuter = document.getElementById('clip-outer') as HTMLElement
    const tabs = document.getElementById('tabs') as HTMLElement
    const wellElement = document.getElementById('well') as HTMLElement

    mockRect(video, { left: 0, top: 56, width: 2378, height: 895 })
    mockRect(document.getElementById('video-container') as HTMLElement, {
      left: 0,
      top: 56,
      width: 2378,
      height: 895,
    })
    mockRect(document.getElementById('player') as HTMLElement, {
      left: 0,
      top: 56,
      width: 2378,
      height: 991,
    })
    if (clipOuter) {
      mockRect(clipOuter, {
        left: 0,
        top: 56,
        width: 2378,
        height: 991,
      })
    }
    mockRect(content, { left: 0, top: 0, width: 2378, height: 1100 })
    mockRect(document.getElementById('lesson') as HTMLElement, {
      left: 0,
      top: 0,
      width: 2378,
      height: 1200,
    })
    mockRect(wellElement, { left: 0, top: 951, width: 2378, height: 96 })
    if (row) {
      mockRect(row as HTMLElement, {
        left: 0,
        top: mount === 'otherVideo' ? 951 : 56,
        width: 2378,
        height: mount === 'otherVideo' ? 96 : 991,
      })
    }
    mockRect(tabs, { left: 0, top: 1047, width: 2378, height: 100 })
    const otherVideo = document.getElementById(
      'other-video',
    ) as HTMLVideoElement | null
    if (otherVideo) {
      mockRect(otherVideo, { left: 0, top: 951, width: 100, height: 20 })
    }

    return {
      video,
      well: wellElement,
      row: row as HTMLElement | null,
      content,
      clipOuter,
      tabs,
    }
  }

  it('gerçek well DOM’unda dış bloğu kaynak ve yerleşim anchor’ı yapar', () => {
    const { video, well } = buildWellDom()
    const candidate = new UdemyAdapter().getCandidate(makeWellContext(video))

    expect(candidate).not.toBeNull()
    expect(candidate?.text).toBe('Well caption text')
    expect(candidate?.element).toBe(well)
    expect(candidate?.rect).toEqual({
      left: 0,
      top: 951,
      width: 2378,
      height: 96,
    })
    expect(candidate?.sourceId).toBe('player:udemy:video_1:captions')
    expect(candidate?.evidence.verifiedCaptionBlock).toBe(true)
    expect(candidate?.evidence.verifiedBelowVideoRelation).toBe(true)
    expect(candidate?.presentation?.mode).toBe('below-caption')
    expect(candidate?.presentation?.anchor).toBe(well)
    expect(scoreCandidate(candidate!.evidence)).toBeGreaterThanOrEqual(80)
  })

  it('well blok hash son eki değişse de bulunur ve dış blokta kalır', () => {
    const suffixes = ['9Y7tq', 'AbC123', 'z9K2mQ']
    suffixes.forEach((suffix, index) => {
      const { video, well } = buildWellDom({
        containerHash: suffix,
        textHash: `text${index}`,
        text: `Hash caption ${index}`,
      })
      const candidate = new UdemyAdapter().getCandidate(makeWellContext(video))
      expect(candidate?.text).toBe(`Hash caption ${index}`)
      expect(candidate?.presentation?.anchor).toBe(well)
      expect(well.className).toBe(`well-module--container--${suffix}`)
    })
  })

  it('playerRoot içindeki well bloğunu playerRoot nedeniyle reddetmez', () => {
    const { video, well } = buildWellDom({ insidePlayer: true })
    const candidate = new UdemyAdapter().getCandidate(makeWellContext(video))

    expect(candidate?.element).toBe(well)
    expect(candidate?.presentation?.mode).toBe('below-caption')
    expect(candidate?.presentation?.anchor).toBe(well)
    expect(candidate?.evidence.verifiedCaptionBlock).toBe(true)
  })

  it('dar well metin span’ı yerine dış blok geometrisini kullanır', () => {
    const { video, well, wellText } = buildWellDom()
    const candidate = new UdemyAdapter().getCandidate(makeWellContext(video))

    // Span videoyla yatay olarak yeterince örtüşmez; blok örtüşür.
    expect(candidate?.element).toBe(well)
    expect(candidate?.element).not.toBe(wellText)
    expect(candidate?.presentation?.anchor).toBe(well)
    expect(candidate?.evidence.verifiedBelowVideoRelation).toBe(true)
  })

  it('well için güvenli app satırını mountAfter olarak seçer', () => {
    const { video, well, row, content, clipOuter } = buildWellMountDom()
    const candidate = new UdemyAdapter().getCandidate(makeWellContext(video))

    expect(candidate?.text).toBe('Mount target caption')
    expect(candidate?.element).toBe(well)
    expect(candidate?.presentation?.anchor).toBe(well)
    expect(candidate?.presentation?.mountAfter).toBe(row)
    expect(row?.parentElement).toBe(content)
    expect(row?.contains(video)).toBe(true)
    expect(row?.contains(well)).toBe(true)
    // Mount satırı kırpma yapan iç katmanların dışında kalır.
    expect(row?.contains(clipOuter)).toBe(true)
    expect(clipOuter.contains(row as HTMLElement)).toBe(false)
    expect(scoreCandidate(candidate!.evidence)).toBeGreaterThanOrEqual(80)
  })

  it('genişletilmiş no-sidebar görünümünde well kaynağını okur', () => {
    const fixture = buildWellMountDom({ expanded: true })
    const candidate = new UdemyAdapter().getCandidate(
      makeWellContext(fixture.video),
    )
    expect(candidate).not.toBeNull()
    expect(candidate?.text).toBe('Mount target caption')
    expect(candidate?.presentation?.anchor).toBe(fixture.well)
    expect(candidate?.presentation?.mountAfter).toBe(fixture.row)
    expect(candidate?.sourceId).toBe('player:udemy:video_1:captions')
    expect(candidate?.evidence.verifiedBelowVideoRelation).toBe(true)
  })

  it('derin Udemy ata zincirinde dış satırı bulur', () => {
    const fixture = buildWellMountDom()
    const player = document.getElementById('player') as HTMLElement
    const clipInner = document.getElementById('clip-inner') as HTMLElement
    let parent = clipInner
    for (let i = 0; i < 10; i += 1) {
      const wrapper = document.createElement('div')
      wrapper.className = `deep-local-wrapper-${i}`
      parent.appendChild(wrapper)
      parent = wrapper
    }
    parent.appendChild(player)

    const candidate = new UdemyAdapter().getCandidate(
      makeWellContext(fixture.video),
    )
    expect(candidate?.presentation?.anchor).toBe(fixture.well)
    expect(candidate?.presentation?.mountAfter).toBe(fixture.row)
  })

  it('cue metin span’ı olmayan duyuru/Q&A well kutusunu altyazı saymaz', () => {
    const fixture = buildWellMountDom()
    fixture.well
      .querySelector('.well-module--text--pTRTZ')
      ?.remove()
    fixture.well.textContent = 'Duyuru metni'

    expect(
      new UdemyAdapter().getCandidate(makeWellContext(fixture.video)),
    ).toBeNull()
  })

  it('well içindeki cue data-purpose span’ını metin kaynağı olarak kabul eder', () => {
    const fixture = buildWellMountDom()
    const text = fixture.well.querySelector(
      '.well-module--text--pTRTZ',
    ) as HTMLElement
    text.className = ''
    text.setAttribute('data-purpose', 'captions-cue-text')
    text.textContent = 'Cue span caption'

    const candidate = new UdemyAdapter().getCandidate(
      makeWellContext(fixture.video),
    )
    expect(candidate?.text).toBe('Cue span caption')
    expect(candidate?.presentation?.anchor).toBe(fixture.well)
    expect(candidate?.presentation?.mountAfter).toBe(fixture.row)
  })

  it('geçici geçersiz iç app satırını atlayıp dıştaki geçerli satırı seçer', () => {
    document.body.innerHTML = `
      <div id="lesson">
        <div id="app-content" class="app--content-column--LnPGp">
          <div id="outer-row" class="app--body-container--OUTER">
            <div id="inner-row" class="app--body-container--INNER">
              <div id="player" data-purpose="shaka-video-player" class="video-player-module--video-player--ZGjpj">
                <div id="video-container" class="video-player-module--video-container--dsN0B">
                  <video id="video"></video>
                </div>
                <div id="well" class="well-module--container--9Y7tq">
                  <span class="well-module--text--pTRTZ">Nested mount caption</span>
                </div>
              </div>
            </div>
          </div>
          <div id="tabs">Comments</div>
        </div>
      </div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
    const well = document.getElementById('well') as HTMLElement
    const outerRow = document.getElementById('outer-row') as HTMLElement
    mockRect(video, { left: 0, top: 56, width: 2378, height: 895 })
    mockRect(document.getElementById('video-container') as HTMLElement, {
      left: 0,
      top: 56,
      width: 2378,
      height: 895,
    })
    mockRect(document.getElementById('player') as HTMLElement, {
      left: 0,
      top: 56,
      width: 2378,
      height: 991,
    })
    mockRect(document.getElementById('inner-row') as HTMLElement, {
      left: 0,
      top: 56,
      width: 2378,
      height: 991,
    })
    mockRect(outerRow, {
      left: 0,
      top: 56,
      width: 2378,
      height: 991,
    })
    mockRect(document.getElementById('app-content') as HTMLElement, {
      left: 0,
      top: 0,
      width: 2378,
      height: 1100,
    })
    mockRect(document.getElementById('lesson') as HTMLElement, {
      left: 0,
      top: 0,
      width: 2378,
      height: 1200,
    })
    mockRect(well, { left: 0, top: 951, width: 2378, height: 96 })

    const candidate = new UdemyAdapter().getCandidate(makeWellContext(video))
    expect(candidate?.presentation?.anchor).toBe(well)
    expect(candidate?.presentation?.mountAfter).toBe(outerRow)
  })

  it('app satırı ve content column hash son ekleri değişse de bulunur', () => {
    const suffixes = [
      { rowHash: 'RJZF2', columnHash: 'LnPGp' },
      { rowHash: 'AbC123', columnHash: 'XyZ789' },
    ]
    suffixes.forEach(({ rowHash, columnHash }) => {
      const { video, row } = buildWellMountDom({ rowHash, columnHash })
      const candidate = new UdemyAdapter().getCandidate(makeWellContext(video))
      expect(candidate?.presentation?.mountAfter).toBe(row)
      expect(row?.className).toBe(`app--body-container--${rowHash}`)
      expect(row?.parentElement?.className).toBe(
        `app--content-column--${columnHash}`,
      )
    })
  })

  it('güvenli dış hedef yoksa mountAfter null döner', () => {
    const missing = buildWellMountDom({ mount: 'missing' })
    const missingCandidate = new UdemyAdapter().getCandidate(
      makeWellContext(missing.video),
    )
    expect(missingCandidate?.presentation?.anchor).toBe(missing.well)
    expect(missingCandidate?.presentation?.mountAfter).toBeNull()

    const wrongParent = buildWellMountDom({ mount: 'wrongParent' })
    const wrongCandidate = new UdemyAdapter().getCandidate(
      makeWellContext(wrongParent.video),
    )
    expect(wrongCandidate?.presentation?.mountAfter).toBeNull()

    const hidden = buildWellMountDom({ mount: 'hidden' })
    expect(
      new UdemyAdapter().getCandidate(makeWellContext(hidden.video)),
    ).toBeNull()

    const otherVideo = buildWellMountDom({ mount: 'otherVideo' })
    const otherCandidate = new UdemyAdapter().getCandidate(
      makeWellContext(otherVideo.video),
    )
    expect(otherCandidate?.presentation?.anchor).toBe(otherVideo.well)
    expect(otherCandidate?.presentation?.mountAfter).toBeNull()
  })

  it('legacy video altı blokta mountAfter undefined kalır', () => {
    const { video } = buildBelowDom()
    const candidate = new UdemyAdapter().getCandidate(
      makeContext(makeEntry(video), 'www.udemy.com'),
    )
    expect(candidate?.presentation?.mode).toBe('below-caption')
    expect(candidate?.presentation?.mountAfter).toBeUndefined()
  })

  it('native layout well anchor’ı ve mountAfter hedefini birlikte döndürür', () => {
    const { video, well, row } = buildWellMountDom()
    const adapter = new UdemyAdapter()
    const layout = adapter.resolveBelowVideoLayout(makeWellContext(video))
    expect(layout?.element).toBe(well)
    expect(layout?.mountAfter).toBe(row)
    expect(
      adapter.resolveBelowVideoLayout(makeWellContext(video))?.element,
    ).toBe(well)
  })

  it('video içi -> well video altı -> video içi geçişinde modu günceller', () => {
    document.body.innerHTML = `
      <div id="lesson">
        <div id="player" data-purpose="shaka-video-player" class="video-player-module--video-player--ZGjpj">
          <div id="video-container" class="video-player-module--video-container--dsN0B">
            <video id="video"></video>
            <div class="shaka-text-container" id="inside">Inside caption</div>
          </div>
        </div>
      </div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
    const player = document.getElementById('player') as HTMLElement
    mockRect(video, { left: 0, top: 56, width: 2378, height: 895 })
    mockRect(
      document.getElementById('video-container') as HTMLElement,
      { left: 0, top: 56, width: 2378, height: 895 },
    )
    mockRect(player, { left: 0, top: 56, width: 2378, height: 991 })
    mockRect(document.getElementById('lesson') as HTMLElement, {
      left: 0,
      top: 0,
      width: 2378,
      height: 1100,
    })
    mockRect(document.getElementById('inside') as HTMLElement, {
      left: 1000,
      top: 500,
      width: 300,
      height: 60,
    })

    const adapter = new UdemyAdapter()
    const context = makeWellContext(video)
    const first = adapter.getCandidate(context)
    expect(first?.presentation?.mode).toBe('floating')
    expect(first?.element).toBe(document.getElementById('inside'))

    const well = document.createElement('div')
    well.id = 'well'
    well.className = 'well-module--container--9Y7tq'
    well.innerHTML =
      '<span class="well-module--text--pTRTZ">Well caption</span>'
    player.appendChild(well)
    mockRect(well, { left: 0, top: 951, width: 2378, height: 96 })
    context.now += 500

    const second = adapter.getCandidate(context)
    expect(second?.presentation?.mode).toBe('below-caption')
    expect(second?.presentation?.anchor).toBe(well)
    expect(second?.text).toBe('Well caption')

    well.remove()
    context.now += 500
    const third = adapter.getCandidate(context)
    expect(third?.presentation?.mode).toBe('floating')
    expect(third?.element).toBe(document.getElementById('inside'))
  })

  it('cue aralığında well bloğu metinsiz kalsa da seçim ve anchor korunur', () => {
    const { video, well, wellText } = buildWellDom()
    const adapter = new UdemyAdapter()
    const context = makeWellContext(video)

    expect(adapter.getCandidate(context)?.presentation?.anchor).toBe(well)
    wellText.textContent = ''
    const empty = adapter.getCandidate(context)
    expect(empty?.text).toBe('')
    expect(empty?.presentation?.mode).toBe('below-caption')
    expect(empty?.presentation?.anchor).toBe(well)

    wellText.textContent = 'Next well caption'
    const next = adapter.getCandidate(context)
    expect(next?.text).toBe('Next well caption')
    expect(next?.presentation?.anchor).toBe(well)
    expect(next?.sourceId).toBe(empty?.sourceId)
  })

  it('kaldırılıp farklı hash ile yeniden oluşturulan well bloğunu bulur', () => {
    const { video, player, well } = buildWellDom()
    const adapter = new UdemyAdapter()
    const context = makeWellContext(video)
    const first = adapter.getCandidate(context)
    expect(first?.presentation?.anchor).toBe(well)

    well.remove()
    const replacement = document.createElement('div')
    replacement.id = 'well-replacement'
    replacement.className = 'well-module--container--NEW42'
    replacement.innerHTML =
      '<span class="well-module--text--NEW99">Recreated caption</span>'
    player.appendChild(replacement)
    mockRect(replacement, { left: 0, top: 951, width: 2378, height: 96 })
    context.now += 500

    const second = adapter.getCandidate(context)
    expect(second?.text).toBe('Recreated caption')
    expect(second?.presentation?.anchor).toBe(replacement)
    expect(second?.sourceId).toBe(first?.sourceId)
  })

  it('gizli, uzak veya hizasız well bloğunu kabul etmez', () => {
    const hidden = buildWellDom({ hidden: true })
    expect(
      new UdemyAdapter().getCandidate(
        makeWellContext(hidden.video),
      ),
    ).toBeNull()

    const far = buildWellDom({ gap: 200 })
    expect(
      new UdemyAdapter().getCandidate(
        makeWellContext(far.video),
      ),
    ).toBeNull()

    const misaligned = buildWellDom({ left: 2200, width: 200 })
    expect(
      new UdemyAdapter().getCandidate(
        makeWellContext(misaligned.video),
      ),
    ).toBeNull()
  })

  it('menü, transkript ve eklenti alanındaki well benzeri öğeleri dışlar', () => {
    const variants = [
      '<div data-purpose="transcript"><div class="well-module--container--BAD1"><span class="well-module--text--BAD2">Transcript well</span></div></div>',
      '<div role="menu"><div class="well-module--container--BAD1"><span class="well-module--text--BAD2">Menu well</span></div></div>',
      '<div id="udemy-translate-floating-subtitle" class="well-module--container--BAD1"><span class="well-module--text--BAD2">Plugin well</span></div>',
    ]

    for (const variant of variants) {
      document.body.innerHTML = `
        <div id="lesson">
          <div id="player" data-purpose="shaka-video-player" class="video-player-module--video-player--ZGjpj">
            <div class="video-player-module--video-container--dsN0B"><video id="video"></video></div>
            <div class="well-module--container--9Y7tq" id="well"><span class="well-module--text--pTRTZ">Real well</span></div>
          </div>
          ${variant}
        </div>
      `
      const video = document.getElementById('video') as HTMLVideoElement
      mockRect(video, { left: 0, top: 56, width: 2378, height: 895 })
      mockRect(document.getElementById('player') as HTMLElement, {
        left: 0,
        top: 56,
        width: 2378,
        height: 991,
      })
      mockRect(document.getElementById('lesson') as HTMLElement, {
        left: 0,
        top: 0,
        width: 2378,
        height: 1100,
      })
      mockRect(document.getElementById('well') as HTMLElement, {
        left: 0,
        top: 951,
        width: 2378,
        height: 96,
      })
      mockRect(
        document.querySelector('.well-module--container--BAD1') as HTMLElement,
        { left: 0, top: 1051, width: 2378, height: 60 },
      )

      const candidate = new UdemyAdapter().getCandidate(makeWellContext(video))
      expect(candidate?.text).toBe('Real well')
      expect(candidate?.presentation?.anchor).toBe(
        document.getElementById('well'),
      )
    }
  })

  it('iki videodan her birine kendi well bloğunu bağlar', () => {
    document.body.innerHTML = `
      <div id="lesson">
        <div id="wrap1">
          <div id="player1" data-purpose="shaka-video-player" class="video-player-module--video-player--ZGjpj">
            <div class="video-player-module--video-container--dsN0B"><video id="video1"></video></div>
            <div id="well1" class="well-module--container--AAA11"><span class="well-module--text--BBB11">First well</span></div>
          </div>
        </div>
        <div id="wrap2">
          <div id="player2" data-purpose="shaka-video-player" class="video-player-module--video-player--ZGjpj">
            <div class="video-player-module--video-container--dsN0B"><video id="video2"></video></div>
            <div id="well2" class="well-module--container--AAA22"><span class="well-module--text--BBB22">Second well</span></div>
          </div>
        </div>
      </div>
    `
    const video1 = document.getElementById('video1') as HTMLVideoElement
    const video2 = document.getElementById('video2') as HTMLVideoElement
    mockRect(video1, { left: 0, top: 0, width: 800, height: 450 })
    mockRect(video2, { left: 0, top: 650, width: 800, height: 450 })
    mockRect(document.getElementById('player1') as HTMLElement, {
      left: 0,
      top: 0,
      width: 800,
      height: 520,
    })
    mockRect(document.getElementById('player2') as HTMLElement, {
      left: 0,
      top: 650,
      width: 800,
      height: 520,
    })
    mockRect(document.getElementById('wrap1') as HTMLElement, {
      left: 0,
      top: 0,
      width: 800,
      height: 520,
    })
    mockRect(document.getElementById('wrap2') as HTMLElement, {
      left: 0,
      top: 650,
      width: 800,
      height: 520,
    })
    mockRect(document.getElementById('lesson') as HTMLElement, {
      left: 0,
      top: 0,
      width: 800,
      height: 1300,
    })
    mockRect(document.getElementById('well1') as HTMLElement, {
      left: 0,
      top: 450,
      width: 800,
      height: 60,
    })
    mockRect(document.getElementById('well2') as HTMLElement, {
      left: 0,
      top: 1100,
      width: 800,
      height: 60,
    })

    const adapter = new UdemyAdapter()
    const first = adapter.getCandidate(
      makeContext(
        makeEntry(video1, { left: 0, top: 0, width: 800, height: 450 }),
        'www.udemy.com',
      ),
    )
    const second = adapter.getCandidate(
      makeContext(
        makeEntry(video2, { left: 0, top: 650, width: 800, height: 450 }),
        'www.udemy.com',
      ),
    )
    expect(first?.text).toBe('First well')
    expect(first?.presentation?.anchor).toBe(
      document.getElementById('well1'),
    )
    expect(second?.text).toBe('Second well')
    expect(second?.presentation?.anchor).toBe(
      document.getElementById('well2'),
    )
  })

  it('video içi altyazıda video altı yerleşim hedefi üretmez', () => {
    const { video } = buildDom()
    expect(
      new UdemyAdapter().resolveBelowVideoLayout(
        makeContext(makeEntry(video), 'www.udemy.com'),
      ),
    ).toBeNull()
  })

  it('gizli video içi kopyayı okumaz, görünür video altı bloğu seçer', () => {
    const { video, caption } = buildBelowDom({
      inner:
        '<div class="shaka-text-container" style="display:none"><span>Hidden copy</span></div>',
    })
    const candidate = new UdemyAdapter().getCandidate(
      makeContext(makeEntry(video), 'www.udemy.com'),
    )
    expect(candidate?.text).toBe('Below video caption')
    expect(candidate?.presentation?.anchor).toBe(caption)
  })

  it('transkript, menü ve eklenti alanındaki video altı bloğu dışlar', () => {
    const variants = [
      '<div data-purpose="transcript"><div data-purpose="captions-display">Transcript</div></div>',
      '<div role="menu"><div data-purpose="captions-display">Menu</div></div>',
      '<div id="udemy-translate-floating-subtitle" data-purpose="captions-display">Plugin</div>',
      '<div class="comments"><div data-purpose="captions-display">Comment</div></div>',
    ]

    for (const variant of variants) {
      document.body.innerHTML = `
        <div id="lesson">
          <div class="shaka-video-container" id="player"><video id="video"></video></div>
          ${variant}
        </div>
      `
      const video = document.getElementById('video') as HTMLVideoElement
      mockRect(video, { left: 0, top: 0, width: 800, height: 450 })
      mockRect(document.getElementById('lesson') as HTMLElement, {
        left: 0,
        top: 0,
        width: 800,
        height: 700,
      })
      mockRect(
        document.querySelector('[data-purpose="captions-display"]') as HTMLElement,
        { left: 100, top: 470, width: 600, height: 60 },
      )

      expect(
        new UdemyAdapter().getCandidate(
          makeContext(makeEntry(video), 'www.udemy.com'),
        ),
      ).toBeNull()
    }
  })

  it('160 px uzak, video üstünde veya yatay hizasız bloğu kabul etmez', () => {
    const geometry = { left: 0, top: 0, width: 800, height: 450 }
    expect(isBelowVideoRelation({ left: 100, top: 620, width: 600, height: 40 }, geometry)).toBe(false)
    expect(isBelowVideoRelation({ left: 100, top: 300, width: 600, height: 40 }, geometry)).toBe(false)
    expect(isBelowVideoRelation({ left: 700, top: 470, width: 300, height: 40 }, geometry)).toBe(false)

    const far = buildBelowDom({ gap: 200 })
    expect(
      new UdemyAdapter().getCandidate(
        makeContext(makeEntry(far.video), 'www.udemy.com'),
      ),
    ).toBeNull()

    const misaligned = buildBelowDom({ left: 700, width: 300 })
    expect(
      new UdemyAdapter().getCandidate(
        makeContext(makeEntry(misaligned.video), 'www.udemy.com'),
      ),
    ).toBeNull()
  })

  it('aynı seçicideki geçersiz ilk öğe sonraki geçerli bloğu engellemez', () => {
    document.body.innerHTML = `
      <div id="lesson">
        <div class="shaka-video-container" id="player"><video id="video"></video></div>
        <div data-purpose="captions-display" id="above">Above video</div>
        <div data-purpose="captions-display" id="below">Valid below caption</div>
      </div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
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
    mockRect(document.getElementById('above') as HTMLElement, {
      left: 100,
      top: 100,
      width: 600,
      height: 60,
    })
    mockRect(document.getElementById('below') as HTMLElement, {
      left: 100,
      top: 470,
      width: 600,
      height: 60,
    })

    const candidate = new UdemyAdapter().getCandidate(
      makeContext(makeEntry(video), 'www.udemy.com'),
    )
    expect(candidate?.text).toBe('Valid below caption')
    expect(candidate?.presentation?.anchor).toBe(
      document.getElementById('below'),
    )
  })

  it('geniş caption sınıfı/verisi taşıyan ayar bloğunu altyazı sanmaz', () => {
    document.body.innerHTML = `
      <div id="lesson">
        <div class="shaka-video-container" id="player"><video id="video"></video></div>
        <div class="caption-window" id="window-setting">Caption settings</div>
        <div data-purpose="caption-settings" id="purpose-setting">Caption language</div>
      </div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
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
    for (const id of ['window-setting', 'purpose-setting']) {
      mockRect(document.getElementById(id) as HTMLElement, {
        left: 100,
        top: 470,
        width: 600,
        height: 40,
      })
    }

    expect(
      new UdemyAdapter().getCandidate(
        makeContext(makeEntry(video), 'www.udemy.com'),
      ),
    ).toBeNull()
  })

  it('cue metni boşalsa da seçilen mod değişmez', () => {
    const { video, caption } = buildDom()
    const adapter = new UdemyAdapter()
    const context = makeContext(makeEntry(video), 'www.udemy.com')

    expect(adapter.getCandidate(context)?.presentation?.mode).toBe('floating')
    caption.textContent = ''
    const empty = adapter.getCandidate(context)
    expect(empty?.presentation?.mode).toBe('floating')
    expect(empty?.presentation?.anchor).toBeNull()
    expect(empty?.text).toBe('')
  })

  it('video altı seçim, video içi metin belirse de korunur', () => {
    const { video, player, caption } = buildBelowDom()
    const adapter = new UdemyAdapter()
    const context = makeContext(makeEntry(video), 'www.udemy.com')
    expect(adapter.getCandidate(context)?.presentation?.mode).toBe(
      'below-caption',
    )

    const inside = document.createElement('div')
    inside.className = 'shaka-text-container'
    inside.textContent = 'Inside copy'
    player.appendChild(inside)
    mockRect(inside, { left: 100, top: 350, width: 600, height: 60 })

    const second = adapter.getCandidate(context)
    expect(second?.presentation?.mode).toBe('below-caption')
    expect(second?.presentation?.anchor).toBe(caption)
    expect(second?.text).toBe('Below video caption')
  })

  it('boş video içi seçim cache’lenmez; sonradan gelen video altı blok seçilir', () => {
    document.body.innerHTML = `
      <div id="lesson">
        <div class="shaka-video-container" id="player">
          <video id="video"></video>
          <div class="shaka-text-container" id="inside"></div>
        </div>
      </div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
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
    mockRect(document.getElementById('inside') as HTMLElement, {
      left: 100,
      top: 350,
      width: 600,
      height: 60,
    })

    const adapter = new UdemyAdapter()
    const context = makeContext(makeEntry(video), 'www.udemy.com')
    expect(adapter.getCandidate(context)?.presentation?.mode).toBe('floating')

    const below = document.createElement('div')
    below.id = 'below'
    below.setAttribute('data-purpose', 'captions-display')
    below.textContent = 'Below block'
    document.getElementById('lesson')?.appendChild(below)
    mockRect(below, { left: 100, top: 470, width: 600, height: 60 })
    // Negatif dış arama önbelleğinin süresi geçsin.
    context.now += 500

    const second = adapter.getCandidate(context)
    expect(second?.text).toBe('Below block')
    expect(second?.presentation?.mode).toBe('below-caption')
    expect(second?.presentation?.anchor).toBe(below)
  })

  it('video içi seçim metinliyken video altı blok belirince yeniden değerlendirir', () => {
    document.body.innerHTML = `
      <div id="lesson">
        <div class="shaka-video-container" id="player">
          <video id="video"></video>
          <div class="shaka-text-container" id="inside">Inside caption</div>
        </div>
      </div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
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
    mockRect(document.getElementById('inside') as HTMLElement, {
      left: 100,
      top: 350,
      width: 600,
      height: 60,
    })

    const adapter = new UdemyAdapter()
    const context = makeContext(makeEntry(video), 'www.udemy.com')
    expect(adapter.getCandidate(context)?.presentation?.mode).toBe('floating')

    const below = document.createElement('div')
    below.id = 'below'
    below.setAttribute('data-purpose', 'captions-display')
    below.textContent = 'Below block'
    document.getElementById('lesson')?.appendChild(below)
    mockRect(below, { left: 100, top: 470, width: 600, height: 60 })
    context.now += 500

    const second = adapter.getCandidate(context)
    expect(second?.presentation?.mode).toBe('below-caption')
    expect(second?.presentation?.anchor).toBe(below)
  })

  it('Q&A ve geniş içerik kolonundaki metni anchor yapmaz', () => {
    document.body.innerHTML = `
      <div id="lesson">
        <div class="shaka-video-container" id="player"><video id="video"></video></div>
        <div class="qa-section">
          <div data-purpose="captions-display" id="qa">Question answer text</div>
        </div>
      </div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
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
    mockRect(document.getElementById('qa') as HTMLElement, {
      left: 100,
      top: 470,
      width: 600,
      height: 60,
    })

    expect(
      new UdemyAdapter().getCandidate(
        makeContext(makeEntry(video), 'www.udemy.com'),
      ),
    ).toBeNull()
  })

  it('layout sınırındaki geniş içerik kolonunu taramaz', () => {
    document.body.innerHTML = `
      <div id="content">
        <div class="shaka-video-container" id="player"><video id="video"></video></div>
        <div data-purpose="captions-display" id="below">Below block</div>
      </div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
    mockRect(video, { left: 0, top: 0, width: 800, height: 450 })
    mockRect(document.getElementById('player') as HTMLElement, {
      left: 0,
      top: 0,
      width: 800,
      height: 450,
    })
    mockRect(document.getElementById('content') as HTMLElement, {
      left: 0,
      top: 0,
      width: 1280,
      height: 1400,
    })
    mockRect(document.getElementById('below') as HTMLElement, {
      left: 100,
      top: 470,
      width: 600,
      height: 60,
    })

    expect(
      new UdemyAdapter().getCandidate(
        makeContext(makeEntry(video), 'www.udemy.com'),
      ),
    ).toBeNull()
  })

  it('climb sırasında eklenti own-UI metnini altyazıya katmaz', () => {
    document.body.innerHTML = `
      <div id="lesson">
        <div class="shaka-video-container" id="player"><video id="video"></video></div>
        <div id="block">
          <span data-purpose="captions-cue-text" id="cue">Caption only</span>
          <div data-subtitle-translator-ui="true">Eklenti çevirisi</div>
        </div>
      </div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
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
    mockRect(document.getElementById('block') as HTMLElement, {
      left: 100,
      top: 470,
      width: 600,
      height: 60,
    })
    mockRect(document.getElementById('cue') as HTMLElement, {
      left: 300,
      top: 480,
      width: 100,
      height: 20,
    })

    const candidate = new UdemyAdapter().getCandidate(
      makeContext(makeEntry(video), 'www.udemy.com'),
    )
    expect(candidate?.text).toBe('Caption only')
    expect(candidate?.presentation?.anchor).toBe(
      document.getElementById('block'),
    )
  })

  it('ilk değerlendirmede video altı blok video içi metne tercih edilir', () => {
    const { video, caption } = buildBelowDom({
      inner: '<div class="shaka-text-container" id="inside">Inside copy</div>',
    })
    mockRect(document.getElementById('inside') as HTMLElement, {
      left: 100,
      top: 350,
      width: 600,
      height: 60,
    })

    const adapter = new UdemyAdapter()
    const context = makeContext(makeEntry(video), 'www.udemy.com')
    const first = adapter.getCandidate(context)
    expect(first?.presentation?.mode).toBe('below-caption')
    expect(first?.presentation?.anchor).toBe(caption)
    // Aynı DOM'da tekrar değerlendirme mod değiştirmez.
    expect(adapter.getCandidate(context)?.presentation?.anchor).toBe(caption)
  })

  it('reset sonrası önceki seçim korunmaz, tercih sırası aynı kalır', () => {
    const { video, player, caption } = buildBelowDom()
    const adapter = new UdemyAdapter()
    const context = makeContext(makeEntry(video), 'www.udemy.com')
    expect(adapter.getCandidate(context)?.presentation?.mode).toBe(
      'below-caption',
    )

    const inside = document.createElement('div')
    inside.className = 'shaka-text-container'
    inside.textContent = 'Inside copy'
    player.appendChild(inside)
    mockRect(inside, { left: 100, top: 350, width: 600, height: 60 })

    adapter.reset()
    const afterReset = adapter.getCandidate(context)
    expect(afterReset?.presentation?.mode).toBe('below-caption')
    expect(afterReset?.presentation?.anchor).toBe(caption)
    expect(afterReset?.text).toBe('Below video caption')
  })

  it('altı üst kapsayıcıdan daha uzaktaki bloğu aramaz', () => {
    document.body.innerHTML = `
      <div id="w7">
        <div id="w6"><div id="w5"><div id="w4"><div id="w3"><div id="w2"><div id="w1">
          <div class="shaka-video-container" id="player"><video id="video"></video></div>
        </div></div></div></div></div></div>
        <div data-purpose="captions-display" id="below">Too far ancestor</div>
      </div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
    mockRect(video, { left: 0, top: 0, width: 800, height: 450 })
    mockRect(document.getElementById('player') as HTMLElement, {
      left: 0,
      top: 0,
      width: 800,
      height: 450,
    })
    for (const id of ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']) {
      mockRect(document.getElementById(id) as HTMLElement, {
        left: 0,
        top: 0,
        width: 800,
        height: 700,
      })
    }
    mockRect(document.getElementById('below') as HTMLElement, {
      left: 100,
      top: 470,
      width: 600,
      height: 60,
    })

    expect(
      new UdemyAdapter().getCandidate(
        makeContext(makeEntry(video), 'www.udemy.com'),
      ),
    ).toBeNull()
  })

  it('iki videodan her birine kendi video altı bloğunu bağlar', () => {
    document.body.innerHTML = `
      <div id="lesson">
        <div id="wrap1">
          <div class="shaka-video-container" id="player1"><video id="video1"></video></div>
          <div data-purpose="captions-display" id="caption1">First video caption</div>
        </div>
        <div id="wrap2">
          <div class="shaka-video-container" id="player2"><video id="video2"></video></div>
          <div data-purpose="captions-display" id="caption2">Second video caption</div>
        </div>
      </div>
    `
    const video1 = document.getElementById('video1') as HTMLVideoElement
    const video2 = document.getElementById('video2') as HTMLVideoElement
    mockRect(video1, { left: 0, top: 0, width: 800, height: 450 })
    mockRect(video2, { left: 0, top: 650, width: 800, height: 450 })
    for (const id of ['player1', 'player2']) {
      mockRect(document.getElementById(id) as HTMLElement, {
        left: 0,
        top: id === 'player1' ? 0 : 650,
        width: 800,
        height: 450,
      })
    }
    for (const id of ['wrap1', 'wrap2']) {
      mockRect(document.getElementById(id) as HTMLElement, {
        left: 0,
        top: id === 'wrap1' ? 0 : 650,
        width: 800,
        height: 520,
      })
    }
    mockRect(document.getElementById('lesson') as HTMLElement, {
      left: 0,
      top: 0,
      width: 800,
      height: 1300,
    })
    mockRect(document.getElementById('caption1') as HTMLElement, {
      left: 100,
      top: 470,
      width: 600,
      height: 60,
    })
    mockRect(document.getElementById('caption2') as HTMLElement, {
      left: 100,
      top: 1120,
      width: 600,
      height: 60,
    })

    const adapter = new UdemyAdapter()
    const video1Rect = { left: 0, top: 0, width: 800, height: 450 }
    const video2Rect = { left: 0, top: 650, width: 800, height: 450 }
    const first = adapter.getCandidate(
      makeContext(makeEntry(video1, video1Rect), 'www.udemy.com'),
    )
    const second = adapter.getCandidate(
      makeContext(makeEntry(video2, video2Rect), 'www.udemy.com'),
    )
    expect(first?.text).toBe('First video caption')
    expect(first?.presentation?.anchor).toBe(
      document.getElementById('caption1'),
    )
    expect(second?.text).toBe('Second video caption')
    expect(second?.presentation?.anchor).toBe(
      document.getElementById('caption2'),
    )

    // Aynı girdide seçim deterministiktir; rastgele bağlanmaz.
    expect(
      adapter.getCandidate(
        makeContext(makeEntry(video1, video1Rect), 'www.udemy.com'),
      )?.presentation?.anchor,
    ).toBe(document.getElementById('caption1'))
  })

  it('geometriyi dar cue span yerine altyazı bloğunda ölçer', () => {
    document.body.innerHTML = `
      <div id="lesson">
        <div class="shaka-video-container" id="player"><video id="video"></video></div>
        <div id="block">
          <span data-purpose="captions-cue-text" id="cue">Span caption</span>
        </div>
      </div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
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
    mockRect(document.getElementById('block') as HTMLElement, {
      left: 100,
      top: 470,
      width: 600,
      height: 60,
    })
    // Span tek başına videoyla hizasız; blok hizalı.
    mockRect(document.getElementById('cue') as HTMLElement, {
      left: 700,
      top: 480,
      width: 40,
      height: 20,
    })

    const candidate = new UdemyAdapter().getCandidate(
      makeContext(makeEntry(video), 'www.udemy.com'),
    )
    expect(candidate?.text).toBe('Span caption')
    expect(candidate?.presentation?.anchor).toBe(
      document.getElementById('block'),
    )
    expect(candidate?.evidence.verifiedBelowVideoRelation).toBe(true)
  })

  it('iç içe video altı cue öğelerini tek kaynakta birleştirir', () => {
    document.body.innerHTML = `
      <div id="lesson">
        <div class="shaka-video-container" id="player"><video id="video"></video></div>
        <div data-purpose="captions-display" id="outer">
          <div class="shaka-text-container" id="inner"><span>Nested cue</span></div>
        </div>
      </div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
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
    for (const id of ['outer', 'inner']) {
      mockRect(document.getElementById(id) as HTMLElement, {
        left: 100,
        top: 470,
        width: 600,
        height: 60,
      })
    }

    const candidate = new UdemyAdapter().getCandidate(
      makeContext(makeEntry(video), 'www.udemy.com'),
    )
    expect(candidate?.text).toBe('Nested cue')
    expect(candidate?.presentation?.anchor).toBe(
      document.getElementById('outer'),
    )
  })
})

describe('YouTubeAdapter', () => {
  function buildDom(): { video: HTMLVideoElement } {
    document.body.innerHTML = `
      <div id="movie_player">
        <video id="video"></video>
        <div class="ytp-caption-window-container">
          <div class="caption-window ytp-caption-window-bottom" id="window">
            <span class="ytp-caption-segment">Hello</span>
            <span class="ytp-caption-segment">world</span>
          </div>
        </div>
      </div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
    mockRect(video, { left: 0, top: 0, width: 800, height: 450 })
    mockRect(document.getElementById('movie_player') as HTMLElement, {
      left: 0,
      top: 0,
      width: 800,
      height: 450,
    })
    mockRect(document.querySelector('.ytp-caption-window-container') as HTMLElement, {
      left: 100,
      top: 300,
      width: 600,
      height: 100,
    })
    mockRect(document.getElementById('window') as HTMLElement, {
      left: 100,
      top: 300,
      width: 600,
      height: 60,
    })
    const segments = document.querySelectorAll('.ytp-caption-segment')
    segments.forEach((segment, index) => {
      mockRect(segment as HTMLElement, {
        left: 100 + index * 80,
        top: 300,
        width: 70,
        height: 30,
      })
    })
    return { video }
  }

  it('görünür caption penceresini DOM sırasıyla okur', () => {
    const { video } = buildDom()
    const candidate = new YouTubeAdapter().getCandidate(
      makeContext(makeEntry(video), 'www.youtube.com'),
    )
    expect(candidate?.text).toBe('Hello world')
    expect(candidate?.evidence.verifiedPlayerContainer).toBe(true)
    expect(candidate?.sourceId).toContain('youtube')
  })

  it('birden fazla pencereyi birleştirmez, görünür olanı seçer', () => {
    const { video } = buildDom()
    const container = document.querySelector(
      '.ytp-caption-window-container',
    ) as HTMLElement
    const second = document.createElement('div')
    second.className = 'caption-window'
    second.innerHTML =
      '<span class="ytp-caption-segment">Independent</span>'
    container.appendChild(second)
    mockRect(second, { left: 100, top: 200, width: 300, height: 40 })
    mockRect(second.firstElementChild as HTMLElement, {
      left: 100,
      top: 200,
      width: 280,
      height: 30,
    })

    const candidate = new YouTubeAdapter().getCandidate(
      makeContext(makeEntry(video), 'www.youtube.com'),
    )
    expect(candidate?.text).toBe('Hello world')
  })

  it('ayarlar menüsündeki aynı sınıf adlı metni okumaz', () => {
    const { video } = buildDom()
    const player = document.getElementById('movie_player') as HTMLElement
    const settings = document.createElement('div')
    settings.className = 'ytp-settings-menu'
    settings.innerHTML =
      '<div class="caption-window"><span class="ytp-caption-segment">Settings</span></div>'
    player.appendChild(settings)
    mockRect(settings, { left: 0, top: 0, width: 200, height: 200 })
    mockRect(settings.firstElementChild as HTMLElement, {
      left: 0,
      top: 0,
      width: 200,
      height: 100,
    })

    const candidate = new YouTubeAdapter().getCandidate(
      makeContext(makeEntry(video), 'www.youtube.com'),
    )
    expect(candidate?.text).toBe('Hello world')
  })

  it('caption penceresi yeniden oluşturulunca kaynak kimliği korunur', () => {
    const { video } = buildDom()
    const adapter = new YouTubeAdapter()
    const first = adapter.getCandidate(
      makeContext(makeEntry(video), 'www.youtube.com'),
    )
    const container = document.querySelector(
      '.ytp-caption-window-container',
    ) as HTMLElement
    container.innerHTML = ''
    const replacement = document.createElement('div')
    replacement.className = 'caption-window'
    replacement.innerHTML =
      '<span class="ytp-caption-segment">Recreated</span>'
    container.appendChild(replacement)
    mockRect(replacement, { left: 100, top: 300, width: 600, height: 60 })
    mockRect(replacement.firstElementChild as HTMLElement, {
      left: 100,
      top: 300,
      width: 200,
      height: 30,
    })
    const second = adapter.getCandidate(
      makeContext(makeEntry(video), 'www.youtube.com'),
    )
    expect(first?.sourceId).toBe(second?.sourceId)
    expect(second?.text).toBe('Recreated')
  })
})

describe('GenericDomAdapter', () => {
  function buildDom(
    captionClass = 'x9q2',
    text = 'Hello generic subtitle',
  ): { video: HTMLVideoElement; caption: HTMLElement } {
    document.body.innerHTML = `
      <div id="player">
        <video id="video"></video>
        <div class="${captionClass}" id="caption">${text}</div>
      </div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
    mockRect(video, { left: 0, top: 0, width: 800, height: 450 })
    mockRect(document.getElementById('player') as HTMLElement, {
      left: 0,
      top: 0,
      width: 800,
      height: 450,
    })
    const caption = document.getElementById('caption') as HTMLElement
    mockRect(caption, { left: 100, top: 350, width: 600, height: 40 })
    return { video, caption }
  }

  it('anlamsız sınıf adlarında geometri ve oynatıcı kanıtıyla aday üretir', () => {
    const { video, caption } = buildDom()
    caption.removeAttribute('id')
    const candidates = new GenericDomAdapter().getCandidates(
      makeContext(makeEntry(video), 'example.com'),
    )
    expect(candidates).toHaveLength(1)
    expect(candidates[0].text).toBe('Hello generic subtitle')
    expect(candidates[0].evidence.sharesPlayerContainer).toBe(true)
    expect(candidates[0].evidence.strongGeometry).toBe(true)
    expect(candidates[0].evidence.subtitleHint).toBe(false)
  })

  it('kısa altyazıyı uzunluk nedeniyle reddetmez', () => {
    const { video } = buildDom('a', 'Hi')
    const candidates = new GenericDomAdapter().getCandidates(
      makeContext(makeEntry(video), 'example.com'),
    )
    expect(candidates[0].text).toBe('Hi')
    expect(candidates[0].evidence.shortLimitedLines).toBe(true)
  })

  it('cümle içindeki caption sözcüğünü eleme nedeni saymaz', () => {
    const { video } = buildDom(
      'a',
      'This caption is part of the sentence.',
    )
    const candidates = new GenericDomAdapter().getCandidates(
      makeContext(makeEntry(video), 'example.com'),
    )
    expect(candidates[0].text).toBe(
      'This caption is part of the sentence.',
    )
  })

  it('transkript, sohbet ve eklenti kutusunu aday yapmaz', () => {
    document.body.innerHTML = `
      <div id="player">
        <video id="video"></video>
        <div class="transcript" id="transcript">Transcript line</div>
        <div class="chat" id="chat">Chat line</div>
        <div id="udemy-translate-floating-subtitle">Plugin line</div>
        <div class="x7" id="caption">Real subtitle</div>
      </div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
    mockRect(video, { left: 0, top: 0, width: 800, height: 450 })
    mockRect(document.getElementById('player') as HTMLElement, {
      left: 0,
      top: 0,
      width: 800,
      height: 450,
    })
    for (const id of ['transcript', 'chat', 'caption']) {
      mockRect(document.getElementById(id) as HTMLElement, {
        left: 100,
        top: 350,
        width: 600,
        height: 40,
      })
    }
    mockRect(document.getElementById('udemy-translate-floating-subtitle') as HTMLElement, {
      left: 100,
      top: 350,
      width: 600,
      height: 40,
    })
    const candidates = new GenericDomAdapter().getCandidates(
      makeContext(makeEntry(video), 'example.com'),
    )
    expect(candidates.map((candidate) => candidate.text)).toEqual([
      'Real subtitle',
    ])
  })

  it('video ile geometrik ilişkisi olmayan dış metni geçersiz sayar', () => {
    document.body.innerHTML = `
      <div id="left"><video id="video"></video></div>
      <div class="caption-overlay" id="overlay">Unrelated page text</div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
    mockRect(video, { left: 0, top: 0, width: 800, height: 450 })
    mockRect(document.getElementById('left') as HTMLElement, {
      left: 0,
      top: 0,
      width: 800,
      height: 450,
    })
    mockRect(document.getElementById('overlay') as HTMLElement, {
      left: 0,
      top: 600,
      width: 800,
      height: 50,
    })
    const candidates = new GenericDomAdapter().getCandidates(
      makeContext(makeEntry(video), 'example.com'),
    )
    expect(candidates).toHaveLength(1)
    expect(candidates[0].invalidReason).toBe('unrelated-video')
  })

  it('dış overlay geometrik ilişkiyle aday olabilir', () => {
    document.body.innerHTML = `
      <div id="left"><video id="video"></video></div>
      <div class="caption-overlay" id="overlay">External caption</div>
    `
    const video = document.getElementById('video') as HTMLVideoElement
    mockRect(video, { left: 0, top: 0, width: 800, height: 450 })
    mockRect(document.getElementById('left') as HTMLElement, {
      left: 0,
      top: 0,
      width: 800,
      height: 450,
    })
    mockRect(document.getElementById('overlay') as HTMLElement, {
      left: 100,
      top: 350,
      width: 600,
      height: 40,
    })
    const candidates = new GenericDomAdapter().getCandidates(
      makeContext(makeEntry(video), 'example.com'),
    )
    expect(candidates[0].text).toBe('External caption')
    expect(candidates[0].invalidReason).toBeUndefined()
    expect(candidates[0].evidence.strongGeometry).toBe(true)
  })

  it('uzun yoğun metin bloğunu cezalandırır', () => {
    const { video } = buildDom('a', 'Long '.repeat(100))
    const candidates = new GenericDomAdapter().getCandidates(
      makeContext(makeEntry(video), 'example.com'),
    )
    expect(candidates[0].evidence.longDenseText).toBe(true)
  })
})

