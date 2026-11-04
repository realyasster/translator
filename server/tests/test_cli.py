from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from ct2_nllb_server.cli import _list_models, _search_models


def make_model(root: Path, name: str, model_id: str) -> Path:
    directory = root / name
    (directory / "tokenizer").mkdir(parents=True)
    (directory / "model.bin").write_bytes(b"model")
    (directory / "model-metadata.json").write_text(
        json.dumps(
            {
                "format_version": 2,
                "model_id": model_id,
                "family": "nllb",
            }
        ),
        encoding="utf-8",
    )
    return directory


def test_list_models_json_reports_valid_and_invalid_entries(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    model = make_model(tmp_path, "nllb", "facebook/nllb-200-distilled-600M")
    (tmp_path / "broken").mkdir()

    exit_code = _list_models(
        SimpleNamespace(models_root=str(tmp_path), json=True)
    )

    assert exit_code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["models_root"] == str(tmp_path.resolve())
    by_name = {entry["name"]: entry for entry in payload["models"]}
    assert by_name["nllb"]["directory"] == str(model.resolve())
    assert by_name["nllb"]["valid"] is True
    assert by_name["broken"]["valid"] is False


def test_search_models_filters_unsupported_families(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    class FakeModel:
        def __init__(self, model_id: str, model_type: str) -> None:
            self.id = model_id
            self.downloads = 10
            self.config = {"model_type": model_type, "architectures": []}

    class FakeApi:
        def list_models(self, **_kwargs):
            return [
                FakeModel("Helsinki-NLP/opus-mt-en-tr", "marian"),
                FakeModel("some/t5-model", "t5"),
                FakeModel("facebook/nllb-200-distilled-600M", "m2m_100"),
            ]

    monkeypatch.setattr("huggingface_hub.HfApi", FakeApi)
    args = SimpleNamespace(query="opus", limit=15, json=True)

    assert _search_models(args) == 0
    payload = json.loads(capsys.readouterr().out)
    assert [entry["id"] for entry in payload] == [
        "Helsinki-NLP/opus-mt-en-tr",
        "facebook/nllb-200-distilled-600M",
    ]
    assert payload[0]["family"] == "marian"
    assert payload[1]["family"] == "nllb"


def test_doctor_json_reports_the_install_root(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    from ct2_nllb_server.cli import _doctor

    assert _doctor(SimpleNamespace(install_root=str(tmp_path), json=True)) == 0

    payload = json.loads(capsys.readouterr().out)
    assert payload["installRoot"] == str(tmp_path.resolve())
    assert "host" in payload
    assert "installState" in payload
    assert "models" in payload
