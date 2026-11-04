"""Model-family adapters translating FLORES codes to tokenizer vocabularies."""

from __future__ import annotations

from typing import Any, Sequence

from .languages import (
    FLORES_TO_ISO1,
    FLORES_TO_MBART,
    SUPPORTED_LANGUAGES,
)
from .tokenizer_checks import is_nllb_tokenizer, tokenizer_supports_language

SUPPORTED_FAMILIES = ("nllb", "m2m100", "mbart50", "marian")
FAMILY_BY_MODEL_TYPE = {
    "nllb": "nllb",
    "m2m_100": "m2m100",
    "mbart": "mbart50",
    "marian": "marian",
}


class AdapterError(ValueError):
    """A model family or tokenizer cannot be served."""


def is_supported_family(family: str) -> bool:
    return family in SUPPORTED_FAMILIES


def family_from_metadata(metadata: dict[str, Any]) -> str:
    """Read format_version 2 metadata, accepting the legacy NLLB marker."""
    family = metadata.get("family")
    if isinstance(family, str) and family in SUPPORTED_FAMILIES:
        return family
    if metadata.get("architecture") == "NLLB":
        return "nllb"
    raise AdapterError(
        "Unsupported model family. Supported families: "
        f"{', '.join(SUPPORTED_FAMILIES)}."
    )


def _class_name(tokenizer: Any) -> str:
    return type(tokenizer).__name__.lower()


def detect_family(config: Any, tokenizer: Any) -> str:
    """Detect a supported family from the tokenizer, then the config."""
    if is_nllb_tokenizer(tokenizer):
        return "nllb"
    class_name = _class_name(tokenizer)
    if "m2m100" in class_name or "m2m_100" in class_name:
        return "m2m100"
    if "mbart" in class_name:
        return "mbart50"
    if "marian" in class_name:
        return "marian"
    model_type = getattr(config, "model_type", None)
    family = FAMILY_BY_MODEL_TYPE.get(str(model_type))
    if family:
        return family
    raise AdapterError(
        "Unsupported model family. Supported families: "
        f"{', '.join(SUPPORTED_FAMILIES)}."
    )


def validate_config(family: str, config: Any) -> None:
    model_type = getattr(config, "model_type", None)
    architectures = getattr(config, "architectures", None) or []
    architecture_text = " ".join(str(name) for name in architectures)
    if family == "nllb":
        if model_type == "nllb":
            return
        # The official NLLB checkpoint reuses the M2M-100 config class.
        if model_type == "m2m_100" and "M2M100" in architecture_text:
            return
    elif family == "m2m100" and model_type == "m2m_100":
        return
    elif family == "mbart50" and model_type == "mbart":
        return
    elif family == "marian" and model_type == "marian":
        return
    else:
        raise AdapterError(
            f"'{model_type or 'unknown'}' cannot be prepared as '{family}'. "
            f"Supported families: {', '.join(SUPPORTED_FAMILIES)}."
        )
    raise AdapterError(
        f"The checkpoint does not look like a '{family}' model "
        f"(model_type '{model_type or 'unknown'}'). "
        f"Supported families: {', '.join(SUPPORTED_FAMILIES)}."
    )


