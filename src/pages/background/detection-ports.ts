/**
 * Algılama portlarının sekme/frame anahtarıyla izlenmesi.
 *
 * Aynı frame için yeni bir port açıldığında eski portun sonradan kapanması
 * veya eski porttan geç gelen mesajlar yeni oturumu etkilememelidir. Bu
 * yardımcılar yalnızca haritadaki güncel portu işleme alır.
 */

import { DetectionStatusResponse } from '../../types/detection'

/** Yeni portu güncel yapar; varsa önceki portu döndürür. */
export function setCurrentDetectionPort(
  ports: Map<string, chrome.runtime.Port>,
  key: string,
  port: chrome.runtime.Port,
): chrome.runtime.Port | null {
  const previous = ports.get(key) ?? null
  ports.set(key, port)
  return previous && previous !== port ? previous : null
}

export function isCurrentDetectionPort(
  ports: Map<string, chrome.runtime.Port>,
  key: string,
  port: chrome.runtime.Port,
): boolean {
  return ports.get(key) === port
}

/**
 * Mesajı yalnızca güncel porttan geldiyse işler. Eski portun geç gelen
 * DETECTION_UPDATE/HEARTBEAT/RELEASED mesajları koordinatöre ulaşmaz.
 */
export function handleDetectionMessage(
  ports: Map<string, chrome.runtime.Port>,
  key: string,
  port: chrome.runtime.Port,
  handler: () => void,
): boolean {
  if (!isCurrentDetectionPort(ports, key, port)) return false
  handler()
  return true
}

export function releaseDetectionPort(
  ports: Map<string, chrome.runtime.Port>,
  key: string,
  port: chrome.runtime.Port,
): boolean {
  if (ports.get(key) !== port) return false
  ports.delete(key)
  return true
}

export function handleDetectionPortDisconnect(
  ports: Map<string, chrome.runtime.Port>,
  key: string,
  port: chrome.runtime.Port,
  onCurrentDisconnect: () => void,
): boolean {
  const current = releaseDetectionPort(ports, key, port)
  if (current) onCurrentDisconnect()
  return current
}

/**
 * Revoke mesajı eski sahibe ulaştırılamıyorsa (port kapalı), eski sahipliği
 * hemen serbest bırakır; aksi halde yeni kaynak süre dolana kadar atanamaz.
 */
export function deliverRevokeOrRelease(
  deliver: () => boolean,
  release: () => void,
): boolean {
  const delivered = deliver()
  if (!delivered) release()
  return delivered
}

/**
 * Durum sorgusu başarısız olduğunda tutarlı yanıt üretir. Storage'dan
 * okunabilen `enabled` korunur; okunamadıysa çevirinin kapalı olduğu
 * iddia edilmez, "unavailable" döner.
 */
export function detectionStatusFailure(
  enabled: boolean,
): DetectionStatusResponse {
  return enabled
    ? {
        type: 'DETECTION_STATUS',
        enabled: true,
        status: { phase: 'unavailable', reason: 'status-unavailable' },
      }
    : {
        type: 'DETECTION_STATUS',
        enabled: false,
        status: { phase: 'disabled', reason: 'extension-disabled' },
      }
}
