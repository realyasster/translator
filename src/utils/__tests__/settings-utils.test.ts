import {
  APPEARANCE_DEFAULTS,
  APPEARANCE_KEYS,
  appearanceResetPayload,
  buildPromptTemplate,
  isModelConfigComplete,
  mergeModelConfig,
  normalizeAppearance,
  normalizeProvider,
  providerConfigStorageKey,
  resolveOpenAICompatiblePresetId,
  resolveProviderAndConfig,
  resolveProviderSelection,
  switchProviderConfigs,
  toHexColor,
} from '../settings-utils'
import { getDeepLApiKey } from '../deepl'

const OPENAI_PRESET = {
  baseURL: 'https://api.openai.com/v1',
  defaultModel: 'gpt-4o',
}

describe('provider settings helpers', () => {
  it('retains provider-specific configs and shares only the target language', () => {
    const openai = {
      apiKey: 'secret',
      baseURL: 'https://custom.example.com/v1',
      modelName: 'custom-model',
      targetLanguage: 'Turkish',
    }
    const ollamaPreset = {
      baseURL: 'http://localhost:11434/v1',
      defaultModel: 'qwen2:0.5b',
    }

    const toOllama = switchProviderConfigs(
      'openai-compatible',
      openai,
      'ollama',
      {},
      ollamaPreset,
    )
    expect(toOllama.nextConfig).toEqual({
      apiKey: '',
      baseURL: 'http://localhost:11434/v1',
      modelName: 'qwen2:0.5b',
      targetLanguage: 'Turkish',
    })

    const backToOpenAI = switchProviderConfigs(
      'ollama',
      toOllama.nextConfig,
      'openai-compatible',
      toOllama.configs,
      OPENAI_PRESET,
    )
    expect(backToOpenAI.nextConfig).toEqual(openai)
  })

  it('restores a provider’s own credentials without carrying another key', () => {
    const openai = {
      apiKey: 'openai-key',
      baseURL: 'https://api.openai.com/v1',
      modelName: 'gpt-4o',
      targetLanguage: 'Turkish',
    }
    const result = switchProviderConfigs(
      'openai-compatible',
      openai,
      'ollama',
      {
        ollama: {
          apiKey: 'ollama-only',
          baseURL: 'http://localhost:9999/v1',
          modelName: 'llama3',
          targetLanguage: 'English',
        },
      },
      {
        baseURL: 'http://localhost:11434/v1',
        defaultModel: 'qwen2:0.5b',
      },
    )

    expect(result.nextConfig).toEqual({
      apiKey: 'ollama-only',
      baseURL: 'http://localhost:9999/v1',
      modelName: 'llama3',
      targetLanguage: 'Turkish',
    })
  })

  it('fills only missing stored fields and preserves intentional empty values', () => {
    expect(
      mergeModelConfig(
        { apiKey: '', targetLanguage: 'German' },
        OPENAI_PRESET,
      ),
    ).toEqual({
      apiKey: '',
      baseURL: 'https://api.openai.com/v1',
      modelName: 'gpt-4o',
      targetLanguage: 'German',
    })

    expect(mergeModelConfig(undefined, OPENAI_PRESET)).toEqual({
      apiKey: '',
      baseURL: 'https://api.openai.com/v1',
      modelName: 'gpt-4o',
      targetLanguage: 'English',
    })
  })

  it('normalizes legacy provider ids without changing current ids', () => {
    expect(normalizeProvider('openai')).toBe('openai-compatible')
    expect(normalizeProvider('zhipu')).toBe('openai-compatible')
    expect(normalizeProvider('ollama')).toBe('ollama')
    expect(normalizeProvider('ctranslate2')).toBe('ctranslate2')
    expect(normalizeProvider('google-translate')).toBe('google-translate')
    expect(normalizeProvider('unknown')).toBeNull()
  })

  it('switches to CTranslate2 with its own URL/model/source and restores it later', () => {
    const ct2Preset = {
      baseURL: 'http://127.0.0.1:8000',
      defaultModel: 'facebook/nllb-200-distilled-600M',
      sourceLanguage: 'English',
    }
    const openai = {
      apiKey: 'secret',
      baseURL: 'https://api.openai.com/v1',
      modelName: 'gpt-4o',
      targetLanguage: 'Turkish',
    }

    const toCt2 = switchProviderConfigs(
      'openai-compatible',
      openai,
      'ctranslate2',
      {},
      ct2Preset,
    )
    expect(toCt2.nextConfig).toEqual({
      apiKey: '',
      baseURL: 'http://127.0.0.1:8000',
      modelName: 'facebook/nllb-200-distilled-600M',
      sourceLanguage: 'English',
      targetLanguage: 'Turkish',
    })

    const customCt2 = {
      ...toCt2.nextConfig,
      baseURL: 'http://127.0.0.1:9000',
      sourceLanguage: 'German',
    }
    const backToOpenAI = switchProviderConfigs(
      'ctranslate2',
      customCt2,
      'openai-compatible',
      toCt2.configs,
      {
        baseURL: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o',
      },
    )
    expect(backToOpenAI.nextConfig).toEqual(openai)

    const backToCt2 = switchProviderConfigs(
      'openai-compatible',
      backToOpenAI.nextConfig,
      'ctranslate2',
      backToOpenAI.configs,
      ct2Preset,
    )
    expect(backToCt2.nextConfig).toEqual(customCt2)
  })

  it('persists the CTranslate2-specific key and resolves it without providerConfig', () => {
    expect(providerConfigStorageKey('ctranslate2')).toBe('ctranslate2Config')
    expect(providerConfigStorageKey('google-translate')).toBeNull()

    const resolved = resolveProviderAndConfig({
      selectedProvider: 'ctranslate2',
      ctranslate2Config: {
        apiKey: '',
        baseURL: 'http://127.0.0.1:8000',
        modelName: 'facebook/nllb-200-distilled-600M',
        sourceLanguage: 'English',
        targetLanguage: 'Turkish',
      },
    })
    expect(resolved?.provider).toBe('ctranslate2')
    expect(resolved?.config.sourceLanguage).toBe('English')
  })

  it('uses providerConfig only when selectedProvider is valid', () => {
    const activeConfig = {
      apiKey: '',
      baseURL: 'http://127.0.0.1:9999',
      modelName: 'ollama-active',
    }
    const resolved = resolveProviderAndConfig({
      selectedProvider: 'ollama',
      providerConfig: activeConfig,
      selectedModel: 'openai',
      openaiConfig: {
        apiKey: 'legacy-key',
        baseURL: 'https://api.openai.com/v1',
        modelName: 'gpt-4o',
      },
    })
    expect(resolved?.provider).toBe('ollama')
    expect(resolved?.config).toBe(activeConfig)
  })

  it('ignores providerConfig when selectedProvider is missing and follows legacy keys', () => {
    const resolved = resolveProviderAndConfig({
      providerConfig: {
        apiKey: '',
        baseURL: 'http://127.0.0.1:8000',
        modelName: 'facebook/nllb-200-distilled-600M',
      },
      selectedModel: 'ollama',
      ollamaConfig: {
        apiKey: 'ollama',
        baseURL: 'http://localhost:11434/v1',
        modelName: 'qwen2.5:3b',
      },
      openaiConfig: {
        apiKey: 'openai-key',
        baseURL: 'https://api.openai.com/v1',
        modelName: 'gpt-4o',
      },
    })
    expect(resolved?.provider).toBe('ollama')
    expect(resolved?.config.modelName).toBe('qwen2.5:3b')
  })

  it('defaults a legacy install without selectedModel to the OpenAI config', () => {
    const resolved = resolveProviderAndConfig({
      providerConfig: {
        apiKey: '',
        baseURL: 'http://127.0.0.1:8000',
        modelName: 'facebook/nllb-200-distilled-600M',
      },
      openaiConfig: {
        apiKey: 'legacy-key',
        baseURL: 'https://api.openai.com/v1',
        modelName: 'gpt-4o',
      },
    })
    expect(resolved?.provider).toBe('openai-compatible')
    expect(resolved?.config.modelName).toBe('gpt-4o')
  })

  it('resolves a legacy selectedModel even when selectedProvider is unknown', () => {
    const resolved = resolveProviderAndConfig({
      selectedProvider: 'not-a-provider',
      providerConfig: {
        apiKey: '',
        baseURL: 'http://127.0.0.1:8000',
        modelName: 'facebook/nllb-200-distilled-600M',
      },
      selectedModel: 'ollama',
      ollamaConfig: {
        apiKey: 'ollama',
        baseURL: 'http://localhost:11434/v1',
        modelName: 'qwen2:0.5b',
      },
    })
    expect(resolved?.provider).toBe('ollama')
    expect(resolved?.config.modelName).toBe('qwen2:0.5b')
  })

  it('validates CTranslate2 config without requiring an API key', () => {
    expect(
      isModelConfigComplete('ctranslate2', {
        baseURL: 'http://127.0.0.1:8000',
        modelName: 'facebook/nllb-200-distilled-600M',
      }),
    ).toBe(true)
    expect(
      isModelConfigComplete('ctranslate2', {
        baseURL: '',
        modelName: 'facebook/nllb-200-distilled-600M',
      }),
    ).toBe(false)
    expect(
      isModelConfigComplete('openai-compatible', {
        baseURL: 'https://api.openai.com/v1',
        modelName: 'gpt-4o',
        apiKey: '',
      }),
    ).toBe(false)
  })

  it('preserves an explicit sourceLanguage while keeping the target language', () => {
    const merged = mergeModelConfig(
      {
        sourceLanguage: 'German',
        targetLanguage: 'French',
      },
      {
        baseURL: 'http://127.0.0.1:8000',
        defaultModel: 'facebook/nllb-200-distilled-600M',
        sourceLanguage: 'English',
      },
    )
    expect(merged.sourceLanguage).toBe('German')
    expect(merged.targetLanguage).toBe('French')
  })

  it('resolves the active provider consistently for options and popup', () => {
    expect(resolveProviderSelection(undefined, 'openai')).toBe(
      'openai-compatible',
    )
    expect(resolveProviderSelection('ollama', 'openai')).toBe('ollama')
    expect(resolveProviderSelection('unknown', 'ollama')).toBe('ollama')
    expect(resolveProviderSelection('unknown', undefined)).toBe(
      'openai-compatible',
    )
  })

  it('uses the existing template wording', () => {
    expect(buildPromptTemplate('English', 'Turkish')).toBe(
      'Translate the following <English> text into <Turkish> and separate the translations with @@@',
    )
  })

  it('resolves known OpenAI-compatible presets and falls back to custom', () => {
    expect(
      resolveOpenAICompatiblePresetId({
        baseURL: 'https://api.deepseek.com/v1',
        modelName: 'deepseek-chat',
      }),
    ).toBe('deepseek')
    expect(
      resolveOpenAICompatiblePresetId({
        baseURL: 'https://example.com/v1',
        modelName: 'custom-model',
      }),
    ).toBe('custom')
  })
})

