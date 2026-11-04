/**
 * Content tarafına özel altyazı yerleşimi sözleşmesi.
 *
 * Bu tip DOM referansı taşır; background mesaj sözleşmesine eklenmez.
 * Dedektör yetkili kaynağın nerede gösterileceğini bu akışla bildirir.
 */

import { SourceRef, SubtitleDetector } from '../../../types/detection'
import { isOwnUiElement, isStyleVisible } from './text'

export type SubtitlePresentationMode = 'floating' | 'below-caption'

/** Adaptör adayının content tarafı yerleşim ipucu. */
export interface AdapterPresentationHint {
  mode: SubtitlePresentationMode
  anchor: HTMLElement | null
  /**
   * below-caption hedefi için güvenli dış ekleme noktası.
   *  - HTMLElement: kutu bu öğenin hemen ardına eklenir.
   *  - null: below niyeti var ama güvenli dış hedef yok; kutu gizli bekler.
   *  - undefined: eski adaptör davranışı; kutu anchor'ın hemen ardına eklenir.
   */
  mountAfter?: HTMLElement | null
}

export interface SubtitlePresentation {
  source: SourceRef
  mode: SubtitlePresentationMode
  /** below-caption modunda özgün altyazı bloğu; floating modunda null. */
  anchor: HTMLElement | null
  /** Aynı anlam sözleşmesi; background/storage'a taşınmaz. */
  mountAfter?: HTMLElement | null
}

export type SubtitlePresentationListener = (
  presentation: SubtitlePresentation | null,
) => void

/** Dedektör yerleşim akışını opsiyonel olarak sunar. */
export interface PresentationAwareDetector extends SubtitleDetector {
  subscribePresentation?(listener: SubtitlePresentationListener): () => void
}

/** İki yerleşim bildirimi aynı kaynağı, modu ve DOM hedefini mi taşıyor? */
export function samePresentation(
  a: SubtitlePresentation | null,
  b: SubtitlePresentation | null,
): boolean {
  if (!a || !b) return a === b
  return (
    a.mode === b.mode &&
    a.anchor === b.anchor &&
    a.mountAfter === b.mountAfter &&
    a.source.documentId === b.source.documentId &&
    a.source.videoId === b.source.videoId &&
    a.source.sourceId === b.source.sourceId &&
    a.source.generation === b.source.generation &&
    a.source.kind === b.source.kind
  )
}

/**
 * Anchor kaynak olarak kullanılabilir mi? Fullscreen dışlaması burada
 * değerlendirilmez; o kontrollü görünüm kararıdır.
 */
export function isPresentationAnchorAvailable(
  anchor: HTMLElement | null | undefined,
  doc: Document,
  win: Window | null = doc.defaultView,
): anchor is HTMLElement {
  if (!anchor || !anchor.isConnected || !anchor.parentElement) return false
  if (anchor.ownerDocument !== doc) return false
  if (isOwnUiElement(anchor)) return false
  if (!isStyleVisible(anchor, win)) return false
  return true
}

/**
 * Fullscreen sırasında görsel yerleşim dışlanıyor mu? Anchor ve gerçek ekleme
 * ebeveyni tek yerde birlikte değerlendirilir.
 *
 * `mountAfter` kardeş olarak eklendiği için onun `parentElement`'i kontrol
 * edilir. `undefined` legacy anchor-sonrası ekleme, `null` ise hedef yok
 * demektir; `null` tek başına fullscreen dışına taşma kanıtı sayılmaz.
 */
export function isFullscreenLayoutExcluded(
  anchor: HTMLElement | null | undefined,
  mountAfter: HTMLElement | null | undefined,
  doc: Document,
): boolean {
  const fullscreenElement = doc.fullscreenElement
  if (!fullscreenElement) return false
  if (anchor && !fullscreenElement.contains(anchor)) return true
  if (mountAfter === null) {
    // Anchor fullscreen içinde ama güvenli mount hedefi yok: kutu below
    // akışına yerleşemez, görsel floating gerekir. Anchor yoksa tek başına
    // bu durum floating kanıtı değildir.
    return !!anchor
  }

  const insertionParent =
    mountAfter === undefined
      ? anchor?.parentElement ?? null
      : mountAfter.parentElement
  if (!insertionParent) return false
  return !fullscreenElement.contains(insertionParent)
}

/**
 * Ekleme hedefinin ortak yapısal doğrulaması. Manager görünürlük kapısı,
 * engine cache ve adaptör doğrulaması aynı temel kuralları paylaşır.
 */
export function isMountTargetValid(
  target: HTMLElement | null | undefined,
  anchor: HTMLElement | null,
  doc: Document,
  win: Window | null = doc.defaultView,
  extraCheck?: (target: HTMLElement, anchor: HTMLElement | null) => boolean,
): target is HTMLElement {
  if (!target || !target.isConnected || !target.parentElement) return false
  if (target.ownerDocument !== doc) return false
  if (isOwnUiElement(target)) return false
  if (!isStyleVisible(target, win)) return false
  if (anchor && !isPresentationAnchorAvailable(anchor, doc, win)) return false
  if (anchor && !target.contains(anchor)) return false
  if (extraCheck && !extraCheck(target, anchor)) return false
  return true
}

/**
 * mountAfter sözleşmesini doğrular.
 *
 * `undefined` legacy anchor-sonrası davranışıdır. `null` güvenli hedefin
 * olmadığını bildirir. HTMLElement ise ortak yapısal doğrulamadan geçer.
 */
export function isUsablePresentationMount(
  mountAfter: HTMLElement | null | undefined,
  anchor: HTMLElement | null,
  doc: Document,
  win: Window | null = doc.defaultView,
  extraCheck?: (target: HTMLElement, anchor: HTMLElement | null) => boolean,
): boolean {
  if (mountAfter === undefined) return true
  if (mountAfter === null) return false
  return isMountTargetValid(mountAfter, anchor, doc, win, extraCheck)
}
