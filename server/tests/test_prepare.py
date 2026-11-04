from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from ct2_nllb_server.adapters import (
    AdapterError,
    detect_family,
    family_from_metadata,
    validate_config,
)
from ct2_nllb_server.engine import EngineLoadError, read_metadata
from ct2_nllb_server.languages import SUPPORTED_LANGUAGES
from ct2_nllb_server.prepare import (
    PrepareError,
    _assert_writable_output,
    _resolve_family,
    _resolve_revision,
    parse_marian_pair,
    prepare_model,
)


def test_validate_config_accepts_each_supported_family() -> None:
    validate_config(
        "nllb",
        SimpleNamespace(
            model_type="nllb",
            architectures=["NllbForConditionalGeneration"],
        ),
    )
    # The official facebook/nllb checkpoint reuses the M2M-100 config class.
    validate_config(
        "nllb",
        SimpleNamespace(
            model_type="m2m_100",
            architectures=["M2M100ForConditionalGeneration"],
        ),
    )
    validate_config(
        "m2m100", SimpleNamespace(model_type="m2m_100", architectures=[])
    )
    validate_config(
        "mbart50", SimpleNamespace(model_type="mbart", architectures=[])
    )
    validate_config(
        "marian", SimpleNamespace(model_type="marian", architectures=[])
    )


def test_validate_config_rejects_mismatched_families() -> None:
    with pytest.raises(AdapterError, match="Supported families"):
        validate_config(
            "nllb",
            SimpleNamespace(model_type="m2m_100", architectures=[]),
        )
    with pytest.raises(AdapterError):
        validate_config(
            "marian", SimpleNamespace(model_type="t5", architectures=[])
        )


class FakeNllbTokenizer:
    unk_token_id = 1
    src_lang = "eng_Latn"

    def __init__(self, supported: set[str] | None = None) -> None:
        self.supported = (
            supported if supported is not None else set(SUPPORTED_LANGUAGES)
        )

    def convert_tokens_to_ids(self, token: str) -> int:
        return 123 if token in self.supported else self.unk_token_id


class FakeM2M100Tokenizer(FakeNllbTokenizer):
    pass


class FakeMarianTokenizer(FakeNllbTokenizer):
    pass


def test_detect_family_prefers_the_tokenizer() -> None:
    config = SimpleNamespace(model_type="m2m_100", architectures=[])
    assert detect_family(config, FakeNllbTokenizer()) == "nllb"
    assert detect_family(config, FakeM2M100Tokenizer()) == "m2m100"
    assert (
        detect_family(
            SimpleNamespace(model_type="mbart", architectures=[]),
            FakeM2M100Tokenizer(),
        )
        == "m2m100"
    )
    assert (
        detect_family(
            SimpleNamespace(model_type="marian", architectures=[]),
            FakeMarianTokenizer(),
        )
        == "marian"
    )


def test_resolve_family_rejects_unsupported_requested_value() -> None:
    with pytest.raises(PrepareError, match="Unsupported model family"):
        _resolve_family("t5", object(), FakeNllbTokenizer())


def test_family_from_metadata_accepts_legacy_nllb_marker() -> None:
    assert (
        family_from_metadata({"architecture": "NLLB"})
        == "nllb"
    )
    assert family_from_metadata({"family": "marian"}) == "marian"
    with pytest.raises(AdapterError, match="Supported families"):
        family_from_metadata({"architecture": "M2M100"})


def test_parse_marian_pair_from_model_name() -> None:
    assert parse_marian_pair("Helsinki-NLP/opus-mt-en-tr") == (
        "eng_Latn",
        "tur_Latn",
    )
    assert parse_marian_pair("Helsinki-NLP/opus-mt-tc-big-de-fr") == (
        "deu_Latn",
        "fra_Latn",
    )
    with pytest.raises(PrepareError, match="language pair"):
        parse_marian_pair("Helsinki-NLP/opus-mt-en-ROMANCE")


def test_full_revision_sha_needs_no_metadata_request() -> None:
    sha = "f8d333a098d19b4fd9a8b18f94170487ad3f821d"
    assert _resolve_revision("facebook/nllb-200-distilled-600M", sha) == sha


def test_prepare_refuses_a_nonempty_output_without_overwrite(tmp_path: Path) -> None:
    output = tmp_path / "model"
    output.mkdir()
    (output / "keep.txt").write_text("keep", encoding="utf-8")

    with pytest.raises(PrepareError, match="--overwrite"):
        prepare_model(
            "facebook/nllb-200-distilled-600M",
            output,
            overwrite=False,
        )
    assert (output / "keep.txt").read_text(encoding="utf-8") == "keep"


