import {
  CTRANSLATE2_SERVER_SETTINGS_STORAGE_KEY,
  CT2_EXTENSION_ID,
  applyDeviceToDraft,
  buildCTranslate2TranslationBaseURL,
  buildInstallCommands,
  buildNativeHostInstallCommand,
  buildOneClickInstallCommand,
  buildPrepareModelCommand,
  buildServeCommand,
  deriveHostPortFromBaseURL,
  detectDefaultShell,
  draftFromServerSettings,
  getDefaultCTranslate2ServerSettings,
  isShellSafeArgument,
  isValidPrepareModelName,
  normalizeCTranslate2ServerSettings,
  quoteShellArgument,
  requestedServerDiffersFromHealth,
  resolveInitialCTranslate2ServerSettings,
  validateCTranslate2ServerSettingsDraft,
} from '../ctranslate2-server-settings'

describe('CTranslate2 server settings defaults', () => {
  it('uses the documented defaults and detects the first-use shell', () => {
    expect(detectDefaultShell('Win32 NT 10.0')).toBe('powershell')
    expect(detectDefaultShell('MacIntel')).toBe('bash')
    expect(detectDefaultShell('Linux x86_64')).toBe('bash')

    expect(getDefaultCTranslate2ServerSettings('Win32')).toEqual({
      modelDirectory: '',
      device: 'cpu',
      computeType: 'int8',
      host: '127.0.0.1',
      port: 8000,
      shell: 'powershell',
      logLevel: 'info',
    })
    expect(getDefaultCTranslate2ServerSettings('Linux').shell).toBe('bash')
    expect(CTRANSLATE2_SERVER_SETTINGS_STORAGE_KEY).toBe(
      'ctranslate2ServerSettings',
    )
  })

  it('resets compute type to the device suggestion', () => {
    const draft = draftFromServerSettings(
      getDefaultCTranslate2ServerSettings('Linux'),
    )
    expect(applyDeviceToDraft(draft, 'cuda').computeType).toBe(
      'int8_float16',
    )
    expect(applyDeviceToDraft(draft, 'cpu').computeType).toBe('int8')
  })
})

describe('CTranslate2 host and port derivation', () => {
  it('derives only from supported local hosts', () => {
    expect(deriveHostPortFromBaseURL('http://127.0.0.1:9000')).toEqual({
      host: '127.0.0.1',
      port: 9000,
    })
    expect(deriveHostPortFromBaseURL('http://localhost:8123/')).toEqual({
      host: 'localhost',
      port: 8123,
    })
    expect(deriveHostPortFromBaseURL('https://localhost')).toEqual({
      host: 'localhost',
      port: 8000,
    })
    expect(deriveHostPortFromBaseURL('http://192.168.1.10:8000')).toBeNull()
    expect(deriveHostPortFromBaseURL('http://0.0.0.0:8000')).toBeNull()
    expect(deriveHostPortFromBaseURL('not a url')).toBeNull()
  })

  it('uses derived host/port only when no stored settings exist', () => {
    const initial = resolveInitialCTranslate2ServerSettings(
      undefined,
      'http://localhost:8123',
      'Linux',
    )
    expect(initial.host).toBe('localhost')
    expect(initial.port).toBe(8123)
    expect(initial.shell).toBe('bash')

    const stored = resolveInitialCTranslate2ServerSettings(
      {
        host: '127.0.0.1',
        port: 9000,
        shell: 'powershell',
        modelDirectory: '/models/My NLLB',
      },
      'http://localhost:8123',
      'Linux',
    )
    expect(stored.host).toBe('127.0.0.1')
    expect(stored.port).toBe(9000)
    expect(stored.shell).toBe('powershell')
    expect(stored.modelDirectory).toBe('/models/My NLLB')

    const fallback = resolveInitialCTranslate2ServerSettings(
      undefined,
      'http://192.168.1.10:8123',
      'Linux',
    )
    expect(fallback.host).toBe('127.0.0.1')
    expect(fallback.port).toBe(8000)
  })
})

