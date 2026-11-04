"""Preparation of local CTranslate2 NLLB model directories."""

from __future__ import annotations

import json
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .adapters import (
    FAMILY_BY_MODEL_TYPE,
    AdapterError,
    SUPPORTED_FAMILIES,
    adapter_for,
    detect_family,
    validate_config,
)
from .languages import ISO1_TO_FLORES, SUPPORTED_LANGUAGES


class PrepareError(RuntimeError):
    """The requested model cannot be prepared."""


def _resolve_family(requested: str, config: Any, tokenizer: Any) -> str:
    if requested and requested != "auto":
        if requested not in SUPPORTED_FAMILIES:
            raise PrepareError(
                f"Unsupported model family '{requested}'. Supported families: "
                f"{', '.join(SUPPORTED_FAMILIES)}."
            )
        return requested
    try:
        return detect_family(config, tokenizer)
    except AdapterError as exc:
        raise PrepareError(str(exc)) from exc


def parse_marian_pair(model_id: str) -> tuple[str, str]:
    """Infer a single language pair from Helsinki-NLP/opus-mt-xx-yy names."""
    segment = model_id.rsplit("/", 1)[-1].lower()
    parts = segment.split("-")
    if len(parts) >= 2:
        source, target = parts[-2], parts[-1]
        if source in ISO1_TO_FLORES and target in ISO1_TO_FLORES:
            return ISO1_TO_FLORES[source], ISO1_TO_FLORES[target]
    raise PrepareError(
        "Could not infer the Marian language pair from the model name. "
        "Use a single-pair model such as Helsinki-NLP/opus-mt-en-tr."
    )


_REVISION_SHA = re.compile(r"^[0-9a-f]{40}$")


def _family_from_config(model_id: str, config: dict[str, Any]) -> str | None:
    """Best-effort family detection without downloading the tokenizer."""
    model_type = str(config.get("model_type") or "")
    architectures = config.get("architectures") or []
    if isinstance(architectures, (list, tuple)) and any(
        "Nllb" in str(name) for name in architectures
    ):
        return "nllb"
    family = FAMILY_BY_MODEL_TYPE.get(model_type)
    # The official NLLB checkpoints reuse the M2M-100 config class, so the
    # tokenizer class is only known after prepare-model; the name is the
    # reliable hint in a config-only check.
    if family == "m2m100" and "nllb" in model_id.lower():
        return "nllb"
    return family


def search_translation_models(
    query: str, limit: int = 15
) -> list[dict[str, Any]]:
    """Search Hugging Face for translation models of a supported family."""
    from huggingface_hub import HfApi

    models = HfApi().list_models(
        search=query,
        pipeline_tag="translation",
        sort="downloads",
        limit=max(limit * 4, limit),
        expand=["config"],
    )

    results: list[dict[str, Any]] = []
    for model in models:
        config = getattr(model, "config", None)
        config = config if isinstance(config, dict) else {}
        model_id = str(getattr(model, "id", ""))
        family = _family_from_config(model_id, config)
        if family is None:
            continue
        results.append(
            {
                "id": model_id,
                "family": family,
                "downloads": getattr(model, "downloads", None),
            }
        )
        if len(results) >= limit:
            break
    return results


def check_model(
    model_id: str, revision: str | None = None
) -> dict[str, Any]:
    """Validate a Hugging Face model id without converting or downloading it.

    The installer calls this before prepare-model so a typo, a gated
    repository or an unsupported architecture is reported without a long
    download. The returned ``code`` classifies the failure for the caller.
    """
    result: dict[str, Any] = {
        "model_id": model_id,
        "ok": False,
        "code": None,
        "message": None,
        "family": None,
        "model_type": None,
        "revision": None,
        "suggestions": [],
    }

    from huggingface_hub import HfApi
    from huggingface_hub.utils import GatedRepoError, RepositoryNotFoundError

    try:
        info = HfApi().model_info(
            model_id,
            revision=revision,
            expand=["config", "sha"],
        )
    except GatedRepoError:
        result.update(
            code="gated",
            message=(
                f"'{model_id}' is gated or private. Accept the model terms "
                "on huggingface.co and sign in before preparing it."
            ),
        )
        return result
    except RepositoryNotFoundError as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if status == 401:
            result.update(
                code="gated",
                message=(
                    f"'{model_id}' is private or gated. Sign in or accept "
                    "the model terms on huggingface.co first."
                ),
            )
            return result
        result.update(
            code="not_found",
            message=f"'{model_id}' was not found on Hugging Face.",
        )
        try:
            result["suggestions"] = [
                model["id"]
                for model in search_translation_models(
                    model_id.rsplit("/", 1)[-1], limit=3
                )
            ]
        except Exception:  # pragma: no cover - suggestions are best effort
            pass
        return result
    except Exception as exc:
        result.update(
            code="network",
            message=f"Could not reach Hugging Face: {exc}",
        )
        return result

    result["revision"] = str(info.sha) if info.sha else None
    config = getattr(info, "config", None)
    if not isinstance(config, dict) or not config:
        result.update(
            code="unsupported_family",
            message=(
                f"Could not read the model config for '{model_id}'. "
                f"Supported families: {', '.join(SUPPORTED_FAMILIES)}."
            ),
        )
        return result

    result["model_type"] = str(config.get("model_type") or "") or None
    family = _family_from_config(model_id, config)
    if family is None:
        result.update(
            code="unsupported_family",
            message=(
                f"Unsupported model family (model_type="
                f"{result['model_type'] or 'unknown'}). Supported families: "
                f"{', '.join(SUPPORTED_FAMILIES)}."
            ),
        )
        return result
    result["family"] = family
    if family == "marian":
        try:
            source_lang, target_lang = parse_marian_pair(model_id)
        except PrepareError as exc:
            result.update(code="unsupported_family", message=str(exc))
            return result
        result["language_pairs"] = [[source_lang, target_lang]]

    result["ok"] = True
    result["message"] = f"'{model_id}' can be prepared as {family}."
    return result


