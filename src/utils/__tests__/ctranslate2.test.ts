import {
  CTranslate2AbortError,
  CTranslate2RequestError,
  CTranslate2TimeoutError,
  buildCTranslate2Request,
  fetchCTranslate2Health,
  requestCTranslate2Translation,
  resolveNllbLanguageCode,
} from '../ctranslate2'
import { runCTranslate2Diagnostic } from '../diagnostics'

const BASE_CONFIG = {
  apiKey: '',
  baseURL: 'http://127.0.0.1:8000',
  modelName: 'facebook/nllb-200-distilled-600M',
  sourceLanguage: 'English',
  targetLanguage: 'Turkish',
}

const EXPECTED_CODES: Record<string, string> = {
  English: 'eng_Latn',
  Turkish: 'tur_Latn',
  Chinese: 'zho_Hans',
  Spanish: 'spa_Latn',
  French: 'fra_Latn',
  German: 'deu_Latn',
  Portuguese: 'por_Latn',
  Italian: 'ita_Latn',
  Russian: 'rus_Cyrl',
  Japanese: 'jpn_Jpan',
  Korean: 'kor_Hang',
  Arabic: 'arb_Arab',
  Dutch: 'nld_Latn',
  Polish: 'pol_Latn',
}

function response(body: unknown, status = 200, ok = status < 400) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () =>
      typeof body === 'string' ? body : JSON.stringify(body),
  } as unknown as Response
}

describe('NLLB language mapping', () => {
  it('maps all fourteen UI languages explicitly and never guesses unknown names', () => {
    for (const [label, code] of Object.entries(EXPECTED_CODES)) {
      expect(resolveNllbLanguageCode(label)).toBe(code)
      expect(resolveNllbLanguageCode(label.toLowerCase())).toBe(code)
      expect(resolveNllbLanguageCode(code)).toBe(code)
    }
    expect(resolveNllbLanguageCode('Klingon')).toBeNull()
    expect(resolveNllbLanguageCode('')).toBeNull()
    expect(resolveNllbLanguageCode(undefined)).toBeNull()
  })

  it('builds the exact snake_case request body and uses English default source', () => {
    expect(
      buildCTranslate2Request(
        { ...BASE_CONFIG, sourceLanguage: undefined },
        'Hello',
      ),
    ).toEqual({
      model: 'facebook/nllb-200-distilled-600M',
      text: 'Hello',
      source_lang: 'eng_Latn',
      target_lang: 'tur_Latn',
    })
  })

  it('rejects unknown source or target instead of falling back', () => {
    expect(() =>
      buildCTranslate2Request(
        { ...BASE_CONFIG, sourceLanguage: 'Unknown' },
        'Hello',
      ),
    ).toThrow(/Unsupported CTranslate2 source language/)
    expect(() =>
      buildCTranslate2Request(
        { ...BASE_CONFIG, targetLanguage: 'Unknown' },
        'Hello',
      ),
    ).toThrow(/Unsupported CTranslate2 target language/)
  })
})

describe('CTranslate2 HTTP client', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.useRealTimers()
  })

  it('posts JSON and returns translatedText', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(response({ translatedText: 'Merhaba' }))
    global.fetch = fetchMock as any

    await expect(
      requestCTranslate2Translation(BASE_CONFIG, 'Hello'),
    ).resolves.toBe('Merhaba')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8000/translate')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({
      model: 'facebook/nllb-200-distilled-600M',
      text: 'Hello',
      source_lang: 'eng_Latn',
      target_lang: 'tur_Latn',
    })
  })

  it('surfaces server detail and status for invalid input', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        response({ detail: 'Unsupported target language code' }, 422),
      ) as any
    await expect(
      requestCTranslate2Translation(BASE_CONFIG, 'Hello'),
    ).rejects.toMatchObject({
      name: 'CTranslate2RequestError',
      status: 422,
      message:
        'CTranslate2 server error (422): Unsupported target language code',
    })
  })

  it('rejects empty and malformed successful responses', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(response({ translatedText: '   ' })) as any
    await expect(
      requestCTranslate2Translation(BASE_CONFIG, 'Hello'),
    ).rejects.toBeInstanceOf(CTranslate2RequestError)

    global.fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('bad json')
        },
        text: async () => '',
      }) as any
    await expect(
      requestCTranslate2Translation(BASE_CONFIG, 'Hello'),
    ).rejects.toThrow(/invalid JSON/)
  })

  it('times out after the requested deadline', async () => {
    jest.useFakeTimers()
    global.fetch = jest.fn((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      })
    }) as any

    const pending = requestCTranslate2Translation(BASE_CONFIG, 'Hello', {
      timeoutMs: 1500,
    })
    jest.advanceTimersByTime(1500)
    await expect(pending).rejects.toBeInstanceOf(CTranslate2TimeoutError)
  })

  it('keeps the deadline active while reading the translation body', async () => {
    jest.useFakeTimers()
    global.fetch = jest.fn((_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          new Promise((_resolve, reject) => {
            const fail = () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            if (signal.aborted) fail()
            else signal.addEventListener('abort', fail)
          }),
      }) as any
    }) as any

    const pending = requestCTranslate2Translation(BASE_CONFIG, 'Hello', {
      timeoutMs: 1500,
    })
    await Promise.resolve()
    jest.advanceTimersByTime(1500)
    await expect(pending).rejects.toBeInstanceOf(CTranslate2TimeoutError)
  })

  it('aborts the fetch when the external signal aborts', async () => {
    global.fetch = jest.fn((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      })
    }) as any

    const controller = new AbortController()
    const pending = requestCTranslate2Translation(BASE_CONFIG, 'Hello', {
      signal: controller.signal,
    })
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(CTranslate2AbortError)
  })
})

