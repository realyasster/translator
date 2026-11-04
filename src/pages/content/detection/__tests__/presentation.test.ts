import {
  isFullscreenLayoutExcluded,
  isPresentationAnchorAvailable,
  isUsablePresentationMount,
  samePresentation,
  SubtitlePresentation,
} from '../presentation'
import { SourceRef } from '../../../../types/detection'

const SOURCE: SourceRef = {
  documentId: 'doc_test',
  videoId: 'video_1',
  sourceId: 'player:udemy:video_1:captions',
  generation: 1,
  kind: 'player-dom',
}

function makePresentation(
  anchor: HTMLElement,
  mountAfter?: HTMLElement | null,
): SubtitlePresentation {
  const presentation: SubtitlePresentation = {
    source: { ...SOURCE },
    mode: 'below-caption',
    anchor,
  }
  if (mountAfter !== undefined) presentation.mountAfter = mountAfter
  return presentation
}

beforeEach(() => {
  document.body.innerHTML = ''
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    value: null,
  })
})

describe('presentation mountAfter sözleşmesi', () => {
  it('samePresentation mountAfter kimliğini ve null/undefined ayrımını korur', () => {
    const anchor = document.createElement('div')
    const rowA = document.createElement('div')
    const rowB = document.createElement('div')

    expect(
      samePresentation(
        makePresentation(anchor, undefined),
        makePresentation(anchor, undefined),
      ),
    ).toBe(true)
    expect(
      samePresentation(
        makePresentation(anchor, null),
        makePresentation(anchor, null),
      ),
    ).toBe(true)
    expect(
      samePresentation(
        makePresentation(anchor, undefined),
        makePresentation(anchor, null),
      ),
    ).toBe(false)
    expect(
      samePresentation(makePresentation(anchor, rowA), makePresentation(anchor, rowA)),
    ).toBe(true)
    expect(
      samePresentation(makePresentation(anchor, rowA), makePresentation(anchor, rowB)),
    ).toBe(false)
  })

  it('anchor kullanılabilirliği fullscreen yerleşim kararından ayrıdır', () => {
    const anchor = document.createElement('div')
    document.body.appendChild(anchor)

    expect(isPresentationAnchorAvailable(anchor, document)).toBe(true)
    expect(isFullscreenLayoutExcluded(anchor, null, document)).toBe(false)

    const fullscreenRoot = document.createElement('div')
    document.body.appendChild(fullscreenRoot)
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: fullscreenRoot,
    })

    expect(isPresentationAnchorAvailable(anchor, document)).toBe(true)
    expect(isFullscreenLayoutExcluded(anchor, null, document)).toBe(true)

    const insideTarget = document.createElement('div')
    fullscreenRoot.appendChild(insideTarget)
    insideTarget.appendChild(anchor)
    expect(isFullscreenLayoutExcluded(anchor, insideTarget, document)).toBe(
      false,
    )
  })

  it('mountAfter undefined legacy, null güvenli hedef yok demektir', () => {
    const anchor = document.createElement('div')
    document.body.appendChild(anchor)

    expect(isUsablePresentationMount(undefined, anchor, document)).toBe(true)
    expect(isUsablePresentationMount(null, anchor, document)).toBe(false)
  })

  it('mountAfter aynı document, bağlı, görünür ve anchor kapsayıcı olmalı', () => {
    const row = document.createElement('div')
    const anchor = document.createElement('div')
    row.appendChild(anchor)
    document.body.appendChild(row)
    expect(isUsablePresentationMount(row, anchor, document)).toBe(true)

    const other = document.createElement('div')
    document.body.appendChild(other)
    expect(isUsablePresentationMount(other, anchor, document)).toBe(false)

    row.remove()
    expect(isUsablePresentationMount(row, anchor, document)).toBe(false)

    document.body.appendChild(row)
    row.style.display = 'none'
    expect(isUsablePresentationMount(row, anchor, document)).toBe(false)
    row.style.display = ''

    row.id = 'udemy-translate-floating-subtitle'
    expect(isUsablePresentationMount(row, anchor, document)).toBe(false)
    row.removeAttribute('id')

    const hiddenAnchor = document.createElement('div')
    hiddenAnchor.style.display = 'none'
    row.appendChild(hiddenAnchor)
    expect(isUsablePresentationMount(row, hiddenAnchor, document)).toBe(false)
  })

  it('mountAfter gizli veya eklenti UI anchor’ını kabul etmez', () => {
    const row = document.createElement('div')
    const hiddenAnchor = document.createElement('div')
    hiddenAnchor.style.display = 'none'
    row.appendChild(hiddenAnchor)
    document.body.appendChild(row)
    expect(isUsablePresentationMount(row, hiddenAnchor, document)).toBe(false)

    const pluginAnchor = document.createElement('div')
    pluginAnchor.setAttribute('data-subtitle-translator-ui', 'true')
    row.appendChild(pluginAnchor)
    expect(isUsablePresentationMount(row, pluginAnchor, document)).toBe(false)
  })

  it('fullscreen kararı anchor yanında gerçek ekleme ebeveynini de kontrol eder', () => {
    const fullscreenRoot = document.createElement('div')
    const inside = document.createElement('div')
    const well = document.createElement('div')
    inside.appendChild(well)
    fullscreenRoot.appendChild(inside)
    document.body.appendChild(fullscreenRoot)
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: fullscreenRoot,
    })

    // Anchor ve mount hedefi fullscreen içinde: below kullanılabilir.
    expect(isFullscreenLayoutExcluded(well, inside, document)).toBe(false)
    // Anchor içeride, hedef kendisi fullscreen kökü: afterend dışarıda kalır.
    expect(isFullscreenLayoutExcluded(well, fullscreenRoot, document)).toBe(
      true,
    )
    // Anchor içeride, hedefin ebeveyni fullscreen dışında.
    const outsideRow = document.createElement('div')
    const outsideTarget = document.createElement('div')
    outsideRow.appendChild(outsideTarget)
    document.body.appendChild(outsideRow)
    expect(isFullscreenLayoutExcluded(well, outsideTarget, document)).toBe(
      true,
    )
    // Legacy undefined anchor ebeveynini kullanır.
    expect(isFullscreenLayoutExcluded(well, undefined, document)).toBe(false)
    // Anchor içeride ama güvenli mount hedefi yok: görsel floating gerekir.
    expect(isFullscreenLayoutExcluded(well, null, document)).toBe(true)
    // Anchor yoksa null hedef tek başına floating kanıtı değildir.
    expect(isFullscreenLayoutExcluded(null, null, document)).toBe(false)
    // Anchor fullscreen dışındaysa her durumda floating.
    expect(isFullscreenLayoutExcluded(outsideRow, null, document)).toBe(true)

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    })
    expect(isFullscreenLayoutExcluded(well, outsideTarget, document)).toBe(
      false,
    )
  })
})
