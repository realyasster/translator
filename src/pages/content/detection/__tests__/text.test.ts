import {
  collectTextCandidates,
  candidateKey,
  getElementRect,
  horizontalOverlapRatio,
  intersectRects,
  isBelowVideoRelation,
  isExcludedTextElement,
  nearestCommonAncestor,
  readVisibleText,
  sharesPlayerContainer,
  strongGeometricRelation,
  textLines,
} from '../text'

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

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('readVisibleText', () => {
  it('DOM sırasını ve <br> satır sınırlarını korur', () => {
    document.body.innerHTML =
      '<div id="cue"><span>First line</span><br><span>Second line</span></div>'
    const el = document.getElementById('cue') as HTMLElement
    expect(readVisibleText(el)).toBe('First line\nSecond line')
    expect(textLines(readVisibleText(el))).toEqual(['First line', 'Second line'])
  })

  it('gizli metni okumaz', () => {
    document.body.innerHTML =
      '<div id="cue"><span style="display:none">Hidden</span><span>Visible</span></div>'
    expect(readVisibleText(document.getElementById('cue'))).toBe('Visible')
  })

  it('iç içe eklenti own-UI metnini altyazı metnine katmaz', () => {
    document.body.innerHTML = `
      <div id="block">
        <span>Caption only</span>
        <div data-subtitle-translator-ui="true">Plugin translation</div>
      </div>
    `
    expect(readVisibleText(document.getElementById('block'))).toBe(
      'Caption only',
    )
  })

  it('düğme ve form alanı metnini dışlar', () => {
    document.body.innerHTML =
      '<div id="cue"><button>Play</button><span>Caption</span><input value="x"></div>'
    expect(readVisibleText(document.getElementById('cue'))).toBe('Caption')
  })

  it('eklenti arayüzünü okumaz', () => {
    document.body.innerHTML =
      '<div id="udemy-translate-floating-subtitle">Translated</div><div id="cue">Caption</div>'
    const plugin = document.getElementById(
      'udemy-translate-floating-subtitle',
    ) as HTMLElement
    expect(isExcludedTextElement(plugin)).toBe(true)
    expect(readVisibleText(plugin)).toBe('')
  })

  it('tek karakterlik altyazıyı uzunluk nedeniyle reddetmez', () => {
    document.body.innerHTML = '<div id="cue">I</div>'
    expect(readVisibleText(document.getElementById('cue'))).toBe('I')
  })

  it('cümle içinde caption sözcüğünü eleme nedeni saymaz', () => {
    document.body.innerHTML =
      '<div id="cue">This caption is part of the sentence.</div>'
    expect(readVisibleText(document.getElementById('cue'))).toBe(
      'This caption is part of the sentence.',
    )
  })

  it('videoyu içeren course-content kabuğu gerçek altyazıyı dışlamaz', () => {
    document.body.innerHTML = `
      <div class="course-content">
        <div id="player"><video id="v"></video><div id="cue">Caption line</div></div>
      </div>
    `
    const cue = document.getElementById('cue') as HTMLElement
    expect(isExcludedTextElement(cue)).toBe(false)
    expect(readVisibleText(cue)).toBe('Caption line')
  })

  it('Q&A bölümünü tam sözcükle dışlar, question/curriculum alt dizelerini dışlamaz', () => {
    document.body.innerHTML = `
      <div class="qa-section"><div id="qa">Question answer</div></div>
      <div class="questionnaire"><div id="cue">Caption line</div></div>
    `
    expect(
      isExcludedTextElement(document.getElementById('qa') as HTMLElement),
    ).toBe(true)
    expect(
      isExcludedTextElement(document.getElementById('cue') as HTMLElement),
    ).toBe(false)
  })

  it('no-sidebar CSS-module görünüm sınıflarını sidebar kanıtı saymaz', () => {
    document.body.innerHTML = `
      <div class="curriculum-item-view--no-sidebar--LGmz-">
        <video></video>
        <div class="app--no-sidebar--oqmAw">
          <div class="well-module--container--9Y7tq" id="cue">
            <span class="well-module--text--pTRTZ">Expanded caption</span>
          </div>
        </div>
      </div>
    `
    const cue = document.getElementById('cue') as HTMLElement
    expect(isExcludedTextElement(cue)).toBe(false)
    expect(readVisibleText(cue)).toBe('Expanded caption')
  })

  it('gerçek sidebar ve sidebar-panel sınıflarını dışlar', () => {
    document.body.innerHTML = `
      <div class="sidebar"><div id="cue-a">Caption A</div></div>
      <div class="sidebar-panel"><div id="cue-b">Caption B</div></div>
    `
    expect(
      isExcludedTextElement(document.getElementById('cue-a') as HTMLElement),
    ).toBe(true)
    expect(
      isExcludedTextElement(document.getElementById('cue-b') as HTMLElement),
    ).toBe(true)
  })

  it('no-sidebar ile gerçek sidebar aynı öğedeyse dışlama sürer', () => {
    document.body.innerHTML = `
      <div class="no-sidebar sidebar-panel"><div id="cue">Caption</div></div>
    `
    expect(
      isExcludedTextElement(document.getElementById('cue') as HTMLElement),
    ).toBe(true)
  })

  it('no-sidebar yalnız sınıf token’ına uygulanır; diğer sidebar işaretleri dışlar', () => {
    document.body.innerHTML = `
      <div class="app--no-sidebar--oqmAw" aria-label="sidebar">
        <div id="cue-a">Caption A</div>
      </div>
      <div class="app--no-sidebar--oqmAw" id="sidebar">
        <div id="cue-b">Caption B</div>
      </div>
    `
    expect(
      isExcludedTextElement(document.getElementById('cue-a') as HTMLElement),
    ).toBe(true)
    expect(
      isExcludedTextElement(document.getElementById('cue-b') as HTMLElement),
    ).toBe(true)
  })

  it('no-sidebar muafiyeti yalnız gerçek token sınırlarında geçerlidir', () => {
    document.body.innerHTML = `
      <div class="layout-no-sidebar"><div id="allowed-a">Caption A</div></div>
      <div class="x--no-sidebar"><div id="allowed-b">Caption B</div></div>
      <div class="app--no-sidebar--hash"><div id="allowed-c">Caption C</div></div>
      <div class="sidebar-panel--no-sidebar-toggle--x">
        <div id="denied-a">Caption D</div>
      </div>
      <div class="sidebar-panel--no-sidebar--x">
        <div id="denied-b">Caption E</div>
      </div>
    `
    expect(
      isExcludedTextElement(
        document.getElementById('allowed-a') as HTMLElement,
      ),
    ).toBe(false)
    expect(
      isExcludedTextElement(
        document.getElementById('allowed-b') as HTMLElement,
      ),
    ).toBe(false)
    expect(
      isExcludedTextElement(
        document.getElementById('allowed-c') as HTMLElement,
      ),
    ).toBe(false)
    expect(
      isExcludedTextElement(
        document.getElementById('denied-a') as HTMLElement,
      ),
    ).toBe(true)
    expect(
      isExcludedTextElement(
        document.getElementById('denied-b') as HTMLElement,
      ),
    ).toBe(true)
  })

  it('no-sidebar transcript, menü ve eklenti UI dışlamalarını geçersiz kılmaz', () => {
    document.body.innerHTML = `
      <div class="app--no-sidebar--oqmAw">
        <div data-purpose="transcript"><div id="transcript">Transcript</div></div>
        <div role="menu"><div id="menu">Menu</div></div>
        <div id="udemy-translate-floating-subtitle"><div id="plugin">Plugin</div></div>
      </div>
    `
    expect(
      isExcludedTextElement(
        document.getElementById('transcript') as HTMLElement,
      ),
    ).toBe(true)
    expect(
      isExcludedTextElement(document.getElementById('menu') as HTMLElement),
    ).toBe(true)
    expect(
      isExcludedTextElement(document.getElementById('plugin') as HTMLElement),
    ).toBe(true)
  })
})

