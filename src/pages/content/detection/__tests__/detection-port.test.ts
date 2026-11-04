import { DetectionPort } from '../detection-port'
import {
  DetectionFrameReport,
  DetectionTransportHandlers,
  SourceRef,
} from '../../../../types/detection'
import { setContentPageSuspended } from '../../page-lifecycle'

const SOURCE: SourceRef = {
  documentId: 'doc',
  videoId: 'video',
  sourceId: 'caption',
  generation: 1,
  kind: 'generic-dom',
}

function report(): DetectionFrameReport {
  return {
    documentId: 'doc',
    url: 'https://example.com',
    phase: 'verifying',
    reason: 'awaiting-source-grant',
    candidates: [],
    documentVisible: true,
    frameVisible: true,
    videoCount: 1,
    fullscreen: false,
    observedAt: 0,
  }
}

class FakePort {
  public messageListeners: Array<(message: any) => void> = []
  public disconnectListeners: Array<() => void> = []
  public posted: any[] = []
  public disconnected = false
  public onMessage = {
    addListener: (fn: (message: any) => void) => {
      this.messageListeners.push(fn)
    },
  }
  public onDisconnect = {
    addListener: (fn: () => void) => {
      this.disconnectListeners.push(fn)
    },
  }
  public postMessage(message: any): void {
    this.posted.push(message)
  }
  public disconnect(): void {
    this.disconnected = true
    this.disconnectListeners.forEach((fn) => fn())
  }
  public receive(message: any): void {
    this.messageListeners.forEach((fn) => fn(message))
  }
}

function handlers() {
  const calls = {
    grant: jest.fn(),
    revoke: jest.fn(),
    disconnect: jest.fn(),
    expired: jest.fn(),
  }
  const value: DetectionTransportHandlers = {
    onGrant: calls.grant,
    onRevoke: calls.revoke,
    onDisconnect: calls.disconnect,
    onAuthorityExpired: calls.expired,
  }
  return { calls, value }
}

function setRuntimeLastError(
  error: chrome.runtime.LastError | undefined,
): jest.Mock {
  const getter = jest.fn(() => error)
  ;(global as any).chrome = { runtime: {} }
  Object.defineProperty((global as any).chrome.runtime, 'lastError', {
    configurable: true,
    get: getter,
  })
  return getter
}

beforeEach(() => {
  jest.useFakeTimers()
})

afterEach(() => {
  setContentPageSuspended(false)
  delete (global as any).chrome
  jest.useRealTimers()
})

