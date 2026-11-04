import {
  DEEPL_FREE_BASE_URL,
  DEEPL_PRO_BASE_URL,
  DEEPL_RETRY_BASE_MS,
  DEEPL_RETRY_MAX_MS,
  DeepLRequestError,
  buildDeepLTranslationRequest,
  deepLPlanWarning,
  deeplEndpoint,
  fetchDeepLUsage,
  getDeepLApiKey,
  normalizeDeepLConfig,
  requestDeepLTranslation,
  resolveDeepLPlan,
  resolveDeepLSourceCode,
  resolveDeepLTargetCode,
  retryAfterDelayMs,
} from '../deepl'

function response(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return {
    ok: status < 400,
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('DeepL language mapping', () => {
  it('maps labels to DeepL target and source codes', () => {
    expect(resolveDeepLTargetCode('English')).toBe('EN-US')
    expect(resolveDeepLTargetCode('Turkish')).toBe('TR')
    expect(resolveDeepLTargetCode('Chinese')).toBe('ZH-HANS')
    expect(resolveDeepLTargetCode('Portuguese')).toBe('PT-BR')
    expect(resolveDeepLTargetCode('zh-CN')).toBe('ZH-HANS')
    expect(resolveDeepLSourceCode('English')).toBe('EN')
    expect(resolveDeepLSourceCode('Portuguese')).toBe('PT')
  })

  it('returns null for unknown languages instead of English', () => {
    expect(resolveDeepLTargetCode('Klingon')).toBeNull()
    expect(resolveDeepLSourceCode('Klingon')).toBeNull()
  })

  it('builds a body without source_lang by default and rejects unknown targets', () => {
    expect(
      buildDeepLTranslationRequest(
        { targetLanguage: 'Turkish', sourceLanguage: 'auto' },
        'Hello',
      ),
    ).toEqual({
      text: ['Hello'],
      target_lang: 'TR',
      preserve_formatting: true,
    })

    expect(
      buildDeepLTranslationRequest(
        { targetLanguage: 'Turkish', sourceLanguage: 'English' },
        'Hello',
      ).source_lang,
    ).toBe('EN')

    expect(() =>
      buildDeepLTranslationRequest({ targetLanguage: 'Klingon' }, 'Hello'),
    ).toThrow(DeepLRequestError)
  })
})

describe('DeepL retry delay', () => {
  it('uses Retry-After seconds, capped at two seconds', () => {
    expect(retryAfterDelayMs('1')).toBe(1000)
    expect(retryAfterDelayMs('30')).toBe(DEEPL_RETRY_MAX_MS)
    expect(retryAfterDelayMs('0.05')).toBe(50)
    expect(retryAfterDelayMs(null)).toBe(DEEPL_RETRY_BASE_MS)
    expect(retryAfterDelayMs('soon')).toBe(DEEPL_RETRY_BASE_MS)
    expect(retryAfterDelayMs('0')).toBe(DEEPL_RETRY_BASE_MS)
  })
})

describe('DeepL plan and endpoint selection', () => {
  it('selects the host from the plan, not from a key suffix', () => {
    expect(deeplEndpoint({ deeplPlan: 'free' })).toBe(DEEPL_FREE_BASE_URL)
    expect(deeplEndpoint({ deeplPlan: 'pro' })).toBe(DEEPL_PRO_BASE_URL)
    expect(
      deeplEndpoint({ deeplPlan: 'pro', apiKey: 'legacy:fx' }, 'translate'),
    ).toBe(`${DEEPL_PRO_BASE_URL}/translate`)
  })

  it('infers a plan from legacy keys only when no plan is stored', () => {
    expect(deeplEndpoint({ apiKey: 'legacy:fx' })).toBe(DEEPL_FREE_BASE_URL)
    expect(deeplEndpoint({ apiKey: 'legacy' })).toBe(DEEPL_PRO_BASE_URL)
    expect(deeplEndpoint({})).toBe(DEEPL_FREE_BASE_URL)
  })

  it('resolves the plan from stored keys before the legacy apiKey', () => {
    expect(resolveDeepLPlan({ apiKey: 'legacy:fx' })).toBe('free')
    expect(resolveDeepLPlan({ apiKey: 'legacy' })).toBe('pro')
    expect(resolveDeepLPlan({ deeplPlan: 'pro', apiKey: 'legacy:fx' })).toBe(
      'pro',
    )
    expect(
      resolveDeepLPlan({ deeplFreeKey: 'free:fx', deeplProKey: 'pro' }),
    ).toBe('free')
    expect(resolveDeepLPlan({})).toBe('free')
  })

  it('returns only the key that belongs to the selected plan', () => {
    const both = {
      deeplPlan: 'pro' as const,
      deeplFreeKey: 'free:fx',
      deeplProKey: 'pro-key',
    }
    expect(getDeepLApiKey(both)).toBe('pro-key')
    expect(getDeepLApiKey({ ...both, deeplPlan: 'free' })).toBe('free:fx')
    expect(getDeepLApiKey({ deeplPlan: 'pro', apiKey: 'legacy:fx' })).toBe('')
    expect(getDeepLApiKey({ apiKey: 'legacy:fx' })).toBe('legacy:fx')
  })

  it('migrates a legacy key into the matching plan field', () => {
    const base = {
      apiKey: '',
      baseURL: 'https://api.deepl.com/v2',
      modelName: '',
    }
    expect(normalizeDeepLConfig({ ...base, apiKey: 'legacy:fx' })).toEqual({
      ...base,
      apiKey: 'legacy:fx',
      deeplPlan: 'free',
      deeplFreeKey: 'legacy:fx',
    })
    expect(normalizeDeepLConfig({ ...base, apiKey: 'legacy' })).toEqual({
      ...base,
      apiKey: 'legacy',
      deeplPlan: 'pro',
      deeplProKey: 'legacy',
    })
    expect(
      normalizeDeepLConfig({
        ...base,
        deeplPlan: 'free',
        deeplFreeKey: 'free:fx',
        deeplProKey: 'pro-key',
      }),
    ).toEqual({
      ...base,
      apiKey: 'free:fx',
      deeplPlan: 'free',
      deeplFreeKey: 'free:fx',
      deeplProKey: 'pro-key',
    })
  })

  it('warns when the selected plan does not match the key shape', () => {
    expect(
      deepLPlanWarning({ deeplPlan: 'free', deeplFreeKey: 'pro-key' }),
    ).toBe('free-key-looks-pro')
    expect(
      deepLPlanWarning({ deeplPlan: 'pro', deeplProKey: 'free:fx' }),
    ).toBe('pro-key-looks-free')
    expect(
      deepLPlanWarning({ deeplPlan: 'free', deeplFreeKey: 'free:fx' }),
    ).toBeNull()
    expect(deepLPlanWarning({ deeplPlan: 'free' })).toBeNull()
  })
})

describe('requestDeepLTranslation', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  const config = {
    apiKey: '',
    deeplPlan: 'free' as const,
    deeplFreeKey: 'secret-key:fx',
    sourceLanguage: 'English',
    targetLanguage: 'Turkish',
  }

  it('posts the translated text with the auth header and no key in the URL', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      response({ translations: [{ detected_source_language: 'EN', text: 'Merhaba' }] }),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(
      requestDeepLTranslation(config, 'Hello'),
    ).resolves.toBe('Merhaba')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${DEEPL_FREE_BASE_URL}/translate`)
    expect(url).not.toContain('secret-key')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('DeepL-Auth-Key secret-key:fx')
    expect(JSON.parse(init.body)).toEqual({
      text: ['Hello'],
      target_lang: 'TR',
      source_lang: 'EN',
      preserve_formatting: true,
    })
  })

  it('maps auth, quota and language errors without leaking the key', async () => {
    for (const [status, code] of [
      [403, 'auth'],
      [456, 'quota'],
      [400, 'language'],
    ] as const) {
      global.fetch = jest
        .fn()
        .mockResolvedValue(response({ message: 'Error' }, status)) as unknown as typeof fetch
      const error = await requestDeepLTranslation(config, 'Hello').catch(
        (err: unknown) => err,
      )
      expect(error).toBeInstanceOf(DeepLRequestError)
      expect((error as DeepLRequestError).code).toBe(code)
      expect((error as DeepLRequestError).status).toBe(status)
      expect((error as Error).message).not.toContain('secret-key')
    }
  })

  it('retries one 429 response and then succeeds', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(response({ message: 'slow down' }, 429))
      .mockResolvedValueOnce(response({ translations: [{ text: 'Merhaba' }] }))
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(requestDeepLTranslation(config, 'Hello')).resolves.toBe(
      'Merhaba',
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  }, 5000)

  it('rejects a missing planned key before any request', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const freeError = await requestDeepLTranslation(
      { ...config, deeplFreeKey: '' },
      'Hello',
    ).catch((err: unknown) => err)
    expect((freeError as DeepLRequestError).code).toBe('auth')
    expect((freeError as Error).message).toContain('Free API key')
    expect((freeError as Error).message).not.toContain('secret-key')

    const proError = await requestDeepLTranslation(
      {
        ...config,
        deeplPlan: 'pro',
        deeplProKey: '',
      },
      'Hello',
    ).catch((err: unknown) => err)
    expect((proError as Error).message).toContain('Pro API key')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an empty translation', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(response({ translations: [{ text: '  ' }] })) as unknown as typeof fetch

    const error = await requestDeepLTranslation(config, 'Hello').catch(
      (err: unknown) => err,
    )
    expect((error as DeepLRequestError).code).toBe('empty')
  })
})

describe('fetchDeepLUsage', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('reads the usage from the matching endpoint', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      response({ character_count: 10, character_limit: 500000 }),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(
      fetchDeepLUsage({ deeplPlan: 'free', deeplFreeKey: 'key:fx' }),
    ).resolves.toEqual({
      character_count: 10,
      character_limit: 500000,
    })
    expect(fetchMock.mock.calls[0][0]).toBe(`${DEEPL_FREE_BASE_URL}/usage`)
  })

  it('reports an invalid key as an auth error', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(response({ message: 'Forbidden' }, 403)) as unknown as typeof fetch

    const error = await fetchDeepLUsage({
      apiKey: 'bad',
      deeplPlan: 'pro',
    }).catch((err: unknown) => err)
    expect((error as DeepLRequestError).code).toBe('auth')
  })
})