class ModelAdapter:
    family = ""
    target_prefix_token: str | None = None

    def __init__(self, tokenizer: Any, metadata: dict[str, Any]) -> None:
        self.tokenizer = tokenizer
        self.metadata = metadata

    def validate_tokenizer(self) -> None:
        raise NotImplementedError

    def supports(self, source_lang: str, target_lang: str) -> bool:
        return (
            source_lang in SUPPORTED_LANGUAGES
            and target_lang in SUPPORTED_LANGUAGES
        )

    def language_pairs(self) -> list[list[str]] | None:
        return None

    def _set_source_language(self, source_lang: str) -> None:
        self.tokenizer.src_lang = source_lang

    def _encode_ids(self, text: str, source_lang: str) -> list[int]:
        self._set_source_language(source_lang)
        encoded = self.tokenizer(text, add_special_tokens=True)
        input_ids = encoded["input_ids"]
        if not isinstance(input_ids, list):
            input_ids = list(input_ids)
        return input_ids

    def count_tokens(self, text: str, source_lang: str) -> int:
        return len(self._encode_ids(text, source_lang))

    def encode(self, text: str, source_lang: str) -> list[str]:
        return self.tokenizer.convert_ids_to_tokens(
            self._encode_ids(text, source_lang)
        )

    def target_prefix(self, target_lang: str) -> list[list[str]] | None:
        return None

    def strip_prefix(
        self, hypothesis: list[str], target_lang: str
    ) -> list[str]:
        return hypothesis

    def decode(self, hypothesis: Sequence[str]) -> str:
        token_ids = self.tokenizer.convert_tokens_to_ids(list(hypothesis))
        return self.tokenizer.decode(token_ids, skip_special_tokens=True)


class NllbAdapter(ModelAdapter):
    family = "nllb"

    def validate_tokenizer(self) -> None:
        if not is_nllb_tokenizer(self.tokenizer):
            raise AdapterError("The local tokenizer is not an NLLB tokenizer.")
        missing = [
            code
            for code in SUPPORTED_LANGUAGES
            if not tokenizer_supports_language(self.tokenizer, code)
        ]
        if missing:
            raise AdapterError(
                "The NLLB tokenizer is missing required language tokens: "
                f"{', '.join(missing)}."
            )

    def supports(self, source_lang: str, target_lang: str) -> bool:
        return (
            tokenizer_supports_language(self.tokenizer, source_lang)
            and tokenizer_supports_language(self.tokenizer, target_lang)
        )

    def target_prefix(self, target_lang: str) -> list[list[str]] | None:
        return [[target_lang]]

    def strip_prefix(
        self, hypothesis: list[str], target_lang: str
    ) -> list[str]:
        if hypothesis and hypothesis[0] == target_lang:
            return hypothesis[1:]
        return hypothesis


class M2M100Adapter(ModelAdapter):
    family = "m2m100"

    def validate_tokenizer(self) -> None:
        if "m2m100" not in _class_name(self.tokenizer):
            raise AdapterError(
                "The local tokenizer is not an M2M-100 tokenizer."
            )
        missing = [
            code
            for code in FLORES_TO_ISO1
            if not self._supports_code(code)
        ]
        if missing:
            raise AdapterError(
                "The M2M-100 tokenizer is missing required language tokens: "
                f"{', '.join(missing)}."
            )

    def _lang_token(self, flores_code: str) -> str | None:
        iso1 = FLORES_TO_ISO1.get(flores_code)
        if iso1 is None:
            return None
        mapping = getattr(self.tokenizer, "lang_code_to_token", None)
        if isinstance(mapping, dict):
            token = mapping.get(iso1)
            if isinstance(token, str):
                return token
        return f"__{iso1}__"

    def _supports_code(self, flores_code: str) -> bool:
        token = self._lang_token(flores_code)
        return bool(token) and tokenizer_supports_language(
            self.tokenizer, str(token)
        )

    def supports(self, source_lang: str, target_lang: str) -> bool:
        return self._supports_code(source_lang) and self._supports_code(
            target_lang
        )

    def _set_source_language(self, source_lang: str) -> None:
        iso1 = FLORES_TO_ISO1.get(source_lang)
        if iso1 is None:
            raise AdapterError(f"Unsupported language code '{source_lang}'.")
        self.tokenizer.src_lang = iso1

    def target_prefix(self, target_lang: str) -> list[list[str]] | None:
        token = self._lang_token(target_lang)
        if token is None:
            raise AdapterError(
                f"Unsupported language code '{target_lang}'."
            )
        return [[token]]

    def strip_prefix(
        self, hypothesis: list[str], target_lang: str
    ) -> list[str]:
        token = self._lang_token(target_lang)
        if hypothesis and token and hypothesis[0] == token:
            return hypothesis[1:]
        return hypothesis


