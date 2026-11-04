import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Popup from '../Popup'
import { APPEARANCE_DEFAULTS } from '../../../utils/settings-utils'
import { getStoredValues, setStoredValues } from '../../../utils/storage'

jest.mock('../index.scss', () => ({}))
jest.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    lang: 'en',
    setLang: jest.fn(),
    ready: true,
    t: (key: string) => key,
  }),
}))
jest.mock('../../../utils/storage', () => ({
  getStoredValues: jest.fn(),
  setStoredValues: jest.fn(),
}))

const mockGetStoredValues = getStoredValues as jest.MockedFunction<
  typeof getStoredValues
>
const mockSetStoredValues = setStoredValues as jest.MockedFunction<
  typeof setStoredValues
>

function installChrome() {
  ;(global as any).chrome = {
    runtime: {
      lastError: undefined,
      getURL: (path: string) => `chrome-extension://test/${path}`,
      sendMessage: jest.fn(),
    },
    storage: {
      local: {
        get: jest.fn((_keys: unknown, callback: (data: unknown) => void) =>
          callback({}),
        ),
        set: jest.fn(),
      },
      onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    },
    tabs: {
      query: jest.fn((_query: unknown, callback: (tabs: unknown[]) => void) =>
        callback([]),
      ),
      create: jest.fn(),
    },
  }
}

beforeEach(() => {
  installChrome()
  mockSetStoredValues.mockResolvedValue(undefined)
  mockGetStoredValues.mockResolvedValue({
    status: false,
    ...APPEARANCE_DEFAULTS,
    showOriginalSubtitle: false,
  })
})

afterEach(() => {
  delete (global as any).chrome
})

describe('Popup original subtitle toggle', () => {
  it('renders the toggle and saves the change immediately', async () => {
    render(<Popup />)

    const toggle = await screen.findByRole('switch', {
      name: 'popup.label.showOriginal',
    })
    await waitFor(() => expect(toggle).not.toBeChecked())

    fireEvent.click(toggle)

    await waitFor(() =>
      expect(mockSetStoredValues).toHaveBeenCalledWith({
        showOriginalSubtitle: true,
      }),
    )
    expect(toggle).toBeChecked()
  })

  it('disables the original appearance controls while hidden', async () => {
    render(<Popup />)
    await screen.findByRole('switch', {
      name: 'popup.label.showOriginal',
    })

    fireEvent.click(screen.getByText('popup.group.original'))

    const colorButton = await screen.findByRole('button', {
      name: /popup\.label\.originColor/,
    })
    expect(colorButton).toBeDisabled()

    const sizeHandle = screen.getByRole('slider', {
      name: 'popup.label.originSize',
    })
    expect(sizeHandle).toHaveAttribute('aria-disabled', 'true')
  })

  it('re-enables the original controls when the toggle is switched back on', async () => {
    render(<Popup />)
    const toggle = await screen.findByRole('switch', {
      name: 'popup.label.showOriginal',
    })
    fireEvent.click(screen.getByText('popup.group.original'))

    const colorButton = await screen.findByRole('button', {
      name: /popup\.label\.originColor/,
    })
    expect(colorButton).toBeDisabled()

    fireEvent.click(toggle)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /popup\.label\.originColor/ }),
      ).not.toBeDisabled()
    })
  })
})
