import { runDiagnostic } from '../diagnostics'
import { DEEPL_FREE_BASE_URL } from '../deepl'

function response(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

const BASE_CONFIG = {
  apiKey: '',
  baseURL: 'https://api.deepl.com/v2',
  modelName: '',
  sourceLanguage: 'auto',
  targetLanguage: 'Turkish',
}

describe('runDeepLDiagnostic', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('checks usage through the selected plan endpoint', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        response({ character_count: 10, character_limit: 500000 }),
      )
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await runDiagnostic('deepl', {
      ...BASE_CONFIG,
      deeplPlan: 'free',
      deeplFreeKey: 'key:fx',
    })

    expect(result.status).toBe('connected')
    expect(result.url).toBe(DEEPL_FREE_BASE_URL)
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${DEEPL_FREE_BASE_URL}/usage`,
    )
  })

  it('explains a plan/key mismatch on auth errors', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(response({ message: 'Forbidden' }, 403)) as unknown as typeof fetch

    const result = await runDiagnostic('deepl', {
      ...BASE_CONFIG,
      deeplPlan: 'free',
      deeplFreeKey: 'pro-looking-key',
    })

    expect(result.status).toBe('auth_error')
    expect(result.message).toContain('does not look like a DeepL Free key')
  })

  it('reports the missing key for the selected plan', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await runDiagnostic('deepl', {
      ...BASE_CONFIG,
      deeplPlan: 'pro',
    })

    expect(result.status).toBe('auth_error')
    expect(result.message).toContain('Pro API key is missing')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
