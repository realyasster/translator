import {
  isBackForwardCachePortError,
  isExpectedBfcachePortClose,
  readRuntimeLastError,
} from '../port-errors'

describe('port error helpers', () => {
  it('BFCache kapanış mesajını normal lifecycle olarak sınıflar', () => {
    expect(
      isBackForwardCachePortError({
        message:
          'The page keeping the extension port is moved into back/forward cache, so the message channel is closed.',
      } as chrome.runtime.LastError),
    ).toBe(true)
  })

  it('diğer port hatalarını BFCache saymaz', () => {
    expect(
      isBackForwardCachePortError({
        message: 'Could not establish connection. Receiving end does not exist.',
      } as chrome.runtime.LastError),
    ).toBe(false)
    expect(isBackForwardCachePortError(undefined)).toBe(false)
  })

  it('askı durumu ana sinyaldir; metin yalnız yedektir', () => {
    expect(isExpectedBfcachePortClose(undefined, true)).toBe(true)
    expect(isExpectedBfcachePortClose({ message: 'bfcache' } as any, false)).toBe(
      true,
    )
    expect(isExpectedBfcachePortClose({ message: 'boom' } as any, false)).toBe(
      false,
    )
  })

  it('lastError getter erken dönüşlerden önce okunabilir', () => {
    const getter = jest.fn(() => ({ message: 'boom' }))
    ;(global as any).chrome = {
      runtime: {},
    }
    Object.defineProperty((global as any).chrome.runtime, 'lastError', {
      configurable: true,
      get: getter,
    })

    expect(readRuntimeLastError()?.message).toBe('boom')
    expect(getter).toHaveBeenCalledTimes(1)
  })
})
