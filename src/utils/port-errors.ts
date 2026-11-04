/**
 * Runtime port hatalarını sınıflandırma yardımcıları.
 *
 * Chrome, BFCache'e giren content sayfasının portlarını kapatırken
 * `runtime.lastError` üretir. Bu beklenen kapanış normal yaşam döngüsü
 * sayılır; diğer hatalar mevcut hata/debug akışına bırakılır.
 */

export function readRuntimeLastError(): chrome.runtime.LastError | undefined {
  try {
    return typeof chrome !== 'undefined' && chrome.runtime
      ? chrome.runtime.lastError ?? undefined
      : undefined
  } catch {
    return undefined
  }
}

export function isBackForwardCachePortError(
  error: chrome.runtime.LastError | undefined | null,
): boolean {
  const message = (error?.message || '').toLowerCase()
  return (
    message.includes('back/forward cache') ||
    message.includes('back-forward cache') ||
    message.includes('bfcache')
  )
}

/**
 * BFCache kaynaklı beklenen port kapanışı mı?
 *
 * Ana sinyal sayfanın gerçekten askıda olmasıdır. Metin eşlemesi yalnızca
 * lastError'ın BFCache kapandığını söylediği yedek durumdur.
 */
export function isExpectedBfcachePortClose(
  error: chrome.runtime.LastError | undefined | null,
  pageSuspended: boolean,
): boolean {
  return pageSuspended || isBackForwardCachePortError(error)
}
