"""Language codes supported by the extension for every model family."""

from __future__ import annotations

# Keep this table in sync with src/utils/ctranslate2.ts. The wire format is
# always the FLORES code; adapters translate it to the tokenizer vocabulary.
# Columns: FLORES code, ISO 639-1 (M2M-100), mBART-50 code, display name.
LANGUAGE_TABLE: tuple[tuple[str, str, str, str], ...] = (
    ("eng_Latn", "en", "en_XX", "English"),
    ("tur_Latn", "tr", "tr_TR", "Turkish"),
    ("zho_Hans", "zh", "zh_CN", "Chinese"),
    ("spa_Latn", "es", "es_XX", "Spanish"),
    ("fra_Latn", "fr", "fr_XX", "French"),
    ("deu_Latn", "de", "de_DE", "German"),
    ("por_Latn", "pt", "pt_XX", "Portuguese"),
    ("ita_Latn", "it", "it_IT", "Italian"),
    ("rus_Cyrl", "ru", "ru_RU", "Russian"),
    ("jpn_Jpan", "ja", "ja_XX", "Japanese"),
    ("kor_Hang", "ko", "ko_KR", "Korean"),
    ("arb_Arab", "ar", "ar_AR", "Arabic"),
    ("nld_Latn", "nl", "nl_XX", "Dutch"),
    ("pol_Latn", "pl", "pl_PL", "Polish"),
)

SUPPORTED_LANGUAGES: dict[str, str] = {
    flores: name for flores, _iso1, _mbart, name in LANGUAGE_TABLE
}
FLORES_TO_ISO1: dict[str, str] = {
    flores: iso1 for flores, iso1, _mbart, _name in LANGUAGE_TABLE
}
FLORES_TO_MBART: dict[str, str] = {
    flores: mbart for flores, _iso1, mbart, _name in LANGUAGE_TABLE
}
ISO1_TO_FLORES: dict[str, str] = {
    iso1: flores for flores, iso1, _mbart, _name in LANGUAGE_TABLE
}

MAX_INPUT_TOKENS = 512


def is_supported_language(code: str) -> bool:
    return code in SUPPORTED_LANGUAGES


def supported_codes() -> str:
    return ", ".join(SUPPORTED_LANGUAGES)
