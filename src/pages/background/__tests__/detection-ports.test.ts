import {
  deliverRevokeOrRelease,
  detectionStatusFailure,
  handleDetectionMessage,
  handleDetectionPortDisconnect,
  setCurrentDetectionPort,
} from '../detection-ports'
import { SourceCoordinator } from '../source-coordinator'
import { CandidateSummary } from '../../../types/detection'

function fakePort(name: string): chrome.runtime.Port {
  return { name } as chrome.runtime.Port
}

const TAB_ID = 7
const KEY = `${TAB_ID}:0`

function candidate(
  sourceId: string,
  overrides: Partial<CandidateSummary> = {},
): CandidateSummary {
  return {
    source: {
      documentId: 'doc',
      videoId: 'video',
      sourceId,
      generation: 1,
      kind: 'generic-dom',
    },
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

function update(candidates: CandidateSummary[], documentId = 'doc') {
  return {
    documentId,
    url: 'https://example.com/watch',
    phase: 'verifying' as const,
    reason: 'awaiting-source-grant',
    candidates,
    documentVisible: true,
    frameVisible: true,
    videoCount: 1,
    fullscreen: false,
    observedAt: 0,
  }
}

describe('detection port registry', () => {
  it('eski portun geç kapanması yeni oturumu silmez', () => {
    const ports = new Map<string, chrome.runtime.Port>()
    const oldPort = fakePort('old')
    const newPort = fakePort('new')
    ports.set(KEY, oldPort)
    ports.set(KEY, newPort)
    const unregister = jest.fn()

    const handled = handleDetectionPortDisconnect(ports, KEY, oldPort, unregister)

    expect(handled).toBe(false)
    expect(unregister).not.toHaveBeenCalled()
    expect(ports.get(KEY)).toBe(newPort)
  })

  it('güncel port kapanınca kaydı siler ve bir kez unregister çağırır', () => {
    const ports = new Map<string, chrome.runtime.Port>()
    const current = fakePort('current')
    ports.set(KEY, current)
    const unregister = jest.fn()

    const handled = handleDetectionPortDisconnect(ports, KEY, current, unregister)

    expect(handled).toBe(true)
    expect(unregister).toHaveBeenCalledTimes(1)
    expect(ports.has(KEY)).toBe(false)
  })

  it('bilinmeyen port için unregister çağırmaz', () => {
    const ports = new Map<string, chrome.runtime.Port>()
    const unregister = jest.fn()
    expect(
      handleDetectionPortDisconnect(ports, '1:2', fakePort('x'), unregister),
    ).toBe(false)
    expect(unregister).not.toHaveBeenCalled()
  })

  it('yeni port eskisini değiştirir ve eskisini döndürür', () => {
    const ports = new Map<string, chrome.runtime.Port>()
    const oldPort = fakePort('old')
    const newPort = fakePort('new')
    ports.set(KEY, oldPort)
    expect(setCurrentDetectionPort(ports, KEY, newPort)).toBe(oldPort)
    expect(ports.get(KEY)).toBe(newPort)
    expect(setCurrentDetectionPort(ports, KEY, newPort)).toBeNull()
  })

  it('eski portun geç gelen mesajı koordinatör sahipliğini bozmaz', () => {
    const coordinator = new SourceCoordinator({
      hooks: { grant: jest.fn(), revoke: jest.fn() },
    })
    coordinator.setEnabled(true)
    coordinator.update(TAB_ID, 0, update([candidate('caption')]))
    const owner = coordinator.getOwner(TAB_ID)
    expect(owner?.source.sourceId).toBe('caption')

    const ports = new Map<string, chrome.runtime.Port>()
    const oldPort = fakePort('old')
    const newPort = fakePort('new')
    setCurrentDetectionPort(ports, KEY, oldPort)
    setCurrentDetectionPort(ports, KEY, newPort)

    const handled = handleDetectionMessage(ports, KEY, oldPort, () => {
      // Eski documentId: gerçekte document-changed revoke'unu tetiklerdi.
      coordinator.update(TAB_ID, 0, update([], 'old-document'))
    })

    expect(handled).toBe(false)
    expect(coordinator.getOwner(TAB_ID)?.source.sourceId).toBe('caption')
  })

  it('güncel port mesajını işler', () => {
    const ports = new Map<string, chrome.runtime.Port>()
    const current = fakePort('current')
    setCurrentDetectionPort(ports, KEY, current)
    const handler = jest.fn()

    expect(handleDetectionMessage(ports, KEY, current, handler)).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('revoke iletilemezse eski sahipliği hemen serbest bırakır', () => {
    const release = jest.fn()
    expect(deliverRevokeOrRelease(() => true, release)).toBe(true)
    expect(release).not.toHaveBeenCalled()

    expect(deliverRevokeOrRelease(() => false, release)).toBe(false)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('revoke iletilemezse koordinatör bekleyen kaynağa hemen geçer', () => {
    const grants: Array<{ frameId: number }> = []
    let coordinator: SourceCoordinator
    coordinator = new SourceCoordinator({
      hooks: {
        grant: (request) => grants.push({ frameId: request.frameId }),
        revoke: (request) => {
          deliverRevokeOrRelease(
            () => false,
            () => coordinator.release(TAB_ID, request.frameId, request.token),
          )
        },
      },
    })
    coordinator.setEnabled(true)
    coordinator.update(TAB_ID, 0, update([candidate('frame0-caption')]))
    coordinator.update(
      TAB_ID,
      1,
      update([candidate('frame1-caption', { fullscreen: true })]),
    )

    expect(grants).toHaveLength(2)
    expect(grants[1].frameId).toBe(1)
  })

  it('durum hatası enabled bilgisini korur ve tutarlı faz döndürür', () => {
    expect(detectionStatusFailure(true)).toEqual({
      type: 'DETECTION_STATUS',
      enabled: true,
      status: { phase: 'unavailable', reason: 'status-unavailable' },
    })
    expect(detectionStatusFailure(false)).toEqual({
      type: 'DETECTION_STATUS',
      enabled: false,
      status: { phase: 'disabled', reason: 'extension-disabled' },
    })
  })
})
