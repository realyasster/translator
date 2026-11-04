import { SourceCoordinator } from '../source-coordinator'
import {
  FrameUpdate,
  GrantRequest,
  RevokeRequest,
} from '../source-coordinator'
import {
  CandidateSummary,
  CONNECT_THRESHOLD,
  RIVAL_SCORE_GAP,
  SourceRef,
} from '../../../types/detection'

const DOCUMENT_ID = 'doc_test'
const TAB_ID = 7

function source(sourceId: string, kind: SourceRef['kind'] = 'generic-dom'): SourceRef {
  return {
    documentId: DOCUMENT_ID,
    videoId: 'video_1',
    sourceId,
    generation: 1,
    kind,
  }
}

function candidate(
  sourceId: string,
  overrides: Partial<CandidateSummary> = {},
): CandidateSummary {
  return {
    source: source(sourceId),
    score: 100,
    kind: 'generic-dom',
    ready: true,
    hasText: true,
    playing: true,
    fullscreen: false,
    visible: true,
    visibleArea: 100000,
    ...overrides,
  }
}

function update(
  candidates: CandidateSummary[],
  overrides: Partial<FrameUpdate> = {},
): FrameUpdate {
  return {
    documentId: DOCUMENT_ID,
    url: 'https://example.com/watch',
    phase: 'verifying',
    reason: 'awaiting-source-grant',
    candidates,
    documentVisible: true,
    frameVisible: true,
    videoCount: 1,
    fullscreen: false,
    observedAt: 0,
    ...overrides,
  }
}

interface Harness {
  coordinator: SourceCoordinator
  grants: GrantRequest[]
  revokes: RevokeRequest[]
  clock: { now: number }
}

function createHarness(): Harness {
  const grants: GrantRequest[] = []
  const revokes: RevokeRequest[] = []
  const clock = { now: 0 }
  let tokenCounter = 0
  const coordinator = new SourceCoordinator({
    now: () => clock.now,
    createToken: () => `token_${++tokenCounter}`,
    switchHoldMs: 2000,
    ownershipTimeoutMs: 6000,
    hooks: {
      grant: (request) => grants.push(request),
      revoke: (request) => revokes.push(request),
    },
  })
  // Koordinatör fail-closed başlar; bu harness açık eklentiyi temsil eder.
  coordinator.setEnabled(true)
  return { coordinator, grants, revokes, clock }
}