describe('collectTextCandidates', () => {
  it('iç içe öğelerde aynı içeriği çoğaltmaz', () => {
    document.body.innerHTML =
      '<div id="caption"><span><span>Hello there</span></span></div>'
    const groups = collectTextCandidates(document.body)
    expect(groups).toHaveLength(1)
    expect(groups[0].text).toBe('Hello there')
    expect(groups[0].element.id).toBe('caption')
  })

  it('transkript, sohbet ve eklenti kutusunu reddeder', () => {
    document.body.innerHTML = `
      <div class="transcript"><div>Transcript line</div></div>
      <div class="chat"><div>Chat line</div></div>
      <div id="udemy-translate-floating-subtitle">Plugin line</div>
      <div id="caption">Caption line</div>
    `
    const groups = collectTextCandidates(document.body)
    const texts = groups.map((group) => group.text)
    expect(texts).toContain('Caption line')
    expect(texts).not.toContain('Transcript line')
    expect(texts).not.toContain('Chat line')
    expect(texts).not.toContain('Plugin line')
  })

  it('menü rolündeki kapsayıcıyı aday yapmaz', () => {
    document.body.innerHTML = `
      <div role="menu"><div class="caption-like">Settings</div></div>
      <div id="caption">Actual subtitle</div>
    `
    const groups = collectTextCandidates(document.body)
    expect(groups.map((group) => group.text)).toEqual(['Actual subtitle'])
  })

  it('bağımsız iki kapsayıcıyı birleştirmez', () => {
    document.body.innerHTML = `
      <div id="caption-a">First caption</div>
      <div id="caption-b">Second caption</div>
    `
    const groups = collectTextCandidates(document.body)
    expect(groups).toHaveLength(2)
    expect(groups.map((group) => group.text).sort()).toEqual([
      'First caption',
      'Second caption',
    ])
  })

  it('kararlı aday anahtarı yapısal yuvayı temsil eder', () => {
    document.body.innerHTML = '<div id="player"><div class="captions">Hi</div></div>'
    const el = document.querySelector('.captions') as Element
    const key = candidateKey(el, document.getElementById('player'))
    expect(key).toContain('div.captions')
  })
})