describe('CTranslate2 server settings normalization and validation', () => {
  it('normalizes malformed stored values without rewriting a valid path', () => {
    const settings = normalizeCTranslate2ServerSettings(
      {
        modelDirectory: '  ./My Models/NLLB ü  ',
        device: 'tpu',
        computeType: 'int8',
        host: 'example.com',
        port: '65535',
        shell: 'fish',
        logLevel: 'trace',
      },
      getDefaultCTranslate2ServerSettings('Linux'),
    )
    expect(settings.modelDirectory).toBe('  ./My Models/NLLB ü  ')
    expect(settings.device).toBe('cpu')
    expect(settings.computeType).toBe('int8')
    expect(settings.host).toBe('127.0.0.1')
    expect(settings.port).toBe(65535)
    expect(settings.shell).toBe('bash')
    expect(settings.logLevel).toBe('info')
  })

  it('falls back for unsafe paths and invalid ports', () => {
    const fallback = getDefaultCTranslate2ServerSettings('Linux')
    expect(
      normalizeCTranslate2ServerSettings(
        { modelDirectory: 'bad\npath', port: 0 },
        fallback,
      ).modelDirectory,
    ).toBe(fallback.modelDirectory)
    expect(
      normalizeCTranslate2ServerSettings(
        { modelDirectory: '--overwrite' },
        fallback,
      ).modelDirectory,
    ).toBe(fallback.modelDirectory)
    expect(
      normalizeCTranslate2ServerSettings({ port: 65536 }, fallback).port,
    ).toBe(8000)
  })

  it('validates path and port boundaries and reports field errors', () => {
    const base = draftFromServerSettings(
      getDefaultCTranslate2ServerSettings('Linux'),
    )
    expect(validateCTranslate2ServerSettingsDraft(base).valid).toBe(true)
    expect(
      validateCTranslate2ServerSettingsDraft({
        ...base,
        modelDirectory: '',
      }).valid,
    ).toBe(true)
    expect(
      validateCTranslate2ServerSettingsDraft({
        ...base,
        modelDirectory: 'bad\rpath',
      }).errors.modelDirectory,
    ).toBe('unsafe')
    expect(
      validateCTranslate2ServerSettingsDraft({
        ...base,
        modelDirectory: '--overwrite',
      }).errors.modelDirectory,
    ).toBe('unsafe')
    expect(
      validateCTranslate2ServerSettingsDraft({ ...base, port: '1' }).valid,
    ).toBe(true)
    expect(
      validateCTranslate2ServerSettingsDraft({ ...base, port: '65535' }).valid,
    ).toBe(true)
    expect(
      validateCTranslate2ServerSettingsDraft({ ...base, port: '0' }).errors.port,
    ).toBe('range')
    expect(
      validateCTranslate2ServerSettingsDraft({ ...base, port: '65536' }).errors
        .port,
    ).toBe('range')
    expect(
      validateCTranslate2ServerSettingsDraft({ ...base, port: '8000.5' }).errors
        .port,
    ).toBe('invalid')
    expect(
      validateCTranslate2ServerSettingsDraft({ ...base, port: '' }).errors.port,
    ).toBe('invalid')
  })

  it('requires a safe, non-empty prepare model name', () => {
    expect(isValidPrepareModelName('facebook/nllb-200-distilled-600M')).toBe(
      true,
    )
    expect(isValidPrepareModelName('')).toBe(false)
    expect(isValidPrepareModelName('bad\nmodel')).toBe(false)
    expect(isValidPrepareModelName('--overwrite')).toBe(false)
    expect(isShellSafeArgument("C:\\Models\\NLLB's")).toBe(true)
    expect(isShellSafeArgument('--overwrite')).toBe(false)
    expect(isShellSafeArgument('bad\0path')).toBe(false)
  })
})

