"""Token-level language validation shared by preparation and serving."""

from __future__ import annotations

from typing import Any


def tokenizer_supports_language(tokenizer: Any, code: str) -> bool:
    try:
        token_id = tokenizer.convert_tokens_to_ids(code)
    except Exception:
        return False
    if not isinstance(token_id, int) or token_id < 0:
        return False
    unk_token_id = getattr(tokenizer, "unk_token_id", None)
    return unk_token_id is None or token_id != unk_token_id


def is_nllb_tokenizer(tokenizer: Any) -> bool:
    """NLLB is identified by its tokenizer family and FLORES language tokens."""
    class_name = type(tokenizer).__name__.lower()
    return (
        "nllb" in class_name
        and hasattr(tokenizer, "src_lang")
        and tokenizer_supports_language(tokenizer, "eng_Latn")
    )
