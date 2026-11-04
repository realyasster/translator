import { dictionaries } from '../i18n'

describe('translations', () => {
  it('keeps the English and Turkish dictionaries in sync', () => {
    const enKeys = Object.keys(dictionaries.en).sort()
    const trKeys = Object.keys(dictionaries.tr).sort()

    expect(trKeys).toEqual(enKeys)
  })

  it('does not leave empty translation values', () => {
    for (const lang of ['en', 'tr'] as const) {
      for (const [key, value] of Object.entries(dictionaries[lang])) {
        expect(`${lang}:${key}:${value}`).not.toBe(`${lang}:${key}:`)
      }
    }
  })

  it('uses the same interpolation placeholders in both locales', () => {
    const placeholders = (value: string) =>
      Array.from(value.matchAll(/\{(\w+)\}/g))
        .map((match) => match[1])
        .sort()

    for (const key of Object.keys(dictionaries.en)) {
      expect(placeholders(dictionaries.tr[key])).toEqual(
        placeholders(dictionaries.en[key]),
      )
    }
  })
})
