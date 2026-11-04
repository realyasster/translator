import {
  CTRANSLATE2_NATIVE_HOST_NAME,
  CTRANSLATE2_NATIVE_TIMEOUT_MS,
  CT2_HOST_VERSION,
  CTranslate2NativeHostError,
  detectNativeBrowser,
  getCTranslate2NativeServerStatus,
  isValidChromeExtensionId,
  listCTranslate2NativeModels,
  pingCTranslate2NativeHost,
  sendCTranslate2NativeMessage,
  startCTranslate2NativeServer,
  stopCTranslate2NativeServer,
} from '../ctranslate2-native-host'
import { getDefaultCTranslate2ServerSettings } from '../ctranslate2-server-settings'

const HEALTH = {
  status: 'ready' as const,
  model: 'facebook/nllb-200-distilled-600M',
  model_dir: 'nllb-200-distilled-600M',
  device: 'cpu',
  compute_type: 'int8',
  max_input_tokens: 512,
}

function installChrome(
  callback: (
    host: string,
    request: Record<string, unknown>,
    sendResponse: (response: unknown) => void,
  ) => void,
) {
  const runtime: Record<string, unknown> = {
    sendNativeMessage: jest.fn(
      (
        host: string,
        request: Record<string, unknown>,
        sendResponse: (response: unknown) => void,
      ) => callback(host, request, sendResponse),
    ),
    lastError: undefined,
  }
  ;(global as any).chrome = { runtime }
  return runtime
}