describe('popup appearance helpers', () => {
  it('provides safe display fallbacks when storage values are missing', () => {
    const appearance = normalizeAppearance(undefined)

    expect(appearance).toEqual(APPEARANCE_DEFAULTS)
    for (const key of APPEARANCE_KEYS) {
      expect(appearance[key]).not.toBeUndefined()
    }
  })

  it('shows the original subtitle unless it is explicitly disabled', () => {
    expect(normalizeAppearance(undefined).showOriginalSubtitle).toBe(true)
    expect(
      normalizeAppearance({ showOriginalSubtitle: true })
        .showOriginalSubtitle,
    ).toBe(true)
    expect(
      normalizeAppearance({ showOriginalSubtitle: false })
        .showOriginalSubtitle,
    ).toBe(false)
    expect(
      normalizeAppearance({ showOriginalSubtitle: 'no' })
        .showOriginalSubtitle,
    ).toBe(true)
    expect(appearanceResetPayload().showOriginalSubtitle).toBe(true)
  })

  it('normalizes stored string values, legacy weights and out-of-range numbers', () => {
    const appearance = normalizeAppearance({
      backgroundColor: '#123456',
      backgroundOpacity: '0.35',
      originFontSize: '24',
      originFontColor: '',
      originFontWeight: 'bold',
      translatedFontSize: 200,
      translatedFontColor: 'yellow',
      translatedFontWeight: 'normal',
    })

    expect(appearance.backgroundColor).toBe('#123456')
    expect(appearance.backgroundOpacity).toBe(0.35)
    expect(appearance.originFontSize).toBe(24)
    expect(appearance.originFontColor).toBe(APPEARANCE_DEFAULTS.originFontColor)
    expect(appearance.originFontWeight).toBe(700)
    expect(appearance.translatedFontSize).toBe(72)
    expect(appearance.translatedFontColor).toBe('yellow')
    expect(appearance.translatedFontWeight).toBe(400)
  })

  it('keeps heavy font weights and clamps only above 900', () => {
    const appearance = normalizeAppearance({
      originFontWeight: 800,
      translatedFontWeight: 950,
    })

    expect(appearance.originFontWeight).toBe(800)
    expect(appearance.translatedFontWeight).toBe(900)
  })

  it('resets appearance values only and never includes translation status', () => {
    const payload = appearanceResetPayload()

    expect(Object.keys(payload).sort()).toEqual([...APPEARANCE_KEYS].sort())
    expect(payload).not.toHaveProperty('status')
    expect(payload).toEqual(APPEARANCE_DEFAULTS)
  })

  it('converts stored rgb/rgba values for the native color input', () => {
    expect(toHexColor('rgba(0, 0, 0, 0.75)')).toBe('#000000')
    expect(toHexColor('rgb(255, 128, 0)')).toBe('#ff8000')
    expect(toHexColor('#ABC')).toBe('#aabbcc')
    expect(toHexColor('yellow')).toBe('#ffff00')
    expect(toHexColor('not-a-color')).toBe('#000000')
  })
})

