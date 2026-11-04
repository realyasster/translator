/**
 * Content sayfasının BFCache askı durumu.
 *
 * pagehide.persisted=true ile işaretlenir; pageshow restore veya dispose ile
 * temizlenir. Port katmanı BFCache kapanışında yeniden bağlanıp
 * bağlanmayacağına bu tek kaynaktan karar verir.
 */

let contentPageSuspended = false

export function setContentPageSuspended(value: boolean): void {
  contentPageSuspended = value
}

export function isContentPageSuspended(): boolean {
  return contentPageSuspended
}
