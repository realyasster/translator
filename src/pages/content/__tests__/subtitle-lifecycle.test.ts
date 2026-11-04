import { SubtitleLifecycle, normalizeSource } from '../subtitle-lifecycle'

interface Recorded {
  source: string
  epoch: number
}

function makeLifecycle(timing?: { stabilityMs?: number; graceMs?: number; maxGapMs?: number }) {
  const translated: Recorded[] = []
  const hidden: number[] = []
  const lifecycle = new SubtitleLifecycle(
    {
      onTranslate: (source, epoch) => translated.push({ source, epoch }),
      onHide: (epoch) => hidden.push(epoch),
    },
    timing,
  )
  return { lifecycle, translated, hidden }
}

const ADVANCE = (ms: number) => jest.advanceTimersByTime(ms)

beforeEach(() => {
  jest.useFakeTimers()
  document.body.innerHTML = ''
})

afterEach(() => {
  jest.useRealTimers()
})

describe('normalizeSource', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeSource('  Hello   there \n world ')).toBe(
      'Hello there world',
    )
    expect(normalizeSource(null)).toBe('')
    expect(normalizeSource(undefined)).toBe('')
  })
})

describe('SubtitleLifecycle', () => {
  it('1) aynı kaynak 10 sn taranır: tek istek, süreye bağlı gizleme yok', () => {
    const { lifecycle, translated, hidden } = makeLifecycle()
    lifecycle.activate()

    for (let t = 0; t < 10000; t += 300) {
      lifecycle.observe('Hello there, this is a subtitle.')
      ADVANCE(300)
    }

    expect(translated).toHaveLength(1)
    expect(translated[0].source).toBe('Hello there, this is a subtitle.')
    expect(hidden).toHaveLength(0)
  })

  it('2) 200 ms içinde A/B/C: yalnız C istenir; aynı adayın tekrarı debounce uzatmaz', () => {
    const { lifecycle, translated } = makeLifecycle()
    lifecycle.activate()

    lifecycle.observe('Source A')
    ADVANCE(50)
    lifecycle.observe('Source B')
    ADVANCE(50)
    lifecycle.observe('Source C')

    // Aynı adayın polling ile tekrarı kararlılık süresini sıfırlamamalı.
    for (let i = 0; i < 5; i += 1) {
      lifecycle.observe('Source C')
      ADVANCE(20)
    }
    ADVANCE(200)

    expect(translated).toHaveLength(1)
    expect(translated[0].source).toBe('Source C')
  })

  it('3) farklı kaynak gözlendiğinde sürüm artar, eski yanıt reddedilir', () => {
    const { lifecycle, translated } = makeLifecycle()
    lifecycle.activate()

    lifecycle.observe('Source A')
    ADVANCE(200)
    const epochA = translated[0].epoch
    expect(lifecycle.beginRequest('Source A', epochA)).toBe(true)

    lifecycle.observe('Source B')
    expect(lifecycle.isEpochCurrent(epochA)).toBe(false)

    // A'nın geç gelen sonucu hiçbir şey yazamaz.
    expect(
      lifecycle.completeRequest(epochA, {
        source: 'Source A',
        translation: 'A çeviri',
      }),
    ).toBe(false)
    expect(lifecycle.visiblePair).toBeNull()
  })

  it('5a) kısa boşlukta kutu kapanmaz', () => {
    const { lifecycle, translated, hidden } = makeLifecycle()
    lifecycle.activate()

    lifecycle.observe('Hello there')
    ADVANCE(200)
    expect(
      lifecycle.completeRequest(translated[0].epoch, {
        source: 'Hello there',
        translation: 'Merhaba',
      }),
    ).toBe(true)

    ADVANCE(3000)
    lifecycle.observe('')
    ADVANCE(1000)
    expect(hidden).toHaveLength(0)

    lifecycle.observe('Hello there')
    ADVANCE(5000)
    expect(hidden).toHaveLength(0)
  })

  it('5b) boşluk + istek yok: 1500 ms sonra gizlenir', () => {
    const { lifecycle, translated, hidden } = makeLifecycle()
    lifecycle.activate()

    lifecycle.observe('Hello there')
    ADVANCE(200)
    lifecycle.completeRequest(translated[0].epoch, {
      source: 'Hello there',
      translation: 'Merhaba',
    })

    lifecycle.observe('')
    ADVANCE(1499)
    expect(hidden).toHaveLength(0)
    ADVANCE(1)
    expect(hidden).toHaveLength(1)
  })

  it('5c) boşluk + bekleyen istek: en geç 6000 ms içinde gizlenir', () => {
    const { lifecycle, translated, hidden } = makeLifecycle()
    lifecycle.activate()

    lifecycle.observe('Hello there')
    ADVANCE(200)
    const epoch = translated[0].epoch
    expect(lifecycle.beginRequest('Hello there', epoch)).toBe(true)

    lifecycle.observe('')
    ADVANCE(5999)
    expect(hidden).toHaveLength(0)
    ADVANCE(1)
    expect(hidden).toHaveLength(1)
  })

  it('5d) boşlukta istek tamamlanırsa gizleme = boşluk + 1500 ms', () => {
    const { lifecycle, translated, hidden } = makeLifecycle()
    lifecycle.activate()

    lifecycle.observe('Hello there')
    ADVANCE(200)
    const epoch = translated[0].epoch
    lifecycle.beginRequest('Hello there', epoch)

    lifecycle.observe('')
    ADVANCE(500)

    expect(
      lifecycle.completeRequest(epoch, {
        source: 'Hello there',
        translation: 'Merhaba',
      }),
    ).toBe(true)

    ADVANCE(999)
    expect(hidden).toHaveLength(0)
    ADVANCE(1)
    expect(hidden).toHaveLength(1)
  })

  it('7) gizlendikten sonra geç yanıt kutuyu tekrar açamaz', () => {
    const { lifecycle, translated, hidden } = makeLifecycle()
    lifecycle.activate()

    lifecycle.observe('Hello there')
    ADVANCE(200)
    const epoch = translated[0].epoch
    lifecycle.beginRequest('Hello there', epoch)

    lifecycle.observe('')
    ADVANCE(6000)
    expect(hidden).toHaveLength(1)

    expect(
      lifecycle.completeRequest(epoch, {
        source: 'Hello there',
        translation: 'Merhaba',
      }),
    ).toBe(false)
    expect(lifecycle.visiblePair).toBeNull()
  })

  it('8) invalidate sonrası güncel kaynak yeniden değerlendirilir, eski sonuç uygulanmaz', () => {
    const { lifecycle, translated } = makeLifecycle()
    lifecycle.activate()

    lifecycle.observe('Hello there')
    ADVANCE(200)
    const oldEpoch = translated[0].epoch
    lifecycle.beginRequest('Hello there', oldEpoch)

    lifecycle.invalidate()
    lifecycle.observe('Hello there')
    ADVANCE(200)

    expect(translated).toHaveLength(2)
    expect(translated[1].epoch).not.toBe(oldEpoch)

    expect(
      lifecycle.completeRequest(oldEpoch, {
        source: 'Hello there',
        translation: 'eski',
      }),
    ).toBe(false)

    expect(
      lifecycle.completeRequest(translated[1].epoch, {
        source: 'Hello there',
        translation: 'yeni',
      }),
    ).toBe(true)
    expect(lifecycle.visiblePair?.translation).toBe('yeni')
  })

  it('1b) boşluk sırasında uçuştaki istek geçersizleşmez, aynı kaynak yeniden istenmez', () => {
    const { lifecycle, translated } = makeLifecycle()
    lifecycle.activate()

    lifecycle.observe('Source S')
    ADVANCE(200)
    expect(translated).toHaveLength(1)
    const epochS = translated[0].epoch
    expect(lifecycle.beginRequest('Source S', epochS)).toBe(true)

    // DOM bir tarama boş kalır (Udemy'de sık görülür).
    lifecycle.observe('')
    ADVANCE(100)

    // Aynı altyazı geri gelir.
    lifecycle.observe('Source S')
    ADVANCE(500)

    // Uçuştaki istek korunur: yeni onTranslate yok, epoch hâlâ geçerli.
    expect(translated).toHaveLength(1)
    expect(
      lifecycle.completeRequest(epochS, {
        source: 'Source S',
        translation: 'S çeviri',
      }),
    ).toBe(true)
    expect(lifecycle.visiblePair?.translation).toBe('S çeviri')
  })

  it('1c) bayat istek kaydı erken dönüşü tetiklemez, güncel aday kazanır', () => {
    const { lifecycle, translated } = makeLifecycle()
    lifecycle.activate()

    lifecycle.observe('Source S')
    ADVANCE(200)
    const epochS = translated[0].epoch
    expect(lifecycle.beginRequest('Source S', epochS)).toBe(true)

    // Araya başka bir aday girer: epoch artar, request kaydı bayatlar.
    lifecycle.observe('Source S2')
    ADVANCE(100)

    // S geri gelir: bayat kayıt yüzünden erken dönülmemeli, S2'nin
    // bekleyen timer'ı iptal edilmeli ve S yeniden istenmeli.
    lifecycle.observe('Source S')
    ADVANCE(500)

    expect(translated).toHaveLength(2)
    expect(translated[1].source).toBe('Source S')
    expect(translated.some((t) => t.source === 'Source S2')).toBe(false)

    // S sonunda görünür olabilmeli.
    expect(
      lifecycle.completeRequest(translated[1].epoch, {
        source: 'Source S',
        translation: 'S çeviri',
      }),
    ).toBe(true)
    expect(lifecycle.visiblePair?.translation).toBe('S çeviri')
  })

  it('2) A→X→A: X için bekleyen istek iptal edilir, ekrandaki çift korunur', () => {
    const { lifecycle, translated } = makeLifecycle()
    lifecycle.activate()

    lifecycle.observe('Source A')
    ADVANCE(200)
    const epochA = translated[0].epoch
    expect(
      lifecycle.completeRequest(epochA, {
        source: 'Source A',
        translation: 'A çeviri',
      }),
    ).toBe(true)

    // X'e kayar, kararlılık süresi dolmadan A'ya döner.
    lifecycle.observe('Source X')
    ADVANCE(100)
    lifecycle.observe('Source A')
    ADVANCE(1000)

    // X için istek tetiklenmemeli, ekrandaki çift ezilmemeli.
    expect(translated).toHaveLength(1)
    expect(lifecycle.visiblePair).toEqual({
      source: 'Source A',
      translation: 'A çeviri',
    })
  })

  it('2b) X isteği uçuştayken A ekranı korunur, X sonucu reddedilir', () => {
    const { lifecycle, translated } = makeLifecycle()
    lifecycle.activate()

    lifecycle.observe('Source A')
    ADVANCE(200)
    lifecycle.completeRequest(translated[0].epoch, {
      source: 'Source A',
      translation: 'A çeviri',
    })

    // X yeterince uzun kaldı: onTranslate tetiklendi (istek henüz başlamadı).
    lifecycle.observe('Source X')
    ADVANCE(200)
    expect(translated).toHaveLength(2)
    const epochX = translated[1].epoch

    // A'ya dönüş: X'in geç sonucu geçersizleşir.
    lifecycle.observe('Source A')
    expect(
      lifecycle.completeRequest(epochX, {
        source: 'Source X',
        translation: 'X çeviri',
      }),
    ).toBe(false)
    expect(lifecycle.visiblePair?.translation).toBe('A çeviri')
  })

  it('3) kaynak 200 ms içinde kaybolursa bekleyen istek tetiklenmez', () => {
    const { lifecycle, translated } = makeLifecycle()
    lifecycle.activate()

    lifecycle.observe('Source X')
    ADVANCE(100)
    lifecycle.observe('')
    ADVANCE(1000)

    expect(translated).toHaveLength(0)
    expect(lifecycle.gapSince).toBeNull()
  })

  it('4) görünür çift ve istek yokken boşluk epoch bump/onHide üretmez', () => {
    const { lifecycle, hidden } = makeLifecycle()
    lifecycle.activate()

    const epochBefore = lifecycle.epoch
    lifecycle.observe('')
    ADVANCE(10000)

    expect(hidden).toHaveLength(0)
    expect(lifecycle.epoch).toBe(epochBefore)
  })

  it('5) invalidate görünür çifti korur ve aynı kaynağı yeniden değerlendirir', () => {
    const { lifecycle, translated } = makeLifecycle()
    lifecycle.activate()

    lifecycle.observe('Source A')
    ADVANCE(200)
    lifecycle.completeRequest(translated[0].epoch, {
      source: 'Source A',
      translation: 'A çeviri',
    })
    expect(lifecycle.visiblePair).not.toBeNull()

    lifecycle.invalidate()
    // DOM'daki çift ile state tutarlı: görünür çift korunur.
    expect(lifecycle.visiblePair?.translation).toBe('A çeviri')

    lifecycle.observe('Source A')
    ADVANCE(200)

    expect(translated).toHaveLength(2)
    expect(translated[1].source).toBe('Source A')
  })

  it('5b) normal akışta aynı kaynak yeniden istenmez', () => {
    const { lifecycle, translated } = makeLifecycle()
    lifecycle.activate()

    lifecycle.observe('Source A')
    ADVANCE(200)
    lifecycle.completeRequest(translated[0].epoch, {
      source: 'Source A',
      translation: 'A çeviri',
    })

    lifecycle.observe('Source A')
    ADVANCE(1000)

    expect(translated).toHaveLength(1)
  })

  it('6) forceReevaluate bayrağı hide/deactivate/observe sonrası sıfırlanır', () => {
    const { lifecycle, translated } = makeLifecycle()
    lifecycle.activate()

    lifecycle.observe('Source A')
    ADVANCE(200)
    lifecycle.completeRequest(translated[0].epoch, {
      source: 'Source A',
      translation: 'A çeviri',
    })
    expect(lifecycle.needsReevaluation).toBe(false)

    // invalidate bayrağı kaldırır.
    lifecycle.invalidate()
    expect(lifecycle.needsReevaluation).toBe(true)

    // hideNow (performHide) bayrağı sıfırlar.
    lifecycle.hideNow()
    expect(lifecycle.needsReevaluation).toBe(false)

    // invalidate + deactivate de sıfırlar.
    lifecycle.invalidate()
    expect(lifecycle.needsReevaluation).toBe(true)
    lifecycle.deactivate()
    expect(lifecycle.needsReevaluation).toBe(false)

    // invalidate + normal observe yolu bayrağı tüketir.
    lifecycle.activate()
    lifecycle.observe('Source A')
    ADVANCE(200)
    lifecycle.completeRequest(lifecycle.epoch, {
      source: 'Source A',
      translation: 'A çeviri',
    })
    lifecycle.invalidate()
    expect(lifecycle.needsReevaluation).toBe(true)
    lifecycle.observe('Source A')
    expect(lifecycle.needsReevaluation).toBe(false)
  })

  it('deactivate bekleyen yanıtları ve zamanlayıcıları geçersizleştirir', () => {
    const { lifecycle, translated, hidden } = makeLifecycle()
    lifecycle.activate()

    lifecycle.observe('Hello there')
    ADVANCE(200)
    const epoch = translated[0].epoch
    lifecycle.beginRequest('Hello there', epoch)

    lifecycle.deactivate()
    ADVANCE(20000)

    expect(hidden).toHaveLength(0)
    expect(translated).toHaveLength(1)
    expect(lifecycle.isEpochCurrent(epoch)).toBe(false)
    expect(lifecycle.hasActiveRequest).toBe(false)
  })
})