def test_assert_writable_output_allows_empty_and_overwrite(tmp_path: Path) -> None:
    _assert_writable_output(tmp_path / "missing", overwrite=False)
    empty = tmp_path / "empty"
    empty.mkdir()
    _assert_writable_output(empty, overwrite=False)

    filled = tmp_path / "filled"
    filled.mkdir()
    (filled / "x").write_text("x", encoding="utf-8")
    _assert_writable_output(filled, overwrite=True)


def test_read_metadata_validates_local_model_marker(tmp_path: Path) -> None:
    path = tmp_path / "model-metadata.json"
    path.write_text(
        json.dumps(
            {
                "model_id": "facebook/nllb-200-distilled-600M",
                "revision": "abc123",
                "architecture": "NLLB",
            }
        ),
        encoding="utf-8",
    )
    metadata = read_metadata(tmp_path)
    assert metadata["model_id"] == "facebook/nllb-200-distilled-600M"
    assert metadata["revision"] == "abc123"
    assert metadata["family"] == "nllb"


def test_read_metadata_accepts_format_version_two(tmp_path: Path) -> None:
    (tmp_path / "model-metadata.json").write_text(
        json.dumps(
            {
                "format_version": 2,
                "model_id": "Helsinki-NLP/opus-mt-en-tr",
                "family": "marian",
                "source_lang": "eng_Latn",
                "target_lang": "tur_Latn",
            }
        ),
        encoding="utf-8",
    )
    metadata = read_metadata(tmp_path)
    assert metadata["family"] == "marian"
    assert metadata["source_lang"] == "eng_Latn"


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"model_id": "x", "architecture": "M2M100"},
        {"model_id": "", "architecture": "NLLB"},
        {"model_id": "x", "family": "t5"},
    ],
)
def test_read_metadata_rejects_invalid_markers(
    tmp_path: Path, payload: dict[str, object]
) -> None:
    (tmp_path / "model-metadata.json").write_text(
        json.dumps(payload), encoding="utf-8"
    )
    with pytest.raises(EngineLoadError):
        read_metadata(tmp_path)


def test_check_model_accepts_supported_families(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from ct2_nllb_server.prepare import check_model

    class FakeInfo:
        sha = "a" * 40
        config = {"model_type": "marian", "architectures": []}

    class FakeApi:
        def model_info(self, _model_id, revision=None, expand=None):
            return FakeInfo()

    monkeypatch.setattr("huggingface_hub.HfApi", FakeApi)

    result = check_model("Helsinki-NLP/opus-mt-en-tr")

    assert result["ok"] is True
    assert result["family"] == "marian"
    assert result["revision"] == "a" * 40
    assert result["language_pairs"] == [["eng_Latn", "tur_Latn"]]


def test_check_model_reports_missing_repository_with_suggestions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from huggingface_hub.utils import RepositoryNotFoundError

    from ct2_nllb_server.prepare import check_model

    class FakeModel:
        id = "Helsinki-NLP/opus-mt-en-tr"
        downloads = 10
        config = {"model_type": "marian", "architectures": []}

    class FakeApi:
        def model_info(self, _model_id, revision=None, expand=None):
            raise RepositoryNotFoundError("missing")

        def list_models(self, **_kwargs):
            return [FakeModel()]

    monkeypatch.setattr("huggingface_hub.HfApi", FakeApi)

    result = check_model("Helsinki-NLP/opus-mt-en-tl")

    assert result["ok"] is False
    assert result["code"] == "not_found"
    assert result["suggestions"] == ["Helsinki-NLP/opus-mt-en-tr"]


def test_check_model_reports_gated_repository(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from huggingface_hub.utils import GatedRepoError

    from ct2_nllb_server.prepare import check_model

    class FakeApi:
        def model_info(self, _model_id, revision=None, expand=None):
            raise GatedRepoError("gated")

    monkeypatch.setattr("huggingface_hub.HfApi", FakeApi)

    result = check_model("meta/private-translation")

    assert result["ok"] is False
    assert result["code"] == "gated"
    assert "gated" in result["message"]


def test_check_model_reports_unsupported_family(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from ct2_nllb_server.prepare import check_model

    class FakeInfo:
        sha = "b" * 40
        config = {"model_type": "t5", "architectures": ["T5ForConditionalGeneration"]}

    class FakeApi:
        def model_info(self, _model_id, revision=None, expand=None):
            return FakeInfo()

    monkeypatch.setattr("huggingface_hub.HfApi", FakeApi)

    result = check_model("some/t5-translation")

    assert result["ok"] is False
    assert result["code"] == "unsupported_family"
    assert result["model_type"] == "t5"
    assert "nllb" in result["message"]