describe('DeepL provider settings', () => {
  it('normalizes the deepl provider and stores its own config', () => {
    expect(normalizeProvider('deepl')).toBe('deepl')
    expect(providerConfigStorageKey('deepl')).toBe('deeplConfig')
  })

  it('handles every stored DeepL shape through one key resolver', () => {
    const base = {
      baseURL: 'https://api.deepl.com/v2',
      modelName: '',
    }

    // (a) stale active copy, provider-specific record is filled
    const staleActive = resolveProviderAndConfig({
      selectedProvider: 'deepl',
      providerConfig: { ...base, apiKey: '' },
      deeplConfig: {
        ...base,
        apiKey: 'stored:fx',
        deeplPlan: 'free',
        deeplFreeKey: 'stored:fx',
      },
    })
    expect(staleActive?.provider).toBe('deepl')
    expect(getDeepLApiKey(staleActive!.config)).toBe('stored:fx')
    expect(isModelConfigComplete('deepl', staleActive!.config)).toBe(true)

    // (b) legacy apiKey, with and without the Free suffix
    const legacyFree = resolveProviderAndConfig({
      selectedProvider: 'deepl',
      providerConfig: { ...base, apiKey: 'legacy:fx' },
    })
    expect(legacyFree?.config.deeplPlan).toBe('free')
    expect(getDeepLApiKey(legacyFree!.config)).toBe('legacy:fx')

    const legacyPro = resolveProviderAndConfig({
      selectedProvider: 'deepl',
      providerConfig: { ...base, apiKey: 'legacy-pro' },
    })
    expect(legacyPro?.config.deeplPlan).toBe('pro')
    expect(getDeepLApiKey(legacyPro!.config)).toBe('legacy-pro')

    // (c) explicit plan fields
    const plans = resolveProviderAndConfig({
      selectedProvider: 'deepl',
      providerConfig: {
        ...base,
        apiKey: '',
        deeplPlan: 'pro',
        deeplFreeKey: 'free:fx',
        deeplProKey: 'pro-key',
      },
    })
    expect(getDeepLApiKey(plans!.config)).toBe('pro-key')
    expect(isModelConfigComplete('deepl', plans!.config)).toBe(true)

    const missingSelectedKey = resolveProviderAndConfig({
      selectedProvider: 'deepl',
      providerConfig: {
        ...base,
        apiKey: '',
        deeplPlan: 'pro',
        deeplFreeKey: 'free:fx',
      },
    })
    expect(getDeepLApiKey(missingSelectedKey!.config)).toBe('')
    expect(isModelConfigComplete('deepl', missingSelectedKey!.config)).toBe(
      false,
    )
  })

  it('keeps both plan keys when the plan changes or providers switch', () => {
    const bothKeys = {
      apiKey: 'free:fx',
      baseURL: 'https://api.deepl.com/v2',
      modelName: '',
      deeplPlan: 'free' as const,
      deeplFreeKey: 'free:fx',
      deeplProKey: 'pro-key',
    }
    const merged = mergeModelConfig(bothKeys, {
      baseURL: 'https://api.deepl.com/v2',
      defaultModel: '',
      deeplPlan: 'free',
    })
    expect(merged.deeplFreeKey).toBe('free:fx')
    expect(merged.deeplProKey).toBe('pro-key')
    expect(merged.apiKey).toBe('free:fx')

    const switched = switchProviderConfigs(
      'deepl',
      { ...bothKeys, deeplPlan: 'pro', apiKey: 'pro-key' },
      'openai-compatible',
      {},
      { baseURL: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' },
    )
    expect(switched.configs.deepl?.deeplFreeKey).toBe('free:fx')
    expect(switched.configs.deepl?.deeplProKey).toBe('pro-key')
    const back = switchProviderConfigs(
      'openai-compatible',
      switched.nextConfig,
      'deepl',
      switched.configs,
      {
        baseURL: 'https://api.deepl.com/v2',
        defaultModel: '',
        deeplPlan: 'free',
      },
    )
    expect(back.nextConfig.deeplPlan).toBe('pro')
    expect(getDeepLApiKey(back.nextConfig)).toBe('pro-key')
  })

  it('defaults the source language to auto detection', () => {
    const merged = mergeModelConfig(undefined, {
      baseURL: 'https://api.deepl.com/v2',
      defaultModel: '',
      sourceLanguage: 'auto',
    })
    expect(merged.sourceLanguage).toBe('auto')
  })

  it('requires an API key but no model name', () => {
    expect(
      isModelConfigComplete('deepl', {
        apiKey: 'key:fx',
        baseURL: 'https://api.deepl.com/v2',
        modelName: '',
      }),
    ).toBe(true)
    expect(
      isModelConfigComplete('deepl', {
        apiKey: '  ',
        baseURL: 'https://api.deepl.com/v2',
        modelName: '',
      }),
    ).toBe(false)
  })

  it('fills an empty active apiKey from the provider-specific record', () => {
    const resolved = resolveProviderAndConfig({
      selectedProvider: 'deepl',
      providerConfig: {
        apiKey: '',
        baseURL: 'https://api.deepl.com/v2',
        modelName: '',
        targetLanguage: 'Turkish',
      },
      deeplConfig: {
        apiKey: 'secret:fx',
        baseURL: 'https://api.deepl.com/v2',
        modelName: '',
        sourceLanguage: 'auto',
        targetLanguage: 'Turkish',
      },
    })
    expect(resolved?.config.apiKey).toBe('secret:fx')
    expect(resolved?.config.sourceLanguage).toBe('auto')
  })

  it('keeps a filled active apiKey and does not leak another provider', () => {
    const resolved = resolveProviderAndConfig({
      selectedProvider: 'deepl',
      providerConfig: {
        apiKey: 'active:fx',
        baseURL: 'https://api.deepl.com/v2',
        modelName: '',
      },
      deeplConfig: {
        apiKey: 'stale:fx',
        baseURL: 'https://api.deepl.com/v2',
        modelName: '',
      },
      openaiConfig: {
        apiKey: 'openai-key',
        baseURL: 'https://api.openai.com/v1',
        modelName: 'gpt-4o',
      },
    })
    expect(resolved?.config.apiKey).toBe('active:fx')
    expect(resolved?.config.modelName).toBe('')
  })

  it('fills other providers the same way without changing complete configs', () => {
    const filled = resolveProviderAndConfig({
      selectedProvider: 'openai-compatible',
      providerConfig: {
        apiKey: '',
        baseURL: 'https://api.openai.com/v1',
        modelName: 'gpt-4o',
      },
      openaiConfig: {
        apiKey: 'openai-key',
        baseURL: 'https://api.openai.com/v1',
        modelName: 'gpt-4o',
      },
    })
    expect(filled?.config.apiKey).toBe('openai-key')

    const complete = resolveProviderAndConfig({
      selectedProvider: 'openai-compatible',
      providerConfig: {
        apiKey: 'active-key',
        baseURL: 'https://api.openai.com/v1',
        modelName: 'gpt-4o',
      },
      openaiConfig: {
        apiKey: 'old-key',
        baseURL: 'https://api.deepseek.com/v1',
        modelName: 'deepseek-chat',
      },
    })
    expect(complete?.config).toEqual({
      apiKey: 'active-key',
      baseURL: 'https://api.openai.com/v1',
      modelName: 'gpt-4o',
    })
  })

  it('resolves deeplConfig without the shared providerConfig', () => {
    const resolved = resolveProviderAndConfig({
      selectedProvider: 'deepl',
      deeplConfig: {
        apiKey: 'secret:fx',
        baseURL: 'https://api.deepl.com/v2',
        modelName: '',
        targetLanguage: 'Turkish',
      },
    })
    expect(resolved?.provider).toBe('deepl')
    expect(resolved?.config.apiKey).toBe('secret:fx')
  })
})
