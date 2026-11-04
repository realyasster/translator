import React from 'react'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { message } from 'antd'
import { CTranslate2SetupCard } from '../CTranslate2SetupCard'
import { getStoredValues, setStoredValues } from '../../../utils/storage'
import { CTRANSLATE2_SERVER_SETTINGS_STORAGE_KEY, CT2_EXTENSION_ID } from '../../../utils/ctranslate2-server-settings'
import type { DiagnosticResult } from '../../../utils/diagnostics'
import {
  CTranslate2NativeHostError,
  getCTranslate2NativeServerStatus,
  listCTranslate2NativeModels,
  startCTranslate2NativeServer,
  stopCTranslate2NativeServer,
} from '../../../utils/ctranslate2-native-host'

jest.mock('../../../utils/storage', () => ({
  getStoredValues: jest.fn(),
  setStoredValues: jest.fn(),
}))

jest.mock('../../../utils/ctranslate2-native-host', () => {
  const actual = jest.requireActual('../../../utils/ctranslate2-native-host')
  return {
    ...actual,
    getCTranslate2NativeServerStatus: jest.fn(),
    listCTranslate2NativeModels: jest.fn(),
    startCTranslate2NativeServer: jest.fn(),
    stopCTranslate2NativeServer: jest.fn(),
  }
})

const mockGetStoredValues = getStoredValues as jest.MockedFunction<
  typeof getStoredValues
>
const mockSetStoredValues = setStoredValues as jest.MockedFunction<
  typeof setStoredValues
>
const mockGetNativeStatus =
  getCTranslate2NativeServerStatus as jest.MockedFunction<
    typeof getCTranslate2NativeServerStatus
  >
const mockStartNative =
  startCTranslate2NativeServer as jest.MockedFunction<
    typeof startCTranslate2NativeServer
  >
const mockStopNative = stopCTranslate2NativeServer as jest.MockedFunction<
  typeof stopCTranslate2NativeServer
>
const mockListModels = listCTranslate2NativeModels as jest.MockedFunction<
  typeof listCTranslate2NativeModels
>

const t = (key: string) => key

// Node test environment: expose the Chromium runtime stub without casts at
// every use site.
const testGlobal = globalThis as unknown as {
  chrome?: { runtime?: { id?: string } }
}

type CardProps = React.ComponentProps<typeof CTranslate2SetupCard>

const BASE_PROPS: CardProps = {
  t,
  activeBaseURL: 'http://127.0.0.1:8000',
  selectedModel: 'facebook/nllb-200-distilled-600M',
  diagnostic: null,
  diagnosticTesting: false,
  onTestConnection: jest.fn(),
  onApplyBaseURL: jest.fn().mockResolvedValue(null),
  onSelectModel: jest.fn().mockResolvedValue(null),
  onDiagnosticInvalidated: jest.fn(),
}

function renderCard(overrides: Partial<CardProps> = {}) {
  return render(<CTranslate2SetupCard {...BASE_PROPS} {...overrides} />)
}

async function findModelDirectoryInput(): Promise<HTMLInputElement> {
  const input = (await screen.findByLabelText(
    'options.ctranslate2Setup.modelDirectory.label',
  )) as HTMLInputElement
  await screen.findByText(
    /options\.ctranslate2Setup\.native\.state\.(stopped|unavailable|running|external_running)/,
  )
  return input
}

async function openAdvanced(): Promise<void> {
  fireEvent.click(
    screen.getByText('options.ctranslate2Setup.advanced.title'),
  )
  await screen.findByLabelText('options.ctranslate2Setup.port.label')
}