describe('SourceCoordinator', () => {
  it('aynı sekmedeki iki frame için tek yetkili kaynak verir', () => {
    const { coordinator, grants } = createHarness()
    coordinator.update(TAB_ID, 0, update([candidate('frame0-caption')]))
    expect(grants).toHaveLength(1)
    expect(grants[0].frameId).toBe(0)

    coordinator.update(
      TAB_ID,
      1,
      update([candidate('frame1-caption', { visibleArea: 200000 })]),
    )
    expect(grants).toHaveLength(1)
  })

  it('daha büyük alanlı rakip iki saniye üstünlük kurmadan devralmaz', () => {
    const { coordinator, grants, revokes, clock } = createHarness()
    coordinator.update(TAB_ID, 0, update([candidate('frame0-caption')]))
    const firstToken = grants[0].token

    coordinator.update(
      TAB_ID,
      1,
      update([candidate('frame1-caption', { visibleArea: 150000 })]),
    )
    clock.now = 1999
    coordinator.update(
      TAB_ID,
      1,
      update([candidate('frame1-caption', { visibleArea: 150000 })]),
    )
    expect(revokes).toHaveLength(0)

    clock.now = 2001
    coordinator.update(
      TAB_ID,
      1,
      update([candidate('frame1-caption', { visibleArea: 150000 })]),
    )
    expect(revokes).toHaveLength(1)
    expect(revokes[0].token).toBe(firstToken)

    // Eski sahip bıraktığını onaylamadan yeni sahip etkinleşmez.
    expect(grants).toHaveLength(1)
    coordinator.release(TAB_ID, 0, firstToken)
    expect(grants).toHaveLength(2)
    expect(grants[1].frameId).toBe(1)
  })

  it('tam ekran rakip bekleme olmadan devralır', () => {
    const { coordinator, grants, revokes } = createHarness()
    coordinator.update(TAB_ID, 0, update([candidate('frame0-caption')]))
    coordinator.update(
      TAB_ID,
      1,
      update([candidate('frame1-caption', { fullscreen: true })]),
    )
    expect(revokes).toHaveLength(1)
    const oldToken = grants[0].token
    coordinator.release(TAB_ID, 0, oldToken)
    expect(grants[1].frameId).toBe(1)
  })

  it('alan avantajı %25 altındaysa devralmaz', () => {
    const { coordinator, revokes, clock } = createHarness()
    coordinator.update(TAB_ID, 0, update([candidate('frame0-caption')]))
    coordinator.update(
      TAB_ID,
      1,
      update([candidate('frame1-caption', { visibleArea: 120000 })]),
    )
    clock.now = 5000
    coordinator.update(
      TAB_ID,
      1,
      update([candidate('frame1-caption', { visibleArea: 120000 })]),
    )
    expect(revokes).toHaveLength(0)
  })

  it('puan avantajı ve iki saniye sürmeden kaynak devralınmaz', () => {
    const { coordinator, grants, revokes, clock } = createHarness()
    coordinator.update(
      TAB_ID,
      0,
      update([candidate('frame0-caption', { score: CONNECT_THRESHOLD })]),
    )
    coordinator.update(
      TAB_ID,
      1,
      update([
        candidate('frame1-caption', {
          score: CONNECT_THRESHOLD + RIVAL_SCORE_GAP,
          // %25 alan avantajı yok; devralma yalnızca puan farkıyla olur.
          visibleArea: 110000,
        }),
      ]),
    )
    expect(revokes).toHaveLength(0)

    clock.now = 2001
    coordinator.update(
      TAB_ID,
      1,
      update([
        candidate('frame1-caption', {
          score: CONNECT_THRESHOLD + RIVAL_SCORE_GAP,
          visibleArea: 110000,
        }),
      ]),
    )
    expect(revokes).toHaveLength(1)
    const oldToken = grants[0].token
    coordinator.release(TAB_ID, 0, oldToken)
    expect(grants[1].frameId).toBe(1)
  })

  it('görünmez iframe kaynak sahibi olamaz', () => {
    const { coordinator, grants } = createHarness()
    coordinator.update(
      TAB_ID,
      0,
      update([candidate('hidden-caption')], { frameVisible: false }),
    )
    expect(grants).toHaveLength(0)
  })

  it('heartbeat yetkiyi yeniler, süre dolunca eski token geçersiz olur', () => {
    const { coordinator, grants, clock } = createHarness()
    coordinator.update(TAB_ID, 0, update([candidate('caption')]))
    const token = grants[0].token

    clock.now = 2000
    const renewed = coordinator.heartbeat(TAB_ID, 0, token)
    expect(renewed.renewed).toBe(true)
    expect(coordinator.validate(TAB_ID, 0, token, source('caption')).valid).toBe(
      true,
    )

    clock.now = 9000
    const late = coordinator.heartbeat(TAB_ID, 0, token)
    expect(late.renewed).toBe(false)
    expect(
      coordinator.validate(TAB_ID, 0, token, source('caption')).valid,
    ).toBe(false)
  })

  it('yanlış token, frame veya kaynak çeviri isteğini reddeder', () => {
    const { coordinator, grants } = createHarness()
    coordinator.update(TAB_ID, 0, update([candidate('caption')]))
    const token = grants[0].token

    expect(coordinator.validate(TAB_ID, 0, token, source('caption')).valid).toBe(
      true,
    )
    expect(coordinator.validate(TAB_ID, 0, 'wrong', source('caption')).valid).toBe(
      false,
    )
    expect(coordinator.validate(TAB_ID, 1, token, source('caption')).valid).toBe(
      false,
    )
    expect(
      coordinator.validate(TAB_ID, 0, token, source('other-caption')).valid,
    ).toBe(false)
  })

  it('port kapanınca sahiplik serbest kalır ve diğer frame yetki alır', () => {
    const { coordinator, grants } = createHarness()
    coordinator.update(TAB_ID, 0, update([candidate('frame0-caption')]))
    coordinator.update(TAB_ID, 1, update([candidate('frame1-caption')]))
    expect(grants).toHaveLength(1)

    coordinator.unregister(TAB_ID, 0)
    expect(grants).toHaveLength(2)
    expect(grants[1].frameId).toBe(1)
  })

  it('kaynak kaybolunca sahiplik hemen kaldırılır, iki saniye beklenmez', () => {
    const { coordinator, grants, revokes } = createHarness()
    coordinator.update(TAB_ID, 0, update([candidate('caption')]))
    const token = grants[0].token
    coordinator.update(TAB_ID, 0, update([]))
    expect(revokes).toHaveLength(1)
    expect(revokes[0].token).toBe(token)

    coordinator.release(TAB_ID, 0, token)
    expect(coordinator.getOwner(TAB_ID)).toBeNull()
  })

  it('kaynak değişiminde eski sahip bırakınca yeni kaynak yetki alır', () => {
    const { coordinator, grants, revokes } = createHarness()
    coordinator.update(TAB_ID, 0, update([candidate('caption-v1')]))
    const oldToken = grants[0].token

    coordinator.update(
      TAB_ID,
      0,
      update([
        candidate('caption-v2', {
          source: { ...source('caption-v2'), generation: 2 },
        }),
      ]),
    )
    expect(revokes).toHaveLength(1)
    coordinator.release(TAB_ID, 0, oldToken)

    expect(grants).toHaveLength(2)
    expect(grants[1].source.sourceId).toBe('caption-v2')
    expect(grants[1].source.generation).toBe(2)
  })

  it('background yeniden başlayınca eski token ile çeviri yapılamaz', () => {
    const first = createHarness()
    first.coordinator.update(TAB_ID, 0, update([candidate('caption')]))
    const token = first.grants[0].token

    const second = createHarness()
    expect(
      second.coordinator.validate(TAB_ID, 0, token, source('caption')).valid,
    ).toBe(false)
    // Yeniden başlatma sonrası frame yeniden kayıt olana kadar durum
    // "searching/no-frame" gösterir; kısa süre sonra yeni token verilir.
    expect(second.coordinator.status(TAB_ID)).toEqual({
      phase: 'searching',
      reason: 'no-frame',
    })

    second.coordinator.update(TAB_ID, 0, update([candidate('caption')]))
    expect(second.grants).toHaveLength(1)
    expect(
      second.coordinator.validate(
        TAB_ID,
        0,
        second.grants[0].token,
        source('caption'),
      ).valid,
    ).toBe(true)
  })

  it('storage okunmadan yetki verilmez (fail-closed)', () => {
    const grants: GrantRequest[] = []
    const coordinator = new SourceCoordinator({
      hooks: { grant: (request) => grants.push(request), revoke: jest.fn() },
    })
    // setEnabled çağrılmadı: eklenti durumu bilinmiyor.
    coordinator.update(TAB_ID, 0, update([candidate('caption')]))
    expect(grants).toHaveLength(0)
    expect(coordinator.status(TAB_ID).phase).toBe('disabled')

    coordinator.setEnabled(true)
    expect(grants).toHaveLength(1)
    expect(grants[0].source.sourceId).toBe('caption')
  })

  it('revokeAll sahipliği revoke hook çağrılmadan önce bırakır', () => {
    const grants: GrantRequest[] = []
    const ownersDuringRevoke: unknown[] = []
    let coordinator: SourceCoordinator
    coordinator = new SourceCoordinator({
      hooks: {
        grant: (request) => grants.push(request),
        revoke: (request) => {
          // Port yokmuş gibi reentrant fallback release çağrılır.
          ownersDuringRevoke.push(coordinator.getOwner(TAB_ID))
          coordinator.release(TAB_ID, request.frameId, request.token)
        },
      },
    })
    coordinator.setEnabled(true)
    coordinator.update(TAB_ID, 0, update([candidate('caption')]))
    expect(grants).toHaveLength(1)

    expect(() => coordinator.setEnabled(false)).not.toThrow()
    expect(ownersDuringRevoke).toEqual([null])
    expect(coordinator.getOwner(TAB_ID)).toBeNull()
    expect(grants).toHaveLength(1)
  })

  it('eklenti kapalıyken yeni yetki verilmez, açılınca yeniden değerlendirilir', () => {
    const { coordinator, grants, revokes } = createHarness()
    coordinator.update(TAB_ID, 0, update([candidate('caption')]))
    expect(grants).toHaveLength(1)
    const oldToken = grants[0].token

    coordinator.setEnabled(false)
    expect(revokes).toHaveLength(1)
    expect(revokes[0].token).toBe(oldToken)
    expect(coordinator.status(TAB_ID).phase).toBe('disabled')
    expect(coordinator.validate(TAB_ID, 0, oldToken, source('caption')).valid).toBe(
      false,
    )

    // Kapanmışken gelen güncelleme yeni yetki üretmez.
    coordinator.update(TAB_ID, 0, update([candidate('caption')]))
    expect(grants).toHaveLength(1)

    coordinator.setEnabled(true)
    expect(grants).toHaveLength(2)
    expect(coordinator.status(TAB_ID).phase).toBe('verifying')
    expect(
      coordinator.validate(TAB_ID, 0, grants[1].token, source('caption')).valid,
    ).toBe(true)
  })

  it('revokeAll tüm sahiplere iptal gönderir', () => {
    const { coordinator, grants, revokes } = createHarness()
    coordinator.update(TAB_ID, 0, update([candidate('caption')]))
    expect(grants).toHaveLength(1)
    coordinator.revokeAll('disabled')
    expect(revokes).toHaveLength(1)
    expect(revokes[0].reason).toBe('disabled')
    expect(coordinator.getOwner(TAB_ID)).toBeNull()
  })

  it('durum aktif sahibin kaynağını ve fazını döndürür', () => {
    const { coordinator, grants } = createHarness()
    coordinator.update(TAB_ID, 0, update([candidate('caption')], {
      phase: 'connected',
      reason: 'connected',
    }))
    const status = coordinator.status(TAB_ID)
    expect(status.phase).toBe('connected')
    expect(status.source?.sourceId).toBe('caption')
    expect(status.frameId).toBe(0)
    expect(grants[0].frameId).toBe(0)
  })

  it('ikinci güncelleme aynı sahibi yeniden yetkilendirmez', () => {
    const { coordinator, grants } = createHarness()
    coordinator.update(TAB_ID, 0, update([candidate('caption')]))
    coordinator.update(TAB_ID, 0, update([candidate('caption')]))
    expect(grants).toHaveLength(1)
  })

  it('eşit adaylarda kararlı frame/video kimliği kullanılır', () => {
    const { coordinator, grants } = createHarness()
    coordinator.update(TAB_ID, 1, update([candidate('z-caption')]))
    const first = grants[0]
    expect(first.frameId).toBe(1)
    // Aynı anda gelen eşit aday mevcut sahibi hemen devirmemeli.
    coordinator.update(TAB_ID, 0, update([candidate('a-caption')]))
    expect(grants).toHaveLength(1)
  })
})
