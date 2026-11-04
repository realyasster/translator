import { TranslationManager } from './translation-manager'

/**
 * Content script giriş noktası.
 *
 * Mantık `translation-manager.ts` içinde; burada yalnızca tek örnek oluşturulur
 * ve DOM hazır olduğunda başlatılır. Bu ayrım, yöneticinin testlerde yan
 * etkisiz biçimde içe aktarılmasını sağlar.
 */
export const translationManager = new TranslationManager()

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      void translationManager.start()
    },
    { once: true },
  )
} else {
  void translationManager.start()
}