describe('geometri yardımcıları', () => {
  it('kesişim ve oranları hesaplar', () => {
    const a = { left: 0, top: 0, width: 100, height: 100 }
    const b = { left: 50, top: 50, width: 100, height: 100 }
    expect(intersectRects(a, b)).toEqual({
      left: 50,
      top: 50,
      width: 50,
      height: 50,
    })
    expect(intersectRects(a, { left: 200, top: 0, width: 1, height: 1 })).toBeNull()
  })

  it('ortak oynatıcı kapsayıcısını bulur', () => {
    document.body.innerHTML =
      '<div id="player"><video id="v"></video><div id="c">Hi</div></div>'
    const video = document.getElementById('v') as HTMLVideoElement
    const caption = document.getElementById('c') as HTMLElement
    mockRect(video, { left: 0, top: 0, width: 800, height: 450 })
    mockRect(document.getElementById('player') as HTMLElement, {
      left: 0,
      top: 0,
      width: 800,
      height: 450,
    })
    expect(nearestCommonAncestor(video, caption)?.id).toBe('player')
    expect(
      sharesPlayerContainer(video, caption, getElementRect(video)),
    ).toBe(true)
  })

  it('genel adaptör 8x sınırını korur, Udemy 3x sınırını kullanır', () => {
    document.body.innerHTML =
      '<div id="shell"><div id="player"><video id="v"></video></div><div id="c">Hi</div></div>'
    const video = document.getElementById('v') as HTMLVideoElement
    const caption = document.getElementById('c') as HTMLElement
    mockRect(video, { left: 0, top: 0, width: 800, height: 450 })
    // Ortak kapsayıcı video alanının ~4.4 katı: genel sınırda kabul,
    // Udemy'nin dar sınırında reddedilir.
    mockRect(document.getElementById('shell') as HTMLElement, {
      left: 0,
      top: 0,
      width: 800,
      height: 2000,
    })
    expect(
      sharesPlayerContainer(video, caption, getElementRect(video)),
    ).toBe(true)
    expect(
      sharesPlayerContainer(video, caption, getElementRect(video), 3),
    ).toBe(false)
  })

  it('video altı ilişkisini gerçekten altta, yakın ve hizalıysa kabul eder', () => {
    const video = { left: 0, top: 0, width: 800, height: 450 }
    expect(
      isBelowVideoRelation({ left: 100, top: 470, width: 600, height: 60 }, video),
    ).toBe(true)
    // Yapışık blok kabul edilir.
    expect(
      isBelowVideoRelation({ left: 100, top: 450, width: 600, height: 60 }, video),
    ).toBe(true)
    // Video üstü, 160 px'den uzak ve yatay hizasız bloklar kabul edilmez.
    expect(
      isBelowVideoRelation({ left: 100, top: 300, width: 600, height: 60 }, video),
    ).toBe(false)
    expect(
      isBelowVideoRelation({ left: 100, top: 620, width: 600, height: 60 }, video),
    ).toBe(false)
    expect(
      isBelowVideoRelation({ left: 700, top: 470, width: 300, height: 60 }, video),
    ).toBe(false)
    // Dar rozet kendi genişliğine göre tam kesişse bile video genişliğine
    // göre minimum oranı geçemediği için reddedilir.
    expect(
      isBelowVideoRelation({ left: 380, top: 470, width: 40, height: 20 }, video),
    ).toBe(false)
    expect(horizontalOverlapRatio(
      { left: 100, top: 470, width: 600, height: 60 },
      video,
    )).toBe(1)
  })

  it('video ile örtüşmeyen adayı güçlü geometrik ilişkili saymaz', () => {
    expect(
      strongGeometricRelation(
        { left: 0, top: 0, width: 100, height: 20 },
        { left: 0, top: 0, width: 800, height: 450 },
      ),
    ).toBe(true)
    expect(
      strongGeometricRelation(
        { left: 0, top: 600, width: 100, height: 20 },
        { left: 0, top: 0, width: 800, height: 450 },
      ),
    ).toBe(false)
  })
})
