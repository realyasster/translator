from __future__ import annotations

import pytest

from ct2_nllb_server.adapters import AdapterError, adapter_for
from ct2_nllb_server.languages import (
    FLORES_TO_ISO1,
    FLORES_TO_MBART,
    SUPPORTED_LANGUAGES,
)


class BaseFakeTokenizer:
    unk_token_id = 0
    src_lang = ""

    def __init__(self, tokens: set[str] | None = None) -> None:
        self.tokens = tokens or set()
        self.last_text = ""

    def convert_tokens_to_ids(self, token: str) -> int:
        return 7 if token in self.tokens else self.unk_token_id

    def __call__(self, text: str, add_special_tokens: bool = True) -> dict:
        self.last_text = text
        return {"input_ids": [1, 2, 3]}

    def convert_ids_to_tokens(self, ids: list[int]) -> list[str]:
        return [f"token-{value}" for value in ids]

    def decode(self, ids: list[int], skip_special_tokens: bool = True) -> str:
        return "decoded text"


class FakeNllbTokenizer(BaseFakeTokenizer):
    def __init__(self) -> None:
        super().__init__(set(SUPPORTED_LANGUAGES))


class FakeM2M100Tokenizer(BaseFakeTokenizer):
    def __init__(self) -> None:
        self.lang_code_to_token = {
            iso1: f"__{iso1}__" for iso1 in FLORES_TO_ISO1.values()
        }
        super().__init__(set(self.lang_code_to_token.values()))


class FakeMBart50Tokenizer(BaseFakeTokenizer):
    def __init__(self) -> None:
        self.lang_code_to_id = {
            code: index for index, code in enumerate(FLORES_TO_MBART.values())
        }
        super().__init__(set(self.lang_code_to_id))


class FakeMarianTokenizer(BaseFakeTokenizer):
    pass


def test_nllb_adapter_uses_flores_tokens() -> None:
    tokenizer = FakeNllbTokenizer()
    adapter = adapter_for("nllb", tokenizer, {"model_id": "nllb"})
    adapter.validate_tokenizer()

    assert adapter.supports("eng_Latn", "tur_Latn")
    assert adapter.encode("hello", "eng_Latn") == [
        "token-1",
        "token-2",
        "token-3",
    ]
    assert tokenizer.src_lang == "eng_Latn"
    assert adapter.target_prefix("tur_Latn") == [["tur_Latn"]]
    assert adapter.strip_prefix(["tur_Latn", "x"], "tur_Latn") == ["x"]
    assert adapter.language_pairs() is None


def test_m2m100_adapter_uses_iso_codes() -> None:
    tokenizer = FakeM2M100Tokenizer()
    adapter = adapter_for("m2m100", tokenizer, {"model_id": "m2m"})
    adapter.validate_tokenizer()

    assert adapter.supports("eng_Latn", "tur_Latn")
    assert adapter.encode("hello", "eng_Latn") == [
        "token-1",
        "token-2",
        "token-3",
    ]
    assert tokenizer.src_lang == "en"
    assert adapter.target_prefix("tur_Latn") == [["__tr__"]]
    assert adapter.strip_prefix(["__tr__", "x"], "tur_Latn") == ["x"]


def test_mbart50_adapter_uses_mbart_codes() -> None:
    tokenizer = FakeMBart50Tokenizer()
    adapter = adapter_for("mbart50", tokenizer, {"model_id": "mbart"})
    adapter.validate_tokenizer()

    assert adapter.supports("eng_Latn", "tur_Latn")
    assert adapter.encode("hello", "eng_Latn") == [
        "token-1",
        "token-2",
        "token-3",
    ]
    assert tokenizer.src_lang == "en_XX"
    assert adapter.target_prefix("tur_Latn") == [["tr_TR"]]
    assert adapter.strip_prefix(["tr_TR", "x"], "tur_Latn") == ["x"]


def test_marian_adapter_is_single_pair_and_has_no_prefix() -> None:
    tokenizer = FakeMarianTokenizer()
    metadata = {
        "model_id": "Helsinki-NLP/opus-mt-en-tr",
        "source_lang": "eng_Latn",
        "target_lang": "tur_Latn",
    }
    adapter = adapter_for("marian", tokenizer, metadata)
    adapter.validate_tokenizer()

    assert adapter.supports("eng_Latn", "tur_Latn")
    assert not adapter.supports("tur_Latn", "eng_Latn")
    assert adapter.language_pairs() == [["eng_Latn", "tur_Latn"]]
    assert adapter.encode("hello", "eng_Latn") == [
        "token-1",
        "token-2",
        "token-3",
    ]
    assert adapter.target_prefix("tur_Latn") is None
    assert adapter.strip_prefix(["x"], "tur_Latn") == ["x"]


def test_adapters_reject_the_wrong_tokenizer_family() -> None:
    with pytest.raises(AdapterError, match="M2M-100"):
        adapter_for("m2m100", FakeNllbTokenizer(), {}).validate_tokenizer()
    with pytest.raises(AdapterError, match="mBART-50"):
        adapter_for("mbart50", FakeNllbTokenizer(), {}).validate_tokenizer()
    with pytest.raises(AdapterError, match="Marian"):
        adapter_for("marian", FakeNllbTokenizer(), {}).validate_tokenizer()
    with pytest.raises(AdapterError, match="source_lang"):
        adapter_for(
            "marian",
            FakeMarianTokenizer(),
            {"source_lang": "eng_Latn"},
        )


def test_missing_language_tokens_are_reported() -> None:
    tokenizer = FakeM2M100Tokenizer()
    tokenizer.tokens.discard("__tr__")
    with pytest.raises(AdapterError, match="tur_Latn"):
        adapter_for("m2m100", tokenizer, {}).validate_tokenizer()
