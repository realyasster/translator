from __future__ import annotations

import json
from pathlib import Path

import pytest

from ct2_nllb_server.model_registry import (
    ModelRegistryError,
    inspect_model_directory,
    resolve_model_directory,
    scan_models,
)


def make_model(
    root: Path,
    name: str,
    model_id: str = "facebook/nllb-200-distilled-600M",
    *,
    family: str | None = "nllb",
) -> Path:
    directory = root / name
    (directory / "tokenizer").mkdir(parents=True)
    (directory / "model.bin").write_bytes(b"model")
    metadata: dict[str, object] = {
        "format_version": 2,
        "model_id": model_id,
        "revision": "abc",
    }
    if family is not None:
        metadata["family"] = family
    (directory / "model-metadata.json").write_text(
        json.dumps(metadata), encoding="utf-8"
    )
    return directory


def test_scan_models_reports_valid_and_broken_directories(
    tmp_path: Path,
) -> None:
    make_model(tmp_path, "nllb")
    broken = tmp_path / "broken"
    broken.mkdir()
    (broken / "model-metadata.json").write_text("{", encoding="utf-8")
    (tmp_path / "not-a-directory").write_text("x", encoding="utf-8")

    models = scan_models(tmp_path)
    assert [model["name"] for model in models] == ["broken", "nllb"]
    by_name = {model["name"]: model for model in models}
    assert by_name["nllb"]["valid"] is True
    assert by_name["nllb"]["family"] == "nllb"
    assert by_name["broken"]["valid"] is False
    assert "readable JSON" in by_name["broken"]["problem"]


def test_inspect_rejects_unsupported_family(tmp_path: Path) -> None:
    directory = make_model(tmp_path, "t5", family="t5")
    entry = inspect_model_directory(directory)
    assert entry["valid"] is False
    assert "Unsupported model family" in entry["problem"]


def test_resolve_legacy_relative_directory_under_models_root(
    tmp_path: Path,
) -> None:
    models = tmp_path / "install" / "models"
    make_model(models, "nllb")
    resolved = resolve_model_directory(
        models,
        "./server/models/nllb",
        "facebook/nllb-200-distilled-600M",
    )
    assert resolved == (models / "nllb").resolve()


def test_resolve_falls_back_to_model_id_when_folder_name_is_wrong(
    tmp_path: Path,
) -> None:
    models = tmp_path / "models"
    actual = make_model(
        models,
        "right",
        "Helsinki-NLP/opus-mt-en-tr",
        family="marian",
    )
    resolved = resolve_model_directory(
        models,
        "./server/models/wrong",
        "Helsinki-NLP/opus-mt-en-tr",
    )
    assert resolved == actual.resolve()


def test_resolve_empty_directory_uses_the_single_matching_model(
    tmp_path: Path,
) -> None:
    actual = make_model(tmp_path, "auto-match", "facebook/nllb-200-distilled-600M")
    make_model(tmp_path, "other", "other/model")
    resolved = resolve_model_directory(
        tmp_path,
        "",
        "facebook/nllb-200-distilled-600M",
    )
    assert resolved == actual.resolve()


def test_resolve_reports_ambiguous_and_missing_models(tmp_path: Path) -> None:
    make_model(tmp_path, "first", "same/model")
    make_model(tmp_path, "second", "same/model")
    with pytest.raises(ModelRegistryError) as exc:
        resolve_model_directory(tmp_path, "", "same/model")
    assert exc.value.code == "model_select_required"
    assert "first" in exc.value.message and "second" in exc.value.message

    with pytest.raises(ModelRegistryError) as exc:
        resolve_model_directory(tmp_path, "", "missing/model")
    assert exc.value.code == "model_not_prepared"
    assert "Prepared models:" in exc.value.message

    empty_root = tmp_path / "empty"
    empty_root.mkdir()
    with pytest.raises(ModelRegistryError) as exc:
        resolve_model_directory(empty_root, "", "missing/model")
    assert str(empty_root) in exc.value.message
