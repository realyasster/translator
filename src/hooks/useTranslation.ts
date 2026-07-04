import { useEffect, useState, useCallback } from 'react'
import { Lang, getStoredLang, setStoredLang, makeT, detectLang } from '../utils/i18n'

export function useTranslation() {
  const [lang, setLang] = useState<Lang>(detectLang)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let mounted = true
    getStoredLang().then((l) => {
      if (mounted) {
        setLang(l)
        setReady(true)
      }
    })
    const handler = (changes: { [k: string]: chrome.storage.StorageChange }) => {
      if (changes.language && mounted) {
        setLang(changes.language.newValue as Lang)
      }
    }
    chrome.storage.onChanged.addListener(handler)
    return () => {
      mounted = false
      chrome.storage.onChanged.removeListener(handler)
    }
  }, [])

  const changeLang = useCallback((next: Lang) => {
    setLang(next)
    setStoredLang(next).catch(console.error)
  }, [])

  const t = makeT(lang)
  return { lang, setLang: changeLang, t, ready }
}