beforeAll(() => {
  jest.spyOn(message, 'success').mockImplementation(() => undefined as any)
  jest.spyOn(message, 'error').mockImplementation(() => undefined as any)
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  })
  ;(global as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

beforeEach(() => {
  jest.useRealTimers()
  jest.clearAllMocks()
  mockGetStoredValues.mockResolvedValue({})
  mockSetStoredValues.mockResolvedValue(undefined)
  mockGetNativeStatus.mockResolvedValue({
    action: 'status',
    state: 'stopped',
    managed: false,
  })
  mockStartNative.mockResolvedValue({
    action: 'start',
    state: 'running',
    managed: true,
  })
  mockStopNative.mockResolvedValue({
    action: 'stop',
    state: 'stopped',
    managed: false,
  })
  mockListModels.mockResolvedValue({
    action: 'list_models',
    models: [],
  })
})

afterEach(() => {
  cleanup()
  delete (global as any).chrome
  jest.useRealTimers()
})

describe('CTranslate2SetupCard persistence', () => {
  it('renders defaults and derives host/port from the active local base URL', async () => {
    renderCard({ activeBaseURL: 'http://localhost:9123' })
    const input = await findModelDirectoryInput()
    expect(input.value).toBe('')

    await openAdvanced()
    expect(
      (screen.getByLabelText(
        'options.ctranslate2Setup.port.label',
      ) as HTMLInputElement).value,
    ).toBe('9123')
  })

  it('restores stored server settings and preserves the path text', async () => {
    mockGetStoredValues.mockResolvedValue({
      [CTRANSLATE2_SERVER_SETTINGS_STORAGE_KEY]: {
        modelDirectory: 'D:\\Modeller\\NLLB ü',
        device: 'cuda',
        computeType: 'float16',
        host: 'localhost',
        port: 9000,
        shell: 'powershell',
        logLevel: 'debug',
      },
    })

    renderCard()
    const input = await findModelDirectoryInput()
    expect(input.value).toBe('D:\\Modeller\\NLLB ü')

    await openAdvanced()
    expect(
      (screen.getByLabelText(
        'options.ctranslate2Setup.port.label',
      ) as HTMLInputElement).value,
    ).toBe('9000')
  })

  it('saves valid edits after the 400ms debounce under the dedicated key', async () => {
    renderCard()
    const input = await findModelDirectoryInput()

    fireEvent.change(input, {
      target: { value: 'D:\\My Models\\NLLB ü' },
    })
    await waitFor(
      () => {
        expect(mockSetStoredValues).toHaveBeenCalledWith({
          [CTRANSLATE2_SERVER_SETTINGS_STORAGE_KEY]:
            expect.objectContaining({
              modelDirectory: 'D:\\My Models\\NLLB ü',
              host: '127.0.0.1',
              port: 8000,
            }),
        })
        expect(
          screen.getByText('options.ctranslate2Setup.save.saved'),
        ).toBeInTheDocument()
      },
      { timeout: 1500 },
    )
  })

  it('reports persistence failures without dropping the form value', async () => {
    mockSetStoredValues.mockRejectedValueOnce(
      new Error('storage unavailable'),
    )
    renderCard()
    const input = await findModelDirectoryInput()

    fireEvent.change(input, {
      target: { value: 'D:\\My Models\\NLLB' },
    })

    await waitFor(
      () =>
        expect(screen.getByRole('alert')).toHaveTextContent(
          'options.ctranslate2Setup.save.error',
        ),
      { timeout: 1500 },
    )
    expect(input.value).toBe('D:\\My Models\\NLLB')
  })

  it('flushes a pending debounced save when the card unmounts', async () => {
    const { unmount } = renderCard()
    const input = await findModelDirectoryInput()

    fireEvent.change(input, {
      target: { value: 'D:\\Models\\Pending NLLB' },
    })
    unmount()

    await waitFor(
      () =>
        expect(mockSetStoredValues).toHaveBeenCalledWith({
          [CTRANSLATE2_SERVER_SETTINGS_STORAGE_KEY]:
            expect.objectContaining({
              modelDirectory: 'D:\\Models\\Pending NLLB',
            }),
        }),
      { timeout: 1000 },
    )
  })

  it('flushes the last valid settings when a later edit becomes invalid', async () => {
    renderCard()
    const input = await findModelDirectoryInput()
    await openAdvanced()

    fireEvent.change(input, {
      target: { value: 'D:\\Models\\CUDA NLLB' },
    })
    fireEvent.change(
      screen.getByLabelText('options.ctranslate2Setup.port.label'),
      { target: { value: '0' } },
    )

    await waitFor(
      () => {
        expect(mockSetStoredValues).toHaveBeenCalledWith({
          [CTRANSLATE2_SERVER_SETTINGS_STORAGE_KEY]:
            expect.objectContaining({
              modelDirectory: 'D:\\Models\\CUDA NLLB',
              port: 8000,
            }),
        })
        expect(
          screen.getByText('options.ctranslate2Setup.save.saved'),
        ).toBeInTheDocument()
      },
      { timeout: 1000 },
    )
  })
})

describe('CTranslate2SetupCard controls', () => {
  it('does not persist invalid ports and disables prepare/start copying', async () => {
    renderCard()
    await findModelDirectoryInput()
    await openAdvanced()

    fireEvent.change(
      screen.getByLabelText('options.ctranslate2Setup.port.label'),
      { target: { value: '0' } },
    )
    await new Promise((resolve) => setTimeout(resolve, 450))

    const copyButtons = screen.getAllByRole('button', {
      name: 'options.ctranslate2Setup.copyCommands',
    })
    expect(copyButtons[0]).not.toBeDisabled()
    expect(copyButtons[1]).toBeDisabled()
    expect(copyButtons[2]).toBeDisabled()
    expect(mockSetStoredValues).not.toHaveBeenCalled()
    expect(
      screen.getByText('options.ctranslate2Setup.validation.portRange'),
    ).toBeInTheDocument()
  })

  it('leaves the active Base URL unchanged until the explicit apply button', async () => {
    const onApplyBaseURL = jest.fn().mockResolvedValue(null)
    renderCard({ onApplyBaseURL })
    await findModelDirectoryInput()
    await openAdvanced()
    fireEvent.change(
      screen.getByLabelText('options.ctranslate2Setup.port.label'),
      { target: { value: '9000' } },
    )

    expect(onApplyBaseURL).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'options.ctranslate2Setup.baseUrl.apply',
        }),
      )
      await Promise.resolve()
    })
    await waitFor(() =>
      expect(onApplyBaseURL).toHaveBeenCalledWith('http://127.0.0.1:9000'),
    )
  })

  it('requires a provider model name before enabling prepare', async () => {
    mockGetStoredValues.mockResolvedValue({
      [CTRANSLATE2_SERVER_SETTINGS_STORAGE_KEY]: {
        modelDirectory: './server/models/nllb-200-distilled-600M',
        device: 'cpu',
        computeType: 'int8',
        host: '127.0.0.1',
        port: 8000,
        shell: 'bash',
        logLevel: 'info',
      },
    })
    renderCard({ selectedModel: '' })
    await findModelDirectoryInput()

    const copyButtons = screen.getAllByRole('button', {
      name: 'options.ctranslate2Setup.copyCommands',
    })
    expect(copyButtons[1]).toBeDisabled()
    expect(copyButtons[2]).not.toBeDisabled()
    expect(
      screen.getByText(
        'options.ctranslate2Setup.validation.modelNameRequired',
      ),
    ).toBeInTheDocument()
  })

  it('invalidates an existing diagnostic when startup settings change', async () => {
    const onDiagnosticInvalidated = jest.fn()
    renderCard({
      onDiagnosticInvalidated,
      diagnostic: {
        status: 'connected',
        latencyMs: 5,
        message: 'connected',
        provider: 'ctranslate2',
        url: 'http://127.0.0.1:8000',
        checkedAt: Date.now(),
        health: {
          status: 'ready',
          model: 'facebook/nllb-200-distilled-600M',
          model_dir: 'nllb-200-distilled-600M',
          device: 'cpu',
          compute_type: 'int8',
          max_input_tokens: 512,
        },
      },
    })
    const input = await findModelDirectoryInput()
    fireEvent.change(input, {
      target: { value: 'D:\\Models\\Other NLLB' },
    })

    expect(onDiagnosticInvalidated).toHaveBeenCalled()
  })

  it('invalidates an existing diagnostic when the active Base URL changes', async () => {
    const onDiagnosticInvalidated = jest.fn()
    const diagnostic: DiagnosticResult = {
      status: 'connected',
      latencyMs: 5,
      message: 'connected',
      provider: 'ctranslate2',
      url: 'http://127.0.0.1:8000',
      checkedAt: Date.now(),
      health: {
        status: 'ready',
        model: 'facebook/nllb-200-distilled-600M',
        model_dir: 'nllb-200-distilled-600M',
        device: 'cpu',
        compute_type: 'int8',
        max_input_tokens: 512,
      },
    }
    const { rerender } = renderCard({
      diagnostic,
      onDiagnosticInvalidated,
    })
    await findModelDirectoryInput()

    rerender(
      <CTranslate2SetupCard
        {...BASE_PROPS}
        diagnostic={diagnostic}
        activeBaseURL="http://127.0.0.1:9001"
        onDiagnosticInvalidated={onDiagnosticInvalidated}
      />,
    )

    await waitFor(() =>
      expect(onDiagnosticInvalidated).toHaveBeenCalled(),
    )
  })
})