class Mbart50Adapter(ModelAdapter):
    family = "mbart50"

    def validate_tokenizer(self) -> None:
        if "mbart" not in _class_name(self.tokenizer):
            raise AdapterError(
                "The local tokenizer is not an mBART-50 tokenizer."
            )
        missing = [
            code for code in FLORES_TO_MBART if not self._supports_code(code)
        ]
        if missing:
            raise AdapterError(
                "The mBART-50 tokenizer is missing required language tokens: "
                f"{', '.join(missing)}."
            )

    def _mbart_code(self, flores_code: str) -> str | None:
        code = FLORES_TO_MBART.get(flores_code)
        if code is None:
            return None
        mapping = getattr(self.tokenizer, "lang_code_to_id", None)
        if isinstance(mapping, dict) and code in mapping:
            return code
        if tokenizer_supports_language(self.tokenizer, code):
            return code
        return None

    def _supports_code(self, flores_code: str) -> bool:
        return self._mbart_code(flores_code) is not None

    def supports(self, source_lang: str, target_lang: str) -> bool:
        return self._supports_code(source_lang) and self._supports_code(
            target_lang
        )

    def _set_source_language(self, source_lang: str) -> None:
        code = self._mbart_code(source_lang)
        if code is None:
            raise AdapterError(f"Unsupported language code '{source_lang}'.")
        self.tokenizer.src_lang = code

    def target_prefix(self, target_lang: str) -> list[list[str]] | None:
        code = self._mbart_code(target_lang)
        if code is None:
            raise AdapterError(
                f"Unsupported language code '{target_lang}'."
            )
        return [[code]]

    def strip_prefix(
        self, hypothesis: list[str], target_lang: str
    ) -> list[str]:
        code = self._mbart_code(target_lang)
        if hypothesis and code and hypothesis[0] == code:
            return hypothesis[1:]
        return hypothesis


class MarianAdapter(ModelAdapter):
    family = "marian"

    def __init__(self, tokenizer: Any, metadata: dict[str, Any]) -> None:
        super().__init__(tokenizer, metadata)
        source = metadata.get("source_lang")
        target = metadata.get("target_lang")
        if source not in SUPPORTED_LANGUAGES or target not in SUPPORTED_LANGUAGES:
            raise AdapterError(
                "Marian metadata must contain supported source_lang and "
                "target_lang FLORES codes."
            )
        self.source_lang = str(source)
        self.target_lang = str(target)

    def validate_tokenizer(self) -> None:
        if "marian" not in _class_name(self.tokenizer):
            raise AdapterError(
                "The local tokenizer is not a Marian tokenizer."
            )

    def _set_source_language(self, source_lang: str) -> None:
        if source_lang != self.source_lang:
            raise AdapterError(
                f"This Marian model only supports {self.source_lang} source."
            )

    def supports(self, source_lang: str, target_lang: str) -> bool:
        return (
            source_lang == self.source_lang
            and target_lang == self.target_lang
        )

    def language_pairs(self) -> list[list[str]]:
        return [[self.source_lang, self.target_lang]]


def adapter_for(
    family: str, tokenizer: Any, metadata: dict[str, Any]
) -> ModelAdapter:
    adapters = {
        "nllb": NllbAdapter,
        "m2m100": M2M100Adapter,
        "mbart50": Mbart50Adapter,
        "marian": MarianAdapter,
    }
    adapter_class = adapters.get(family)
    if adapter_class is None:
        raise AdapterError(
            f"Unsupported model family '{family}'. Supported families: "
            f"{', '.join(SUPPORTED_FAMILIES)}."
        )
    return adapter_class(tokenizer, metadata)
