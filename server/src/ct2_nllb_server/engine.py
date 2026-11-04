"""CTranslate2 translation engine loading and inference."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .adapters import (
    AdapterError,
    ModelAdapter,
    adapter_for,
    family_from_metadata,
)
from .languages import MAX_INPUT_TOKENS


class EngineLoadError(RuntimeError):
    """The model directory cannot be served as a local translation model."""


class InferenceError(RuntimeError):
    """Native inference failed."""


class InputTooLongError(ValueError):
    """The tokenized input exceeds the model limit."""

    def __init__(self, token_count: int, max_tokens: int = MAX_INPUT_TOKENS):
        super().__init__(
            f"Input contains {token_count} tokens including special tokens; "
            f"the limit is {max_tokens}."
        )
        self.token_count = token_count
        self.max_tokens = max_tokens


class TranslationEngine:
    """Owns exactly one local tokenizer, adapter and CTranslate2 translator."""

    def __init__(
        self,
        model_dir: str | Path,
        device: str = "cpu",
        compute_type: str = "int8",
    ) -> None:
        import ctranslate2
        from transformers import AutoTokenizer

        self.model_dir = Path(model_dir).expanduser().resolve()
        metadata = read_metadata(self.model_dir)
        self.model_id = str(metadata["model_id"])
        self.revision = str(metadata.get("revision", ""))
        self.family = family_from_metadata(metadata)
        self.device = device
        self.compute_type = compute_type
        self.max_input_tokens = MAX_INPUT_TOKENS

        tokenizer_dir = self.model_dir / "tokenizer"
        if not tokenizer_dir.is_dir():
            raise EngineLoadError(
                f"Tokenizer directory is missing: {tokenizer_dir}. "
                "Prepare the model again with prepare-model."
            )

        supported_devices = {"cpu", "cuda"}
        if device not in supported_devices:
            raise EngineLoadError(
                f"Unsupported device '{device}'. Use cpu or cuda."
            )
        if device == "cuda" and ctranslate2.get_cuda_device_count() < 1:
            raise EngineLoadError(
                "CUDA was requested but no CUDA device is available. "
                "Use --device cpu or install a CUDA 12 runtime."
            )

        supported_compute_types = set(
            ctranslate2.get_supported_compute_types(device)
        )
        if compute_type not in supported_compute_types:
            supported = ", ".join(sorted(supported_compute_types)) or "none"
            raise EngineLoadError(
                f"Compute type '{compute_type}' is not supported on {device}. "
                f"Supported compute types: {supported}."
            )

        try:
            # local_files_only is intentionally hard-coded: serving must never
            # contact Hugging Face or download a tokenizer.
            self._tokenizer = AutoTokenizer.from_pretrained(
                str(tokenizer_dir),
                local_files_only=True,
            )
        except Exception as exc:  # pragma: no cover - depends on local files
            raise EngineLoadError(
                f"Could not load the local tokenizer from {tokenizer_dir}: {exc}"
            ) from exc

        try:
            self.adapter: ModelAdapter = adapter_for(
                self.family, self._tokenizer, metadata
            )
            self.adapter.validate_tokenizer()
        except AdapterError as exc:
            raise EngineLoadError(str(exc)) from exc

        try:
            self._translator = ctranslate2.Translator(
                str(self.model_dir),
                device=device,
                compute_type=compute_type,
                inter_threads=1,
                intra_threads=0,
            )
        except Exception as exc:
            raise EngineLoadError(
                f"Could not load the CTranslate2 model from {self.model_dir}: {exc}"
            ) from exc

    def count_tokens(self, text: str, source_lang: str) -> int:
        """Count source tokens, including language and EOS tokens."""
        try:
            return self.adapter.count_tokens(text, source_lang)
        except AdapterError as exc:
            raise InferenceError(str(exc)) from exc

    def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        """Translate one subtitle line. Callers must already hold the lock."""
        try:
            source_tokens = self.adapter.encode(text, source_lang)
        except AdapterError as exc:
            raise InferenceError(str(exc)) from exc
        try:
            target_prefix = self.adapter.target_prefix(target_lang)
        except AdapterError as exc:
            raise InferenceError(str(exc)) from exc

        kwargs: dict[str, Any] = {
            "beam_size": 1,
            # Validation guarantees <=512 tokens. Disable native truncation so
            # an over-limit request can never be sliced.
            "max_input_length": 0,
            "max_decoding_length": 512,
        }
        if target_prefix is not None:
            kwargs["target_prefix"] = target_prefix
        try:
            results = self._translator.translate_batch(
                [source_tokens],
                **kwargs,
            )
        except Exception as exc:
            raise InferenceError(str(exc)) from exc

        if not results or not results[0].hypotheses:
            raise InferenceError("CTranslate2 returned no hypothesis.")

        hypothesis = self.adapter.strip_prefix(
            list(results[0].hypotheses[0]), target_lang
        )
        try:
            translated = self.adapter.decode(hypothesis)
        except Exception as exc:
            raise InferenceError(str(exc)) from exc

        translated = translated.strip()
        if not translated:
            raise InferenceError("The model returned an empty translation.")
        return translated

    def close(self) -> None:
        translator = getattr(self, "_translator", None)
        if translator is None:
            return
        try:
            translator.unload_model()
        except Exception:
            pass
        self._translator = None


def read_metadata(model_dir: Path) -> dict[str, Any]:
    metadata_path = model_dir / "model-metadata.json"
    if not metadata_path.is_file():
        raise EngineLoadError(
            f"Missing model metadata: {metadata_path}. "
            "Prepare the model with prepare-model."
        )
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise EngineLoadError(f"Invalid model metadata: {exc}") from exc
    if not isinstance(metadata, dict):
        raise EngineLoadError("Invalid model metadata: expected a JSON object.")
    model_id = metadata.get("model_id")
    if not isinstance(model_id, str) or not model_id.strip():
        raise EngineLoadError("Invalid model metadata: model_id is missing.")
    try:
        family = family_from_metadata(metadata)
    except AdapterError as exc:
        raise EngineLoadError(
            f"Invalid model metadata: {exc}"
        ) from exc
    # Normalize legacy format_version 1 metadata without rewriting the file.
    return {**metadata, "family": family}


# Backward-compatible import for callers/tests that used the NLLB-only name.
NllbEngine = TranslationEngine


def load_engine(
    model_dir: str | Path,
    device: str = "cpu",
    compute_type: str = "int8",
) -> TranslationEngine:
    return TranslationEngine(
        model_dir, device=device, compute_type=compute_type
    )