describe('CTranslate2SetupCard native launcher', () => {
  it('shows the one-click install command and disables Start when the host is missing', async () => {
    testGlobal.chrome = {
      runtime: { id: CT2_EXTENSION_ID },
    }
    mockGetStoredValues.mockResolvedValueOnce({
      [CTRANSLATE2_SERVER_SETTINGS_STORAGE_KEY]: {
        modelDirectory: './server/models/nllb-200-distilled-600M',
        device: 'cpu',
        computeType: 'int8',
        host: '127.0.0.1',
        port: 8000,
        shell: 'powershell',
        logLevel: 'info',
      },
    })
    mockGetNativeStatus.mockRejectedValueOnce(
      new CTranslate2NativeHostError(
        'native_host_not_installed',
        'Specified native messaging host not found.',
      ),
    )

    renderCard()
    await findModelDirectoryInput()

    expect(
      await screen.findByText('options.ctranslate2Setup.oneClick.title'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/raw\.githubusercontent\.com\/realyasster\/translator/),
    ).toBeInTheDocument()
    expect(screen.getByText(/scriptblock/)).toBeInTheDocument()
    expect(
      screen.getByText('options.ctranslate2Setup.oneClick.reviewSource'),
    ).toHaveAttribute(
      'href',
      expect.stringContaining(
        '/scripts/install-ct2-server.ps1',
      ),
    )
    expect(
      screen.getByText('options.ctranslate2Setup.oneClick.manualToggle'),
    ).toBeInTheDocument()
    expect(screen.queryByText(CT2_EXTENSION_ID)).not.toBeInTheDocument()
    expect(
      screen.getByText(/ct2-nllb-server install-native-host/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'options.ctranslate2Setup.native.start',
      }),
    ).toBeDisabled()
  })

  it('warns when the runtime extension ID differs from the installer default', async () => {
    testGlobal.chrome = {
      runtime: { id: 'a'.repeat(32) },
    }
    mockGetNativeStatus.mockRejectedValueOnce(
      new CTranslate2NativeHostError(
        'native_host_not_installed',
        'Specified native messaging host not found.',
      ),
    )

    renderCard()
    await findModelDirectoryInput()

    expect(
      await screen.findByText(
        'options.ctranslate2Setup.oneClick.extensionIdMismatch',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/--extension-id aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/),
    ).toBeInTheDocument()
  })

  it('does not pass an invalid extension ID to the installer', async () => {
    ;(global as any).chrome = { runtime: { id: 'not-a-chromium-id' } }
    mockGetNativeStatus.mockRejectedValueOnce(
      new CTranslate2NativeHostError(
        'native_host_not_installed',
        'Specified native messaging host not found.',
      ),
    )

    renderCard()
    await findModelDirectoryInput()

    expect(
      await screen.findByText(
        'options.ctranslate2Setup.native.invalidExtensionId',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/install-native-host --extension-id/),
    ).not.toBeInTheDocument()
  })

  it('refreshes native status when host or port changes', async () => {
    renderCard()
    await findModelDirectoryInput()
    await openAdvanced()
    fireEvent.change(
      screen.getByLabelText('options.ctranslate2Setup.port.label'),
      { target: { value: '9000' } },
    )

    await waitFor(
      () =>
        expect(mockGetNativeStatus).toHaveBeenCalledWith({
          host: '127.0.0.1',
          port: 9000,
        }),
      { timeout: 1500 },
    )
  })

  it('starts with current settings and tests the matching active URL', async () => {
    renderCard()
    await findModelDirectoryInput()
    await screen.findByText('options.ctranslate2Setup.native.state.stopped')

    const start = screen.getByRole('button', {
      name: 'options.ctranslate2Setup.native.start',
    })
    await waitFor(() => expect(start).not.toBeDisabled())
    await act(async () => {
      fireEvent.click(start)
      await Promise.resolve()
    })
    await screen.findByText('options.ctranslate2Setup.native.state.running')

    await waitFor(() =>
      expect(mockStartNative).toHaveBeenCalledWith(
        expect.objectContaining({
          modelDirectory: '',
          host: '127.0.0.1',
          port: 8000,
        }),
        'facebook/nllb-200-distilled-600M',
      ),
    )
    await waitFor(() =>
      expect(BASE_PROPS.onTestConnection).toHaveBeenCalled(),
    )
  })

  it('does not test when the generated address differs from the active URL', async () => {
    mockGetStoredValues.mockResolvedValue({
      [CTRANSLATE2_SERVER_SETTINGS_STORAGE_KEY]: {
        modelDirectory: './server/models/nllb-200-distilled-600M',
        device: 'cpu',
        computeType: 'int8',
        host: '127.0.0.1',
        port: 8000,
        shell: 'bash',
        logLevel: 'info',
      },
    })
    renderCard({ activeBaseURL: 'http://127.0.0.1:9999' })
    await findModelDirectoryInput()
    await screen.findByText('options.ctranslate2Setup.native.state.stopped')

    const start = screen.getByRole('button', {
      name: 'options.ctranslate2Setup.native.start',
    })
    await waitFor(() => expect(start).not.toBeDisabled())
    await act(async () => {
      fireEvent.click(start)
      await Promise.resolve()
    })
    await screen.findByText('options.ctranslate2Setup.native.state.running')

    await waitFor(() => expect(mockStartNative).toHaveBeenCalled())
    expect(BASE_PROPS.onTestConnection).not.toHaveBeenCalled()
  })

  it('does not treat an external server as a managed start success', async () => {
    mockStartNative.mockResolvedValueOnce({
      action: 'start',
      state: 'external_running',
      managed: false,
    })
    renderCard()
    await findModelDirectoryInput()
    await screen.findByText('options.ctranslate2Setup.native.state.stopped')

    const start = screen.getByRole('button', {
      name: 'options.ctranslate2Setup.native.start',
    })
    await waitFor(() => expect(start).not.toBeDisabled())
    await act(async () => {
      fireEvent.click(start)
      await Promise.resolve()
    })
    await screen.findByText(
      'options.ctranslate2Setup.native.state.external_running',
    )

    expect(BASE_PROPS.onTestConnection).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', {
        name: 'options.ctranslate2Setup.native.stop',
      }),
    ).not.toBeDisabled()
  })

  it('surfaces a host timeout and leaves Refresh available', async () => {
    mockStartNative.mockRejectedValueOnce(
      new CTranslate2NativeHostError(
        'native_host_timeout',
        'Native host did not respond.',
      ),
    )
    renderCard()
    await findModelDirectoryInput()
    await screen.findByText('options.ctranslate2Setup.native.state.stopped')

    const start = screen.getByRole('button', {
      name: 'options.ctranslate2Setup.native.start',
    })
    await waitFor(() => expect(start).not.toBeDisabled())
    await act(async () => {
      fireEvent.click(start)
      await Promise.resolve()
    })
    await screen.findByText('options.ctranslate2Setup.native.state.error')
    expect(
      screen.getByRole('button', {
        name: 'options.ctranslate2Setup.native.refresh',
      }),
    ).not.toBeDisabled()
  })

  it('stops a managed server and invalidates the diagnostic', async () => {
    mockGetNativeStatus.mockResolvedValue({
      action: 'status',
      state: 'running',
      managed: true,
    })
    renderCard()
    await findModelDirectoryInput()
    await screen.findByText('options.ctranslate2Setup.native.state.running')

    const stop = screen.getByRole('button', {
      name: 'options.ctranslate2Setup.native.stop',
    })
    await waitFor(() => expect(stop).not.toBeDisabled())
    await act(async () => {
      fireEvent.click(stop)
      await Promise.resolve()
    })
    await screen.findByText('options.ctranslate2Setup.native.state.stopped')

    await waitFor(() => expect(mockStopNative).toHaveBeenCalled())
    expect(BASE_PROPS.onDiagnosticInvalidated).toHaveBeenCalled()
  })

  it('stops an externally running server through the launcher', async () => {
    mockGetNativeStatus.mockResolvedValue({
      action: 'status',
      state: 'external_running',
      managed: false,
    })
    renderCard()
    await findModelDirectoryInput()
    await screen.findByText(
      'options.ctranslate2Setup.native.state.external_running',
    )

    const stop = screen.getByRole('button', {
      name: 'options.ctranslate2Setup.native.stop',
    })
    expect(stop).not.toBeDisabled()
    await act(async () => {
      fireEvent.click(stop)
      await Promise.resolve()
    })
    await screen.findByText('options.ctranslate2Setup.native.state.stopped')

    await waitFor(() =>
      expect(mockStopNative).toHaveBeenCalledWith({
        host: '127.0.0.1',
        port: 8000,
      }),
    )
    expect(BASE_PROPS.onDiagnosticInvalidated).toHaveBeenCalled()
  })
})