describe('DetectionPort', () => {
  it('kayıt ve güncellemeyi port üzerinden gönderir', () => {
    const port = new FakePort()
    const transport = new DetectionPort({
      documentId: 'doc',
      url: 'https://example.com',
      connect: () => port as any,
    })
    const { value } = handlers()
    transport.start(null, value)

    expect(port.posted[0].type).toBe('DETECTION_REGISTER')
    transport.update(report())
    expect(
      port.posted.some((message) => message.type === 'DETECTION_UPDATE'),
    ).toBe(true)
    transport.stop()
  })

  it('iki saniyede heartbeat gönderir', () => {
    const port = new FakePort()
    const transport = new DetectionPort({
      documentId: 'doc',
      url: 'https://example.com',
      connect: () => port as any,
    })
    const { value, calls } = handlers()
    transport.start(null, value)
    port.receive({
      type: 'SOURCE_GRANT',
      token: 't1',
      source: SOURCE,
      expiresAt: Date.now() + 6000,
    })
    expect(calls.grant).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(2000)
    expect(
      port.posted.some(
        (message) => message.type === 'SOURCE_HEARTBEAT' && message.token === 't1',
      ),
    ).toBe(true)
    transport.stop()
  })

  it('altı saniye yenilenmeyen yetkiyi sona erdirir', () => {
    const port = new FakePort()
    const transport = new DetectionPort({
      documentId: 'doc',
      url: 'https://example.com',
      connect: () => port as any,
    })
    const { value, calls } = handlers()
    transport.start(null, value)
    port.receive({
      type: 'SOURCE_GRANT',
      token: 't1',
      source: SOURCE,
      expiresAt: Date.now() + 6000,
    })
    jest.advanceTimersByTime(7000)
    expect(calls.expired).toHaveBeenCalled()
    expect(transport.authority()).toBeNull()
    transport.stop()
  })

  it('geç kalmış revoke yeni tokenı etkisizleştirmez', () => {
    const port = new FakePort()
    const transport = new DetectionPort({
      documentId: 'doc',
      url: 'https://example.com',
      connect: () => port as any,
    })
    const { value, calls } = handlers()
    transport.start(null, value)
    port.receive({
      type: 'SOURCE_GRANT',
      token: 't1',
      source: SOURCE,
      expiresAt: Date.now() + 6000,
    })
    port.receive({
      type: 'SOURCE_GRANT',
      token: 't2',
      source: { ...SOURCE, sourceId: 'caption2' },
      expiresAt: Date.now() + 6000,
    })
    port.receive({ type: 'SOURCE_REVOKE', token: 't1', reason: 'expired' })

    expect(calls.revoke).not.toHaveBeenCalled()
    expect(transport.authority()?.token).toBe('t2')
    transport.stop()
  })

  it('port kapanınca yetkiyi bırakır ve yeniden bağlanır', () => {
    const ports: FakePort[] = []
    const transport = new DetectionPort({
      documentId: 'doc',
      url: 'https://example.com',
      connect: () => {
        const port = new FakePort()
        ports.push(port)
        return port as any
      },
    })
    const { value, calls } = handlers()
    transport.start(null, value)
    ports[0].receive({
      type: 'SOURCE_GRANT',
      token: 't1',
      source: SOURCE,
      expiresAt: Date.now() + 6000,
    })
    expect(transport.authority()).not.toBeNull()

    ports[0].disconnect()
    expect(calls.disconnect).toHaveBeenCalled()
    expect(transport.authority()).toBeNull()

    jest.advanceTimersByTime(1000)
    expect(ports.length).toBe(2)
    expect(ports[1].posted[0].type).toBe('DETECTION_REGISTER')
    transport.stop()
  })

  it('BFCache kapanışını sayfa askıdayken yeniden bağlanmadan karşılar', () => {
    const ports: FakePort[] = []
    const transport = new DetectionPort({
      documentId: 'doc',
      url: 'https://example.com',
      connect: () => {
        const port = new FakePort()
        ports.push(port)
        return port as any
      },
    })
    const { value, calls } = handlers()
    transport.start(null, value)
    setContentPageSuspended(true)
    setRuntimeLastError({
      message:
        'The page keeping the extension port is moved into back/forward cache, so the message channel is closed.',
    })

    ports[0].disconnect()
    expect(calls.disconnect).toHaveBeenCalledWith('port-bfcache')
    jest.advanceTimersByTime(5000)
    expect(ports).toHaveLength(1)
    transport.stop()
  })

  it('lastError sahiplik erken dönüşünden önce okunur', () => {
    const port = new FakePort()
    const transport = new DetectionPort({
      documentId: 'doc',
      url: 'https://example.com',
      connect: () => port as any,
    })
    transport.start(null, handlers().value)
    const getter = setRuntimeLastError({ message: 'late-close' })

    transport.stop()

    expect(getter).toHaveBeenCalled()
  })

  it('BFCache hatası sayfa askıda değilse reconnect planlar', () => {
    const ports: FakePort[] = []
    const transport = new DetectionPort({
      documentId: 'doc',
      url: 'https://example.com',
      connect: () => {
        const port = new FakePort()
        ports.push(port)
        return port as any
      },
    })
    const { value, calls } = handlers()
    transport.start(null, value)
    setContentPageSuspended(false)
    setRuntimeLastError({
      message:
        'The page keeping the extension port is moved into back/forward cache, so the message channel is closed.',
    })

    ports[0].disconnect()
    expect(calls.disconnect).toHaveBeenCalledWith('port-bfcache')
    jest.advanceTimersByTime(1000)
    expect(ports).toHaveLength(2)
    transport.stop()
  })

  it('BFCache dışı port hatasını kararlı enum nedeniyle iletir', () => {
    const debug = jest.spyOn(console, 'debug').mockImplementation()
    const ports: FakePort[] = []
    const transport = new DetectionPort({
      documentId: 'doc',
      url: 'https://example.com',
      connect: () => {
        const port = new FakePort()
        ports.push(port)
        return port as any
      },
    })
    const { value, calls } = handlers()
    transport.start(null, value)
    setRuntimeLastError({ message: 'unexpected-close' })

    ports[0].disconnect()
    expect(calls.disconnect).toHaveBeenCalledWith('port-closed')
    jest.advanceTimersByTime(1000)
    expect(ports.length).toBe(2)
    transport.stop()
    debug.mockRestore()
  })

  it('stop sonrası heartbeat ve güncelleme göndermez', () => {
    const port = new FakePort()
    const transport = new DetectionPort({
      documentId: 'doc',
      url: 'https://example.com',
      connect: () => port as any,
    })
    const { value } = handlers()
    transport.start(null, value)
    transport.stop()
    const before = port.posted.length
    jest.advanceTimersByTime(10000)
    expect(port.posted.length).toBe(before)
  })
})
