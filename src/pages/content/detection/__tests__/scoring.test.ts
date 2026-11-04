import {
  CandidateHistory,
  evaluateConnection,
  scoreCandidate,
  SCORE_WEIGHTS,
} from '../scoring'
import {
  CONNECT_THRESHOLD,
  RIVAL_SCORE_GAP,
} from '../../../../types/detection'

describe('scoreCandidate', () => {
  it('etkin yerel cue 100 puanla sınırlanır', () => {
    expect(
      scoreCandidate({
        nativeActiveCue: true,
        sharesPlayerContainer: true,
        strongGeometry: true,
        shortLimitedLines: true,
        subtitleHint: true,
      }),
    ).toBe(100)
  })

  it('uzun yoğun metin ceza alır', () => {
    const base = scoreCandidate({
      sharesPlayerContainer: true,
      strongGeometry: true,
      shortLimitedLines: true,
    })
    const penalized = scoreCandidate({
      sharesPlayerContainer: true,
      strongGeometry: true,
      shortLimitedLines: true,
      longDenseText: true,
    })
    expect(penalized).toBe(base + SCORE_WEIGHTS.longDenseText)
  })

  it('kanıtsız aday eşiğin altında kalır', () => {
    expect(scoreCandidate({})).toBe(0)
    expect(
      scoreCandidate({
        sharesPlayerContainer: true,
        strongGeometry: true,
        shortLimitedLines: true,
      }),
    ).toBeLessThan(80)
  })

  it('Udemy video altı ilişkisiyle gerçek eşik hesabı 80 eder', () => {
    const score = scoreCandidate({
      verifiedPlayerContainer: true,
      verifiedBelowVideoRelation: true,
      shortLimitedLines: true,
      subtitleHint: true,
    })
    expect(score).toBe(80)
    expect(score).toBe(CONNECT_THRESHOLD)

    // Oynatıcı dışı blok, oynatıcı kapsayıcısı yerine kendi blok kanıtıyla
    // aynı eşiğe ulaşır.
    expect(
      scoreCandidate({
        verifiedCaptionBlock: true,
        verifiedBelowVideoRelation: true,
        shortLimitedLines: true,
        subtitleHint: true,
      }),
    ).toBe(CONNECT_THRESHOLD)
  })

  it('video üstü örtüşme ile video altı ilişki iki kez sayılmaz', () => {
    expect(
      scoreCandidate({
        sharesPlayerContainer: true,
        strongGeometry: true,
        verifiedBelowVideoRelation: true,
        shortLimitedLines: true,
      }),
    ).toBe(
      SCORE_WEIGHTS.sharesPlayerContainer +
        SCORE_WEIGHTS.strongGeometry +
        SCORE_WEIGHTS.shortLimitedLines,
    )
  })
})

describe('evaluateConnection', () => {
  const base = {
    score: 100,
    kind: 'generic-dom' as const,
    hasText: true,
    secondIndependentScore: null,
    changeCount: 2,
    changesWithinWindow: true,
    changeSpacingOk: true,
    mediaAdvanced: true,
  }

  it('genel DOM üçüncü uygun örnekten önce bağlanmaz', () => {
    expect(
      evaluateConnection({ ...base, changeCount: 0 }).ready,
    ).toBe(false)
    expect(
      evaluateConnection({ ...base, changeCount: 1 }).ready,
    ).toBe(false)
    expect(
      evaluateConnection({ ...base, changeCount: 2 }).ready,
    ).toBe(true)
  })

  it('iki güçlü bağımsız aday farkı 15 altındaysa bağlanma bekletilir', () => {
    expect(
      evaluateConnection({
        ...base,
        secondIndependentScore: 100 - (RIVAL_SCORE_GAP - 5),
      }).ready,
    ).toBe(false)
    expect(
      evaluateConnection({
        ...base,
        secondIndependentScore: 100 - (RIVAL_SCORE_GAP + 1),
      }).ready,
    ).toBe(true)
  })

  it('yerel kanal ve doğrulanmış oynatıcı davranış beklemez', () => {
    expect(
      evaluateConnection({
        ...base,
        kind: 'text-track',
        changeCount: 0,
      }).ready,
    ).toBe(true)
    expect(
      evaluateConnection({
        ...base,
        kind: 'player-dom',
        changeCount: 0,
      }).ready,
    ).toBe(true)
  })

  it('boş metin ve düşük puan bağlanmaz', () => {
    expect(evaluateConnection({ ...base, hasText: false }).ready).toBe(false)
    expect(
      evaluateConnection({ ...base, score: CONNECT_THRESHOLD - 1 }).ready,
    ).toBe(false)
  })
})

describe('CandidateHistory', () => {
  it('video zamanı ilerlerken en az 500 ms aralıklı değişimleri sayar', () => {
    const history = new CandidateHistory()
    history.record('One', 0, 1000)
    history.record('Two', 1, 1600)
    history.record('Three', 2, 2300)

    const metrics = history.metrics(2400)
    expect(metrics.changeCount).toBe(2)
    expect(metrics.spacingOk).toBe(true)
    expect(metrics.mediaAdvanced).toBe(true)
  })

  it('duraklamış videoda metin değişimi davranış kanıtı üretmez', () => {
    const history = new CandidateHistory()
    history.record('One', 1, 1000)
    history.record('Two', 1, 2000)
    expect(history.metrics(2100).changeCount).toBe(0)
  })

  it('500 ms altı değişimler sayılmaz', () => {
    const history = new CandidateHistory()
    history.record('One', 1, 1000)
    history.record('Two', 2, 1200)
    expect(history.metrics(1300).changeCount).toBe(0)
  })

  it('son 30 saniye dışındaki değişimler pencereye girmez', () => {
    const history = new CandidateHistory()
    history.record('One', 0, 1000)
    history.record('Two', 1, 2000)
    const metrics = history.metrics(40000)
    expect(metrics.changeCount).toBe(0)
    expect(metrics.withinWindow).toBe(false)
  })

  it('boş satırlar önceki metni silmez, sonraki satır değişim sayılır', () => {
    const history = new CandidateHistory()
    history.record('One', 0, 1000)
    history.record('Two', 1, 2000)
    history.record('Three', 2, 3000)
    expect(history.lastNonEmptyText).toBe('Three')
    expect(history.metrics(3100).changeCount).toBe(2)
  })

  it('en iyi puan boş satırda korunur', () => {
    const history = new CandidateHistory()
    history.updateBestScore(95)
    expect(history.getBestScore()).toBe(95)
  })
})