describe('CTranslate2SetupCard prepared models', () => {
  it('warns about an outdated native host instead of an unknown action', async () => {
    mockGetNativeStatus.mockResolvedValueOnce({
      action: 'status',
      state: 'stopped',
      managed: false,
      hostVersion: 3,
    })

    renderCard()
    await findModelDirectoryInput()

    expect(
      await screen.findByText(
        'options.ctranslate2Setup.models.hostOutdated',
      ),
    ).toBeInTheDocument()
    expect(mockListModels).not.toHaveBeenCalled()
  })

  it('lists native models and updates the directory and provider model', async () => {
    mockListModels.mockResolvedValue({
      action: 'list_models',
      models: [
        {
          directory: '/models/nllb-ready',
          name: 'nllb-ready',
          model_id: 'facebook/nllb-test',
          family: 'nllb',
          revision: 'abc',
          valid: true,
          problem: null,
        },
      ],
    })

    renderCard()
    const input = await findModelDirectoryInput()
    await waitFor(() => expect(mockListModels).toHaveBeenCalled())

    fireEvent.mouseDown(
      screen.getByText('options.ctranslate2Setup.models.placeholder'),
    )
    fireEvent.click(
      await screen.findByText('nllb-ready — facebook/nllb-test'),
    )

    await waitFor(() => expect(input.value).toBe('/models/nllb-ready'))
    await waitFor(() =>
      expect(BASE_PROPS.onSelectModel).toHaveBeenCalledWith(
        'facebook/nllb-test',
      ),
    )
  })
})