describe('CTranslate2 native host client', () => {
  afterEach(() => {
    delete (global as any).chrome
    jest.useRealTimers()
  })

  it('uses a timeout with enough margin over the host start deadline', () => {
    expect(CTRANSLATE2_NATIVE_TIMEOUT_MS).toBeGreaterThanOrEqual(60000)
  })

  it('keeps the expected host version in sync with the server', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../server/src/ct2_nllb_server/native_host.py',
      ),
      'utf8',
    )
    const match = String(source).match(/^HOST_VERSION = (\d+)$/m)
    expect(match).not.toBeNull()
    expect(Number(match?.[1])).toBe(CT2_HOST_VERSION)
  })

  it('validates Chromium extension IDs and detects Edge', () => {
    expect(isValidChromeExtensionId('a'.repeat(32))).toBe(true)
    expect(isValidChromeExtensionId('not-a-valid-id')).toBe(false)
    expect(isValidChromeExtensionId('z'.repeat(32))).toBe(false)
    expect(detectNativeBrowser('Mozilla/5.0 Chrome/120')).toBe('chrome')
    expect(detectNativeBrowser('Mozilla/5.0 Edg/120')).toBe('edge')
  })

  it('pings the installed host and validates the response', async () => {
    const runtime = installChrome((host, request, send) => {
      expect(host).toBe(CTRANSLATE2_NATIVE_HOST_NAME)
      expect(request).toEqual({ action: 'ping' })
      send({ ok: true, action: 'ping', hostVersion: 1 })
    })
    await expect(pingCTranslate2NativeHost()).resolves.toEqual({
      action: 'ping',
      state: undefined,
      managed: undefined,
      pid: undefined,
      hostVersion: 1,
      health: undefined,
    })
    expect(runtime.sendNativeMessage).toHaveBeenCalled()
  })

  it('maps a missing host error to a specific code', async () => {
    installChrome((_host, _request, send) => {
      ;(chrome.runtime as any).lastError = {
        message: 'Specified native messaging host not found.',
      }
      send(undefined)
      ;(chrome.runtime as any).lastError = undefined
    })
    await expect(pingCTranslate2NativeHost()).rejects.toMatchObject({
      code: 'native_host_not_installed',
    })
  })

  it('rejects native error responses', async () => {
    installChrome((_host, _request, send) =>
      send({
        ok: false,
        action: 'stop',
        code: 'not_managed',
        message: 'No managed server is running.',
      }),
    )
    await expect(stopCTranslate2NativeServer()).rejects.toMatchObject({
      code: 'not_managed',
    })
  })

  it('sends the host/port to stop an external server', async () => {
    installChrome((_host, request, send) => {
      expect(request).toEqual({
        action: 'stop',
        settings: { host: 'localhost', port: 9000 },
      })
      send({ ok: true, action: 'stop', state: 'stopped', managed: false })
    })
    await expect(
      stopCTranslate2NativeServer({ host: 'localhost', port: 9000 }),
    ).resolves.toMatchObject({ state: 'stopped' })
  })

  it('rejects malformed success responses', async () => {
    installChrome((_host, _request, send) => send({ ok: true }))
    await expect(pingCTranslate2NativeHost()).rejects.toBeInstanceOf(
      CTranslate2NativeHostError,
    )
  })

  it('passes only validated startup settings to start', async () => {
    const settings = {
      ...getDefaultCTranslate2ServerSettings('Linux'),
      modelDirectory: 'D:\\My Models\\NLLB',
      device: 'cuda' as const,
      computeType: 'int8_float16' as const,
      host: 'localhost' as const,
      port: 9123,
      logLevel: 'debug' as const,
    }
    let captured: Record<string, unknown> | undefined
    installChrome((_host, request, send) => {
      captured = request
      send({ ok: true, action: 'start', state: 'running', managed: true, health: HEALTH })
    })

    await startCTranslate2NativeServer(
      settings,
      'facebook/nllb-200-distilled-600M',
    )
    expect(captured).toEqual({
      action: 'start',
      selectedModel: 'facebook/nllb-200-distilled-600M',
      settings: {
        modelDirectory: 'D:\\My Models\\NLLB',
        device: 'cuda',
        computeType: 'int8_float16',
        host: 'localhost',
        port: 9123,
        logLevel: 'debug',
      },
    })
  })

  it('sends status host/port and returns health', async () => {
    installChrome((_host, request, send) => {
      expect(request).toEqual({
        action: 'status',
        settings: { host: '127.0.0.1', port: 8000 },
      })
      send({
        ok: true,
        action: 'status',
        state: 'external_running',
        managed: false,
        health: HEALTH,
      })
    })
    await expect(
      getCTranslate2NativeServerStatus({ host: '127.0.0.1', port: 8000 }),
    ).resolves.toMatchObject({
      state: 'external_running',
      managed: false,
      health: HEALTH,
    })
  })

  it('lists prepared models through the native host', async () => {
    installChrome((_host, request, send) => {
      expect(request).toEqual({ action: 'list_models' })
      send({
        ok: true,
        action: 'list_models',
        models: [
          {
            directory: '/models/nllb',
            name: 'nllb',
            model_id: 'facebook/nllb-test',
            family: 'nllb',
            revision: 'abc',
            valid: true,
            problem: null,
          },
        ],
      })
    })

    await expect(listCTranslate2NativeModels()).resolves.toMatchObject({
      action: 'list_models',
      models: [
        {
          directory: '/models/nllb',
          model_id: 'facebook/nllb-test',
          family: 'nllb',
          valid: true,
        },
      ],
    })
  })

  it('rejects an invalid model list response', async () => {
    installChrome((_host, _request, send) => {
      send({
        ok: true,
        action: 'list_models',
        models: [{ name: 'broken' }],
      })
    })

    await expect(listCTranslate2NativeModels()).rejects.toMatchObject({
      code: 'native_host_invalid_response',
    })
  })

  it('times out when the native host never answers', async () => {
    jest.useFakeTimers()
    installChrome(() => {
      // Deliberately never answer.
    })
    const pending = sendCTranslate2NativeMessage(
      { action: 'status' },
      1000,
    )
    jest.advanceTimersByTime(1000)
    await expect(pending).rejects.toMatchObject({
      code: 'native_host_timeout',
    })
  })
})
