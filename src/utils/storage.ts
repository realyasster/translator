function storageError(): Error | null {
  const error = chrome.runtime?.lastError
  return error ? new Error(error.message || String(error)) : null
}

export function getStoredValues<T = Record<string, any>>(
  keys: string[] | null,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      reject(new Error('Extension storage is unavailable'))
      return
    }
    chrome.storage.local.get(keys, (result) => {
      const error = storageError()
      if (error) reject(error)
      else resolve(result as T)
    })
  })
}

export function setStoredValues(values: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      reject(new Error('Extension storage is unavailable'))
      return
    }
    chrome.storage.local.set(values, () => {
      const error = storageError()
      if (error) reject(error)
      else resolve()
    })
  })
}