describe('CTranslate2SetupCard health display', () => {
  const mismatchDiagnostic: DiagnosticResult = {
    status: 'model_mismatch',
    latencyMs: 12,
    message: 'loaded model does not match',
    provider: 'ctranslate2',
    url: 'http://127.0.0.1:8000',
    checkedAt: 1_700_000_000_000,
    health: {
      status: 'ready',
      model: 'facebook/server-loaded-model',
      model_dir: 'actual-nllb',
      device: 'cuda',
      compute_type: 'int8_float16',
      max_input_tokens: 512,
    },
  }

  it('shows selected and actually loaded models separately with restart guidance', async () => {
    renderCard({ diagnostic: mismatchDiagnostic })
    await findModelDirectoryInput()

    expect(screen.getByText('facebook/server-loaded-model')).toBeInTheDocument()
    expect(screen.getByText('actual-nllb')).toBeInTheDocument()
    expect(
      screen.getByText('options.ctranslate2Setup.health.restartNeeded'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(
        'options.ctranslate2Setup.health.notReportedOldServer',
      ),
    ).not.toBeInTheDocument()
  })

  it('keeps the model-mismatch error while showing reported health', async () => {
    renderCard({ diagnostic: mismatchDiagnostic })
    await findModelDirectoryInput()

    expect(
      screen.getByText('options.ctranslate2Setup.health.modelMismatchTitle'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'options.diagnostics.ctranslate2.hint.model_mismatch',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('facebook/server-loaded-model')).toBeInTheDocument()
  })

  it('accepts old health schemas without model_dir', async () => {
    renderCard({
      diagnostic: {
        status: 'connected',
        latencyMs: 5,
        message: 'connected',
        provider: 'ctranslate2',
        url: 'http://127.0.0.1:8000',
        checkedAt: Date.now(),
        health: {
          status: 'ready',
          model: 'facebook/nllb-200-distilled-600M',
          device: 'cpu',
          compute_type: 'int8',
          max_input_tokens: 512,
        },
      },
    })
    await findModelDirectoryInput()

    expect(
      screen.getByText(
        'options.ctranslate2Setup.health.notReportedOldServer',
      ),
    ).toBeInTheDocument()
  })
})