describe('CTranslate2 health diagnostic client', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.useRealTimers()
  })

  it('validates shape and the selected model', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      response({
        status: 'ready',
        model: 'facebook/nllb-200-distilled-600M',
        model_dir: 'nllb-200-distilled-600M',
        device: 'cpu',
        compute_type: 'int8',
        max_input_tokens: 512,
      }),
    ) as any

    await expect(
      fetchCTranslate2Health(BASE_CONFIG),
    ).resolves.toMatchObject({
      status: 'ready',
      model: 'facebook/nllb-200-distilled-600M',
      model_dir: 'nllb-200-distilled-600M',
      device: 'cpu',
      compute_type: 'int8',
      max_input_tokens: 512,
    })
  })

  it('keeps older health responses without model_dir valid', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      response({
        status: 'ready',
        model: 'facebook/nllb-200-distilled-600M',
        device: 'cpu',
        compute_type: 'int8',
        max_input_tokens: 512,
      }),
    ) as any

    const health = await fetchCTranslate2Health(BASE_CONFIG)
    expect(health.model_dir).toBeUndefined()
  })

  it('can return a mismatched health payload for the setup card', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      response({
        status: 'ready',
        model: 'facebook/actually-loaded',
        model_dir: 'actual',
        device: 'cuda',
        compute_type: 'int8_float16',
        max_input_tokens: 512,
      }),
    ) as any

    const health = await fetchCTranslate2Health(BASE_CONFIG, {
      validateModel: false,
    })
    expect(health.model).toBe('facebook/actually-loaded')

    const diagnostic = await runCTranslate2Diagnostic({
      name: 'ctranslate2',
      baseURL: BASE_CONFIG.baseURL,
      apiKey: '',
      modelName: BASE_CONFIG.modelName,
    })
    expect(diagnostic.status).toBe('model_mismatch')
    expect(diagnostic.health?.model).toBe('facebook/actually-loaded')
    expect(diagnostic.health?.model_dir).toBe('actual')
    expect(diagnostic.message).toContain('facebook/actually-loaded')
  })

  it('rejects a loaded model mismatch', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      response({
        status: 'ready',
        model: 'facebook/other',
        device: 'cpu',
        compute_type: 'int8',
        max_input_tokens: 512,
      }),
    ) as any

    await expect(fetchCTranslate2Health(BASE_CONFIG)).rejects.toMatchObject({
      status: 404,
    })
  })

  it('rejects an unexpected health shape', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(response({ status: 'loading' })) as any
    await expect(fetchCTranslate2Health(BASE_CONFIG)).rejects.toThrow(
      /unexpected shape/,
    )
  })

  it('keeps the deadline active while reading the health body', async () => {
    jest.useFakeTimers()
    global.fetch = jest.fn((_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          new Promise((_resolve, reject) => {
            const fail = () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            if (signal.aborted) fail()
            else signal.addEventListener('abort', fail)
          }),
      }) as any
    }) as any

    const pending = fetchCTranslate2Health(BASE_CONFIG, { timeoutMs: 5000 })
    await Promise.resolve()
    jest.advanceTimersByTime(5000)
    await expect(pending).rejects.toBeInstanceOf(CTranslate2TimeoutError)
  })

  it('maps 503, 401/403 and 404 to distinct diagnostic statuses', async () => {
    const diagnosticConfig = {
      name: 'ctranslate2',
      baseURL: 'http://127.0.0.1:8000',
      apiKey: '',
      modelName: 'facebook/nllb-200-distilled-600M',
    }

    const cases: Array<[number, string]> = [
      [503, 'loading'],
      [401, 'auth_error'],
      [403, 'auth_error'],
      [404, 'not_found'],
      [500, 'unknown'],
    ]

    for (const [httpStatus, expected] of cases) {
      global.fetch = jest
        .fn()
        .mockResolvedValue(
          response({ detail: `status ${httpStatus}` }, httpStatus),
        ) as any
      const result = await runCTranslate2Diagnostic(diagnosticConfig)
      expect(result.status).toBe(expected)
    }
  })
})
