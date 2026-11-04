from __future__ import annotations

import json
from pathlib import Path

from ct2_nllb_server.doctor import (
    collect_report,
    read_install_state,
    write_install_state,
)
from ct2_nllb_server.native_host import HOST_VERSION


def _make_model(root: Path, name: str, model_id: str) -> Path:
    directory = root / name
    (directory / "tokenizer").mkdir(parents=True)
    (directory / "model.bin").write_bytes(b"model")
    (directory / "model-metadata.json").write_text(
        json.dumps({"format_version": 2, "model_id": model_id, "family": "nllb"}),
        encoding="utf-8",
    )
    return directory


def test_install_state_round_trip(tmp_path: Path) -> None:
    payload = write_install_state("v3.6.0", tmp_path)

    assert payload["ref"] == "v3.6.0"
    assert payload["hostVersion"] == HOST_VERSION
    assert payload["installedAt"]
    stored = json.loads(
        (tmp_path / "install-state.json").read_text(encoding="utf-8")
    )
    assert stored["ref"] == "v3.6.0"
    assert read_install_state(tmp_path) == stored
    assert read_install_state(tmp_path / "missing") is None


def test_report_reports_host_models_and_browsers(tmp_path: Path) -> None:
    host_root = tmp_path / "native-host"
    host_root.mkdir()
    (host_root / "ct2-native-host").write_text("launcher", encoding="utf-8")
    (host_root / "host-version.txt").write_text(
        f"{HOST_VERSION}\n", encoding="utf-8"
    )
    models_root = tmp_path / "models"
    _make_model(models_root, "nllb", "facebook/nllb-200-distilled-600M")
    (models_root / "broken").mkdir()
    write_install_state("local", tmp_path)

    report = collect_report(tmp_path, platform="linux")

    assert report["installRoot"] == str(tmp_path.resolve())
    assert report["host"]["upToDate"] is True
    assert report["host"]["expectedVersion"] == HOST_VERSION
    assert report["models"]["ready"] == 1
    assert report["models"]["total"] == 2
    assert report["installState"]["ref"] == "local"
    assert report["python"]["meetsRequirement"] is True
    assert set(report["browsers"]) == {"chrome", "edge"}
    assert report["browsers"] == {"chrome": False, "edge": False}


def test_report_flags_an_outdated_host(tmp_path: Path) -> None:
    host_root = tmp_path / "native-host"
    host_root.mkdir()
    (host_root / "ct2-native-host").write_text("launcher", encoding="utf-8")
    (host_root / "host-version.txt").write_text(
        f"{HOST_VERSION - 1}\n", encoding="utf-8"
    )

    report = collect_report(tmp_path, platform="linux")

    assert report["host"]["exists"] is True
    assert report["host"]["version"] == HOST_VERSION - 1
    assert report["host"]["upToDate"] is False
