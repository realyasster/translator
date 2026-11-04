from __future__ import annotations

import json
from pathlib import Path

import pytest

from ct2_nllb_server import native_install, paths
from ct2_nllb_server.native_host import load_config
from ct2_nllb_server.native_install import install_native_host


def test_windows_layout_uses_one_install_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    root = paths.install_root("windows")
    assert root == tmp_path / "UniversalSubtitleTranslator"
    assert paths.models_root("windows") == root / "models"
    assert paths.native_host_root("windows") == root / "native-host"
    assert paths.venv_python("windows") == root / "venv" / "Scripts" / "python.exe"


def test_default_models_root_uses_the_install_root() -> None:
    from ct2_nllb_server.model_registry import default_models_root

    assert default_models_root() == paths.models_root()


def test_load_config_reads_legacy_repo_root(
    tmp_path: Path,
) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    config_path = tmp_path / "native-host-config.json"
    config_path.write_text(
        json.dumps(
            {
                "repo_root": str(repo),
                "python_executable": str(Path(__import__("sys").executable)),
                "state_file": str(tmp_path / "state.json"),
                "log_file": str(tmp_path / "server.log"),
            }
        ),
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.install_root == repo.resolve()
    assert config.models_root == (repo / "server" / "models").resolve()


def test_install_writes_new_config_without_repo_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    install = tmp_path / "install"
    host_root = install / "native-host"
    models = install / "models"
    venv_python = install / "venv" / "Scripts" / "python.exe"
    venv_python.parent.mkdir(parents=True)
    venv_python.write_bytes(b"python")

    monkeypatch.setattr(
        native_install, "native_host_root", lambda _platform=None: host_root
    )
    monkeypatch.setattr(
        native_install, "install_root", lambda _platform=None: install
    )
    monkeypatch.setattr(
        native_install, "models_root", lambda _platform=None: models
    )
    monkeypatch.setattr(
        native_install, "venv_python", lambda _platform=None: venv_python
    )
    monkeypatch.setattr(
        native_install,
        "native_manifest_dir",
        lambda _browser, _platform=None: tmp_path / "manifests",
    )

    install_native_host(
        "a" * 32,
        browser="chrome",
        repo_root=Path.cwd(),
        platform_name="linux",
        force=True,
    )

    payload = json.loads(
        (host_root / "native-host-config.json").read_text(encoding="utf-8")
    )
    assert payload["install_root"] == str(install.resolve())
    assert payload["models_root"] == str(models.resolve())
    assert payload["python_executable"] == str(venv_python.resolve())
    assert "repo_root" not in payload
    assert models.is_dir()


def test_purge_keeps_models_by_default(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    install = tmp_path / "install"
    host_root = install / "native-host"
    models = install / "models"
    host_root.mkdir(parents=True)
    (install / "venv").mkdir(parents=True)
    models.mkdir(parents=True)
    (models / "keep.bin").write_bytes(b"model")

    monkeypatch.setattr(paths, "install_root", lambda _platform=None: install)
    monkeypatch.setattr(
        native_install, "native_host_root", lambda _platform=None: host_root
    )
    monkeypatch.setattr(
        native_install, "install_root", lambda _platform=None: install
    )
    monkeypatch.setattr(
        native_install, "models_root", lambda _platform=None: models
    )

    native_install.remove_installed_files("linux")
    assert not host_root.exists()
    assert not (install / "venv").exists()
    assert models.is_dir()

    native_install.remove_installed_files("linux", purge_models=True)
    assert not models.exists()


def test_windows_host_build_hides_the_console(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from types import SimpleNamespace

    import sys as _sys

    repo = tmp_path / "repo"
    entry = repo / "server" / "native_host_entry.py"
    entry.parent.mkdir(parents=True)
    entry.write_text("", encoding="utf-8")
    host = tmp_path / "native-host" / "ct2-native-host.exe"
    captured: dict[str, object] = {}

    def fake_run(command, **_kwargs):
        captured["command"] = command
        host.parent.mkdir(parents=True, exist_ok=True)
        host.write_bytes(b"")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setitem(
        _sys.modules, "PyInstaller", SimpleNamespace(__version__="test")
    )
    monkeypatch.setattr(native_install.subprocess, "run", fake_run)

    native_install._build_windows_host(host, repo, force=True)

    command = captured["command"]
    assert command[command.index("--onefile") + 1] == "--noconsole"
    assert "--paths" in command


def test_windows_host_build_reports_a_locked_executable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from types import SimpleNamespace

    import sys as _sys

    repo = tmp_path / "repo"
    entry = repo / "server" / "native_host_entry.py"
    entry.parent.mkdir(parents=True)
    entry.write_text("", encoding="utf-8")
    host = tmp_path / "native-host" / "ct2-native-host.exe"

    def fake_run(_command, **_kwargs):
        return SimpleNamespace(
            returncode=1,
            stdout=(
                "PermissionError: [WinError 5] Access is denied: "
                "'ct2-native-host.exe'"
            ),
            stderr="",
        )

    monkeypatch.setitem(
        _sys.modules, "PyInstaller", SimpleNamespace(__version__="test")
    )
    monkeypatch.setattr(native_install.subprocess, "run", fake_run)

    with pytest.raises(native_install.NativeInstallError, match="in use"):
        native_install._build_windows_host(host, repo, force=True)