describe('CTranslate2 shell escaping and command generation', () => {
  const settings = {
    ...getDefaultCTranslate2ServerSettings('Linux'),
    modelDirectory:
      "/home/me/My Models/NLLB's $test`a;b \"quoted\"/ü",
  }

  it('quotes PowerShell arguments as literal single-quoted strings', () => {
    expect(
      buildPrepareModelCommand(
        {
          modelDirectory:
            'C:\\My Models\\NLLB\'s $test`a;b "quoted"\\ü',
        },
        "facebook/nllb's-model",
        'powershell',
      ),
    ).toBe(
      "ct2-nllb-server 'prepare-model' '--model' 'facebook/nllb''s-model' " +
        "'--family' 'auto' " +
        "'--output' 'C:\\My Models\\NLLB''s $test`a;b \"quoted\"\\ü'",
    )
  })

  it('quotes Bash arguments as literal single-quoted strings', () => {
    expect(
      buildPrepareModelCommand(
        {
          modelDirectory:
            '/home/me/My Models/NLLB\'s $test`a;b "quoted"/ü',
        },
        'facebook/nllb-model',
        'bash',
      ),
    ).toBe(
      "ct2-nllb-server 'prepare-model' '--model' 'facebook/nllb-model' " +
        "'--family' 'auto' " +
        "'--output' '/home/me/My Models/NLLB'\\''s $test`a;b \"quoted\"/ü'",
    )
  })

  it('doubles PowerShell smart single quote delimiters as literals', () => {
    const value = 'a\u2018b\u2019c\u201Ad\u201Be'
    expect(quoteShellArgument(value, 'powershell')).toBe(
      "'a\u2018\u2018b\u2019\u2019c\u201A\u201Ad\u201B\u201Be'",
    )
  })

  it('generates one-line prepare and serve commands with all flags', () => {
    const prepare = buildPrepareModelCommand(
      settings,
      'facebook/nllb-200-distilled-600M',
      'bash',
    )
    expect(prepare).not.toContain('--overwrite')
    expect(prepare).not.toContain('\n')

    const serve = buildServeCommand(settings, 'bash')
    expect(serve).not.toContain('\n')
    expect(serve).toContain("'serve'")
    expect(serve).toContain("'--model-dir'")
    expect(serve).toContain("'--host' '127.0.0.1'")
    expect(serve).toContain("'--port' '8000'")
    expect(serve).toContain("'--device' 'cpu'")
    expect(serve).toContain("'--compute-type' 'int8'")
    expect(serve).toContain("'--log-level' 'info'")
    expect(serve).toContain("NLLB'\\''s $test`a;b")
  })

  it('rejects empty directories and unsafe model names', () => {
    expect(() =>
      buildPrepareModelCommand(
        { modelDirectory: '' },
        'facebook/nllb',
        'bash',
      ),
    ).toThrow(/model directory/i)
    expect(() =>
      buildServeCommand(
        { ...settings, modelDirectory: '' },
        'bash',
      ),
    ).toThrow(/select a prepared model/i)
    expect(() =>
      buildPrepareModelCommand(
        { modelDirectory: '--overwrite' },
        'facebook/nllb',
        'bash',
      ),
    ).toThrow(/model directory/i)
    expect(() =>
      buildPrepareModelCommand(
        { modelDirectory: '/models/nllb' },
        '--overwrite',
        'bash',
      ),
    ).toThrow(/model name/i)
    expect(() =>
      buildPrepareModelCommand(
        { modelDirectory: '/models/nllb' },
        'bad\nmodel',
        'bash',
      ),
    ).toThrow(/model name/i)
    expect(() =>
      buildServeCommand(
        { ...settings, modelDirectory: 'bad\npath' },
        'bash',
      ),
    ).toThrow(/invalid/i)
  })

  it('provides shell-specific install commands', () => {
    expect(buildInstallCommands('powershell')).toEqual([
      'py -3.11 -m venv .venv',
      '.\\.venv\\Scripts\\Activate.ps1',
      'python -m pip install -e ".\\server[convert]"',
    ])
    expect(buildInstallCommands('bash')).toEqual([
      'python3.11 -m venv .venv',
      '. .venv/bin/activate',
      'python -m pip install -e "./server[convert]"',
    ])
  })

  it('installs the native extra before registering the launcher', () => {
    expect(
      buildNativeHostInstallCommand('powershell', 'a'.repeat(32)),
    ).toBe(
      'python -m pip install -e ".\\server[native]"\n' +
        `ct2-nllb-server install-native-host --extension-id ${'a'.repeat(32)}`,
    )
    expect(
      buildNativeHostInstallCommand('bash', 'b'.repeat(32)),
    ).toBe(
      'python -m pip install -e "./server[native]"\n' +
        `ct2-nllb-server install-native-host --extension-id ${'b'.repeat(32)}`,
    )
    expect(
      buildNativeHostInstallCommand('bash', 'c'.repeat(32), 'edge'),
    ).toBe(
      'python -m pip install -e "./server[native]"\n' +
        `ct2-nllb-server install-native-host --extension-id ${'c'.repeat(32)} --browser edge`,
    )
  })

  it('omits the default extension ID from the native install command', () => {
    expect(
      buildNativeHostInstallCommand('powershell', CT2_EXTENSION_ID),
    ).toBe(
      'python -m pip install -e ".\\server[native]"\n' +
        'ct2-nllb-server install-native-host',
    )
    expect(buildNativeHostInstallCommand('bash')).toBe(
      'python -m pip install -e "./server[native]"\n' +
        'ct2-nllb-server install-native-host',
    )
    expect(buildNativeHostInstallCommand('bash', undefined, 'edge')).toBe(
      'python -m pip install -e "./server[native]"\n' +
        'ct2-nllb-server install-native-host --browser edge',
    )
  })

  it('uses the extension manifest version in the one-click URL', () => {
    const target = globalThis as unknown as {
      chrome?: {
        runtime?: { getManifest?: () => { version?: string } }
      }
    }
    target.chrome = {
      runtime: { getManifest: () => ({ version: '4.2.0' }) },
    }
    try {
      expect(buildOneClickInstallCommand('powershell')).toContain(
        '/v4.2.0/scripts/install-ct2-server.ps1',
      )
    } finally {
      delete target.chrome
    }
  })

  it('builds the one-click installer command per shell and model', () => {
    expect(buildOneClickInstallCommand('powershell')).toBe(
      'irm https://raw.githubusercontent.com/realyasster/translator/v3.6.0/scripts/install-ct2-server.ps1 | iex',
    )
    expect(buildOneClickInstallCommand('powershell', undefined, '9.9.9')).toBe(
      'irm https://raw.githubusercontent.com/realyasster/translator/v9.9.9/scripts/install-ct2-server.ps1 | iex',
    )
    expect(buildOneClickInstallCommand('bash')).toBe(
      './scripts/install-ct2-server.sh',
    )
    expect(
      buildOneClickInstallCommand(
        'powershell',
        'facebook/nllb-200-distilled-600M',
      ),
    ).toBe(
      "& ([scriptblock]::Create((irm https://raw.githubusercontent.com/realyasster/translator/v3.6.0/scripts/install-ct2-server.ps1))) -Model 'facebook/nllb-200-distilled-600M'",
    )
    expect(
      buildOneClickInstallCommand('bash', 'facebook/nllb-200-distilled-600M'),
    ).toBe(
      "./scripts/install-ct2-server.sh --model 'facebook/nllb-200-distilled-600M'",
    )
    expect(() =>
      buildOneClickInstallCommand('bash', 'bad\nmodel'),
    ).toThrow(/model name/i)
  })

  it('keeps the extension ID constant in sync with the manifest key', () => {
    const fs = require('fs')
    const path = require('path')
    const manifest = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../../public/manifest.json'),
        'utf8',
      ),
    )
    const digest = require('crypto')
      .createHash('sha256')
      .update(Buffer.from(manifest.key, 'base64'))
      .digest('hex')
      .slice(0, 32)
    const derived = String(digest)
      .split('')
      .map((char) =>
        String.fromCharCode('a'.charCodeAt(0) + parseInt(char, 16)),
      )
      .join('')
    expect(CT2_EXTENSION_ID).toBe(derived)
  })

  it('builds the explicit translation address and compares running options', () => {
    expect(buildCTranslate2TranslationBaseURL(settings)).toBe(
      'http://127.0.0.1:8000',
    )
    expect(
      requestedServerDiffersFromHealth(settings, {
        device: 'cuda',
        compute_type: 'int8_float16',
      }),
    ).toEqual({ device: true, computeType: true })
    expect(
      requestedServerDiffersFromHealth(settings, {
        device: 'cpu',
        compute_type: 'int8',
      }),
    ).toEqual({ device: false, computeType: false })
  })
})
