import { streamTranslate } from '../stream-translator'

function response(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('CTranslate2 streaming bridge', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('emits exactly one STREAM_DONE-style result and no fake chunks', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(response({ translatedText: 'Merhaba dünya.' })) as any
    const onChunk = jest.fn()
    const onDone = jest.fn()
    const onError = jest.fn()

    await streamTranslate(
      'ctranslate2',
      {
        apiKey: '',
        baseURL: 'http://127.0.0.1:8000',
        modelName: 'facebook/nllb-200-distilled-600M',
        sourceLanguage: 'English',
        targetLanguage: 'Turkish',
      },
      'Hello world.',
      '',
      { onChunk, onDone, onError },
    )

    expect(onChunk).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledWith('Merhaba dünya.')
    expect(onError).not.toHaveBeenCalled()
  })

  it('reports an abort error when the stream port disconnects', async () => {
    global.fetch = jest.fn((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      })
    }) as any

    const controller = new AbortController()
    const onError = jest.fn()
    const pending = streamTranslate(
      'ctranslate2',
      {
        apiKey: '',
        baseURL: 'http://127.0.0.1:8000',
        modelName: 'facebook/nllb-200-distilled-600M',
        sourceLanguage: 'English',
        targetLanguage: 'Turkish',
      },
      'Hello world.',
      '',
      { onChunk: jest.fn(), onDone: jest.fn(), onError },
      controller.signal,
    )
    controller.abort()
    await pending

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Translation aborted' }),
    )
  })
})