def _resolve_revision(model_id: str, revision: str | None) -> str:
    # A full commit SHA needs no metadata request and lets an already cached
    # model be prepared offline.
    if revision and _REVISION_SHA.fullmatch(revision):
        return revision

    from huggingface_hub import HfApi

    try:
        info = HfApi().model_info(model_id, revision=revision)
    except Exception as exc:
        raise PrepareError(
            f"Could not read model metadata for '{model_id}': {exc}"
        ) from exc
    if not info.sha:
        raise PrepareError(f"No revision SHA was reported for '{model_id}'.")
    return str(info.sha)


def _assert_writable_output(output_dir: Path, overwrite: bool) -> None:
    if not output_dir.exists():
        return
    if not output_dir.is_dir():
        raise PrepareError(f"Output path exists and is not a directory: {output_dir}")
    if any(output_dir.iterdir()) and not overwrite:
        raise PrepareError(
            f"Output directory is not empty: {output_dir}. "
            "Pass --overwrite to replace it explicitly."
        )


def prepare_model(
    model_id: str,
    output_dir: str | Path,
    revision: str | None = None,
    overwrite: bool = False,
    family: str = "auto",
) -> dict[str, Any]:
    """Download, validate and convert a supported model to INT8 CTranslate2."""
    from transformers import AutoConfig, AutoTokenizer

    output_path = Path(output_dir).expanduser().resolve()
    _assert_writable_output(output_path, overwrite)

    revision_sha = _resolve_revision(model_id, revision)

    try:
        config = AutoConfig.from_pretrained(model_id, revision=revision_sha)
    except Exception as exc:
        raise PrepareError(
            f"Could not load the model config for '{model_id}': {exc}"
        ) from exc

    try:
        tokenizer = AutoTokenizer.from_pretrained(
            model_id,
            revision=revision_sha,
        )
    except Exception as exc:
        raise PrepareError(f"Could not load the tokenizer: {exc}") from exc

    resolved_family = _resolve_family(family, config, tokenizer)
    try:
        validate_config(resolved_family, config)
    except AdapterError as exc:
        raise PrepareError(str(exc)) from exc

    pair_metadata: dict[str, str] = {}
    if resolved_family == "marian":
        source_lang, target_lang = parse_marian_pair(model_id)
        pair_metadata = {
            "source_lang": source_lang,
            "target_lang": target_lang,
        }
    try:
        adapter = adapter_for(resolved_family, tokenizer, pair_metadata)
        adapter.validate_tokenizer()
    except AdapterError as exc:
        raise PrepareError(str(exc)) from exc

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = Path(
        tempfile.mkdtemp(
            prefix=f".{output_path.name}.prepare-",
            dir=str(output_path.parent),
        )
    )
    try:
        try:
            from ctranslate2.converters import TransformersConverter
        except Exception as exc:  # pragma: no cover - environment dependent
            raise PrepareError(
                "CTranslate2 conversion dependencies are missing. "
                'Install the conversion extra: pip install -e "./server[convert]"'
            ) from exc

        try:
            converter = TransformersConverter(
                model_id,
                revision=revision_sha,
                low_cpu_mem_usage=True,
            )
            converter.convert(
                str(temp_path),
                quantization="int8",
                # temp_path is a freshly created empty directory owned by this
                # run. The outer --overwrite guard already protected the real
                # output directory.
                force=True,
            )
        except Exception as exc:
            raise PrepareError(
                f"CTranslate2 conversion failed for '{model_id}': {exc}"
            ) from exc

        tokenizer_path = temp_path / "tokenizer"
        tokenizer.save_pretrained(str(tokenizer_path))

        metadata: dict[str, Any] = {
            "format_version": 2,
            "model_id": model_id,
            "revision": revision_sha,
            "family": resolved_family,
            "architecture": (
                "NLLB"
                if resolved_family == "nllb"
                else resolved_family.upper()
            ),
            "quantization": "int8",
            "tokenizer": "tokenizer",
            "supported_languages": dict(SUPPORTED_LANGUAGES),
            **pair_metadata,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        (temp_path / "model-metadata.json").write_text(
            json.dumps(metadata, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

        if output_path.exists():
            if output_path.is_dir():
                shutil.rmtree(output_path)
            else:
                output_path.unlink()
        temp_path.rename(output_path)
        return metadata
    except Exception:
        shutil.rmtree(temp_path, ignore_errors=True)
        raise
