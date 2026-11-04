from __future__ import annotations

import io
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from ct2_nllb_server import native_host
from ct2_nllb_server.native_host import (
    HostConfig,
    HostRequestError,
    ServerController,
    handle_request,
    read_message,
    validate_settings,
    write_message,
)
from ct2_nllb_server.native_install import (
    DEFAULT_EXTENSION_ID,
    NativeInstallError,
    build_native_manifest,
    install_native_host,
    native_manifest_dir,
    normalize_extension_id,
    remove_installed_files,
    resolve_browsers,
    uninstall_native_host,
)
from ct2_nllb_server import native_install


def make_model(
    tmp_path: Path,
    model_id: str = "facebook/nllb-test",
    *,
    name: str | None = None,
) -> Path:
    model = tmp_path / name if name else tmp_path / "My Models" / "NLLB ü"
    (model / "tokenizer").mkdir(parents=True)
    (model / "model.bin").write_bytes(b"model")
    (model / "model-metadata.json").write_text(
        json.dumps(
            {
                "model_id": model_id,
                "revision": "abc",
                "architecture": "NLLB",
            }
        ),
        encoding="utf-8",
    )
    return model


def settings_payload(model_dir: Path, **overrides: Any) -> dict[str, Any]:
    payload = {
        "modelDirectory": str(model_dir),
        "device": "cpu",
        "computeType": "int8",
        "host": "127.0.0.1",
        "port": 8000,
        "logLevel": "info",
    }
    payload.update(overrides)
    return payload


def test_native_message_round_trip() -> None:
    stream = io.BytesIO()
    write_message({"action": "ping", "text": "merhaba ü"}, stream)
    stream.seek(0)
    assert read_message(stream) == {"action": "ping", "text": "merhaba ü"}


def test_native_message_rejects_invalid_length() -> None:
    stream = io.BytesIO(b"\xff\xff\xff\x7f")
    with pytest.raises(HostRequestError, match="length"):
        read_message(stream)


def test_validate_settings_accepts_spaces_and_unicode(tmp_path: Path) -> None:
    model = make_model(tmp_path)
    settings = validate_settings(
        {
            **settings_payload(model),
            "selectedModel": "facebook/nllb-test",
        }
    )
    assert settings.model_directory == model.resolve()
    assert settings.port == 8000


@pytest.mark.parametrize(
    ("overrides", "code", "message_part"),
    [
        ({"modelDirectory": "--overwrite"}, "invalid_settings", "start with"),
        ({"modelDirectory": "bad\npath"}, "invalid_settings", "newline"),
        ({"host": "0.0.0.0"}, "invalid_settings", "host"),
        ({"port": 0}, "invalid_settings", "between 1"),
        ({"port": 65536}, "invalid_settings", "between 1"),
        ({"device": "tpu"}, "invalid_settings", "device"),
        ({"computeType": "int4"}, "invalid_settings", "computeType"),
        ({"logLevel": "trace"}, "invalid_settings", "logLevel"),
    ],
)
def test_validate_settings_rejects_invalid_values(
    tmp_path: Path,
    overrides: dict[str, Any],
    code: str,
    message_part: str,
) -> None:
    model = make_model(tmp_path)
    with pytest.raises(HostRequestError) as exc:
        validate_settings(
            {
                **settings_payload(model, **overrides),
                "selectedModel": "facebook/nllb-test",
            }
        )
    assert exc.value.code == code
    assert message_part.lower() in exc.value.message.lower()


def test_validate_settings_resolves_legacy_relative_directory_under_models_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    models = tmp_path / "install" / "models"
    model = make_model(models, name="NLLB ü")
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)

    settings = validate_settings(
        {
            **settings_payload(model),
            "modelDirectory": "./server/models/NLLB ü",
            "selectedModel": "facebook/nllb-test",
        },
        models_root=models,
    )
    assert settings.model_directory == model.resolve()


def test_validate_settings_auto_matches_by_model_id(
    tmp_path: Path,
) -> None:
    models = tmp_path / "install" / "models"
    model = make_model(models, name="actual-model")

    settings = validate_settings(
        {
            **settings_payload(model),
            "modelDirectory": "./server/models/wrong-name",
            "selectedModel": "facebook/nllb-test",
        },
        models_root=models,
    )
    assert settings.model_directory == model.resolve()


def test_validate_settings_reports_missing_and_ambiguous_models(
    tmp_path: Path,
) -> None:
    models = tmp_path / "install" / "models"
    models.mkdir(parents=True)

    with pytest.raises(HostRequestError) as exc:
        validate_settings(
            {
                **settings_payload(models / "missing"),
                "modelDirectory": "",
                "selectedModel": "facebook/nllb-test",
            },
            models_root=models,
        )
    assert exc.value.code == "model_not_prepared"
    assert str(models) in exc.value.message

    make_model(models, name="first")
    make_model(models, name="second")
    with pytest.raises(HostRequestError) as exc:
        validate_settings(
            {
                **settings_payload(models / "first"),
                "modelDirectory": "",
                "selectedModel": "facebook/nllb-test",
            },
            models_root=models,
        )
    assert exc.value.code == "model_select_required"
    assert "first" in exc.value.message and "second" in exc.value.message


def test_list_models_action_scans_the_install_models_folder(
    tmp_path: Path,
) -> None:
    install = tmp_path / "install"
    models = install / "models"
    model = make_model(models, name="listed-model")
    config = HostConfig(
        install_root=install,
        models_root=models,
        python_executable=Path(sys.executable),
        state_file=tmp_path / "state.json",
        log_file=tmp_path / "server.log",
    )

    response = handle_request({"action": "list_models"}, config)

    assert response["ok"] is True
    assert response["action"] == "list_models"
    assert response["modelsRoot"] == str(models.resolve())
    assert response["models"][0]["directory"] == str(model.resolve())
    assert response["models"][0]["valid"] is True

    ping = handle_request({"action": "ping"}, config)
    assert ping["hostVersion"] == native_host.HOST_VERSION
    assert ping["modelsRoot"] == str(models.resolve())


def test_validate_settings_requires_prepared_model_and_matching_identity(
    tmp_path: Path,
) -> None:
    model = make_model(tmp_path)
    (model / "model.bin").unlink()
    with pytest.raises(HostRequestError) as exc:
        validate_settings(
            {
                **settings_payload(model),
                "selectedModel": "facebook/nllb-test",
            }
        )
    assert exc.value.code == "model_not_prepared"

    model = make_model(tmp_path / "second")
    with pytest.raises(HostRequestError) as exc:
        validate_settings(
            {
                **settings_payload(model),
                "selectedModel": "facebook/other",
            }
        )
    assert exc.value.code == "model_mismatch"


class FakeProcess:
    def __init__(
        self,
        pid: int = 4321,
        create_time: float = 100.0,
        listen_port: int = 8000,
    ):
        self.pid = pid
        self._create_time = create_time
        self.listen_port = listen_port
        self.terminated = False

    def poll(self):
        return None

    def create_time(self):
        return self._create_time

    def cmdline(self):
        return ["python", "-m", "ct2_nllb_server", "serve"]

    def net_connections(self, kind: str = "inet"):
        import psutil

        return [
            SimpleNamespace(
                laddr=SimpleNamespace(port=self.listen_port),
                status=psutil.CONN_LISTEN,
            )
        ]

    def children(self, recursive: bool = True):
        return []

    def terminate(self):
        self.terminated = True


def test_start_status_and_stop_manage_only_owned_process(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import psutil

    model = make_model(tmp_path)
    config = HostConfig(
        install_root=tmp_path,
        models_root=tmp_path / "models",
        python_executable=Path(sys.executable),
        state_file=tmp_path / "state" / "server.json",
        log_file=tmp_path / "logs" / "server.log",
    )
    fake_process = FakeProcess()
    captured: dict[str, Any] = {}

    def fake_popen(command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        return fake_process

    monkeypatch.setattr(native_host.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(psutil, "Process", lambda _pid: fake_process)
    health = {
        "status": "ready",
        "model": "facebook/nllb-test",
        "model_dir": "NLLB ü",
        "device": "cpu",
        "compute_type": "int8",
        "max_input_tokens": 512,
    }
    health_calls = {"count": 0}

    def fake_health(_host, _port):
        health_calls["count"] += 1
        return None if health_calls["count"] == 1 else health

    monkeypatch.setattr(native_host, "_health", fake_health)
    monkeypatch.setattr(native_host, "_port_open", lambda _host, _port: False)

    controller = ServerController(config)
    result = controller.start(
        {
            "settings": settings_payload(model),
            "selectedModel": "facebook/nllb-test",
        }
    )
    assert result["state"] == "running"
    assert result["managed"] is True
    command = captured["command"]
    assert command[0] == str(
        native_host.server_executable(Path(sys.executable))
    )
    assert "--model-dir" in command
    assert command[command.index("--model-dir") + 1] == str(
        model.resolve()
    )
    assert captured["kwargs"].get("shell", False) is False
    assert captured["kwargs"]["cwd"] == str(tmp_path)
    assert config.state_file.is_file()
    state = json.loads(config.state_file.read_text(encoding="utf-8"))
    assert state["log_level"] == "info"
    assert state["selected_model"] == "facebook/nllb-test"
    if os.name == "nt":
        creationflags = captured["kwargs"]["creationflags"]
        assert creationflags & native_host.subprocess.CREATE_NO_WINDOW
        assert not creationflags & native_host.subprocess.DETACHED_PROCESS
        startupinfo = captured["kwargs"]["startupinfo"]
        assert startupinfo.dwFlags & native_host.subprocess.STARTF_USESHOWWINDOW
        assert startupinfo.wShowWindow == native_host.subprocess.SW_HIDE

    status = controller.status(settings_payload(model, port=8123))
    assert status["state"] == "running"
    assert status["health"]["model"] == "facebook/nllb-test"

    monkeypatch.setattr(
        controller,
        "_terminate_pid",
        lambda pid: setattr(fake_process, "terminated", True),
    )
    stopped = controller.stop()
    assert stopped["state"] == "stopped"
    assert not config.state_file.exists()


def test_start_returns_external_running_without_spawning(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = make_model(tmp_path)
    config = HostConfig(
        install_root=tmp_path,
        models_root=tmp_path / "models",
        python_executable=Path(sys.executable),
        state_file=tmp_path / "state.json",
        log_file=tmp_path / "server.log",
    )
    health = {
        "status": "ready",
        "model": "facebook/nllb-test",
        "device": "cpu",
        "compute_type": "int8",
        "max_input_tokens": 512,
    }
    monkeypatch.setattr(native_host, "_health", lambda _host, _port: health)
    monkeypatch.setattr(
        native_host.subprocess,
        "Popen",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("must not spawn")
        ),
    )

    result = ServerController(config).start(
        {
            "settings": settings_payload(model),
            "selectedModel": "facebook/nllb-test",
        }
    )
    assert result["state"] == "external_running"
    assert result["managed"] is False


def test_start_rejects_port_in_use(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = make_model(tmp_path)
    config = HostConfig(
        install_root=tmp_path,
        models_root=tmp_path / "models",
        python_executable=Path(sys.executable),
        state_file=tmp_path / "state.json",
        log_file=tmp_path / "server.log",
    )
    monkeypatch.setattr(native_host, "_health", lambda _host, _port: None)
    monkeypatch.setattr(native_host, "_port_open", lambda _host, _port: True)
    with pytest.raises(HostRequestError) as exc:
        ServerController(config).start(
            {
                "settings": settings_payload(model),
                "selectedModel": "facebook/nllb-test",
            }
        )
    assert exc.value.code == "port_in_use"


def test_stop_without_managed_state_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = HostConfig(
        install_root=tmp_path,
        models_root=tmp_path / "models",
        python_executable=Path(sys.executable),
        state_file=tmp_path / "state.json",
        log_file=tmp_path / "server.log",
    )
    monkeypatch.setattr(native_host, "_health", lambda _host, _port: None)
    with pytest.raises(HostRequestError) as exc:
        ServerController(config).stop()
    assert exc.value.code == "not_managed"


def test_netstat_parser_finds_listening_pid() -> None:
    output = """
  TCP    127.0.0.1:8000       0.0.0.0:0              LISTENING       4321
  TCP    [::1]:8000           [::]:0                 LISTENING       4322
  TCP    127.0.0.1:9000       0.0.0.0:0              LISTENING       9999
"""
    assert native_host._parse_netstat_listening_pids(output, 8000) == {
        4321,
        4322,
    }


def test_stop_can_stop_a_recognized_external_ct2_process(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import psutil

    external = FakeProcess(pid=7777)

    def external_cmdline():
        return [
            r"C:\repo\server\.venv\Scripts\ct2-nllb-server.exe",
            "serve",
            "--model-dir",
            r"C:\models\nllb",
        ]

    external.cmdline = external_cmdline
    config = HostConfig(
        install_root=tmp_path,
        models_root=tmp_path / "models",
        python_executable=Path(sys.executable),
        state_file=tmp_path / "state.json",
        log_file=tmp_path / "server.log",
    )
    killed: list[int] = []
    monkeypatch.setattr(
        native_host,
        "_health",
        lambda _host, _port: {"status": "ready", "model": "facebook/nllb"},
    )
    monkeypatch.setattr(native_host, "_listening_pids", lambda _port: {7777})
    monkeypatch.setattr(psutil, "Process", lambda _pid: external)
    monkeypatch.setattr(
        ServerController,
        "_terminate_pid",
        lambda self, pid: killed.append(pid),
    )

    result = ServerController(config).stop(
        {"host": "127.0.0.1", "port": 8000}
    )
    assert result["state"] == "stopped"
    assert result["external"] is True
    assert killed == [7777]


def test_stop_refuses_an_unrecognized_process_on_the_port(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import psutil

    external = FakeProcess(pid=8888)
    external.cmdline = lambda: ["python", "some_other_server.py"]
    config = HostConfig(
        install_root=tmp_path,
        models_root=tmp_path / "models",
        python_executable=Path(sys.executable),
        state_file=tmp_path / "state.json",
        log_file=tmp_path / "server.log",
    )
    monkeypatch.setattr(
        native_host,
        "_health",
        lambda _host, _port: {"status": "ready", "model": "facebook/nllb"},
    )
    monkeypatch.setattr(native_host, "_listening_pids", lambda _port: {8888})
    monkeypatch.setattr(psutil, "Process", lambda _pid: external)

    with pytest.raises(HostRequestError) as exc:
        ServerController(config).stop(
            {"host": "127.0.0.1", "port": 8000}
        )
    assert exc.value.code == "external_not_ct2"


def test_start_rejects_a_managed_server_with_different_settings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import psutil

    model = make_model(tmp_path)
    config = HostConfig(
        install_root=tmp_path,
        models_root=tmp_path / "models",
        python_executable=Path(sys.executable),
        state_file=tmp_path / "state.json",
        log_file=tmp_path / "server.log",
    )
    fake_process = FakeProcess()
    monkeypatch.setattr(psutil, "Process", lambda _pid: fake_process)
    config.state_file.write_text(
        json.dumps(
            {
                "pid": fake_process.pid,
                "create_time": 100.0,
                "host": "127.0.0.1",
                "port": 8000,
                "model_directory": str(model.resolve()),
                "selected_model": "facebook/nllb-test",
                "device": "cpu",
                "compute_type": "int8",
                "log_level": "info",
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(HostRequestError) as exc:
        ServerController(config).start(
            {
                "settings": settings_payload(
                    model, device="cuda", computeType="int8_float16"
                ),
                "selectedModel": "facebook/nllb-test",
            }
        )
    assert exc.value.code == "already_running_with_different_settings"


def test_managed_command_requires_exact_module_tokens() -> None:
    assert native_host._has_managed_command(
        ["python", "-m", "ct2_nllb_server", "serve", "--port", "8000"]
    )
    assert not native_host._has_managed_command(
        [
            r"C:\tools\ct2_nllb_server\python.exe",
            "-c",
            "print('ct2_nllb_server')",
        ]
    )


def test_unicode_port_digits_are_invalid(tmp_path: Path) -> None:
    model = make_model(tmp_path)
    with pytest.raises(HostRequestError) as exc:
        validate_settings(
            {
                **settings_payload(model, port="٨٠٠٠"),
                "selectedModel": "facebook/nllb-test",
            }
        )
    assert exc.value.code == "invalid_settings"


def test_start_writes_state_before_health_wait(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import psutil

    model = make_model(tmp_path)
    config = HostConfig(
        install_root=tmp_path,
        models_root=tmp_path / "models",
        python_executable=Path(sys.executable),
        state_file=tmp_path / "state.json",
        log_file=tmp_path / "server.log",
    )
    fake_process = FakeProcess()
    written: list[dict[str, Any]] = []
    original_write = native_host._write_state

    def capture_write(path: Path, payload: dict[str, Any]) -> None:
        written.append(dict(payload))
        original_write(path, payload)

    monkeypatch.setattr(native_host.subprocess, "Popen", lambda *a, **k: fake_process)
    monkeypatch.setattr(psutil, "Process", lambda _pid: fake_process)
    monkeypatch.setattr(native_host, "_health", lambda _host, _port: None)
    monkeypatch.setattr(native_host, "_port_open", lambda _host, _port: False)
    monkeypatch.setattr(native_host, "_write_state", capture_write)
    monkeypatch.setattr(native_host, "START_TIMEOUT_SECONDS", 0.05)
    monkeypatch.setattr(native_host.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(
        ServerController, "_terminate_pid", lambda self, _pid: None
    )

    with pytest.raises(HostRequestError) as exc:
        ServerController(config).start(
            {
                "settings": settings_payload(model),
                "selectedModel": "facebook/nllb-test",
            }
        )
    assert exc.value.code == "start_timeout"
    assert written
    assert written[0]["pid"] == fake_process.pid
    assert written[0]["log_level"] == "info"
    assert not config.state_file.exists()


def test_create_time_failure_does_not_claim_an_external_health_response(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import psutil

    class BadCreateProcess(FakeProcess):
        def create_time(self):
            raise psutil.NoSuchProcess(self.pid)

    model = make_model(tmp_path)
    config = HostConfig(
        install_root=tmp_path,
        models_root=tmp_path / "models",
        python_executable=Path(sys.executable),
        state_file=tmp_path / "state.json",
        log_file=tmp_path / "server.log",
    )
    bad_process = BadCreateProcess()
    monkeypatch.setattr(native_host.subprocess, "Popen", lambda *a, **k: bad_process)
    monkeypatch.setattr(psutil, "Process", lambda _pid: bad_process)
    monkeypatch.setattr(native_host, "_health", lambda _host, _port: None)
    monkeypatch.setattr(native_host, "_port_open", lambda _host, _port: False)

    with pytest.raises(HostRequestError) as exc:
        ServerController(config).start(
            {
                "settings": settings_payload(model),
                "selectedModel": "facebook/nllb-test",
            }
        )
    assert exc.value.code == "server_exited"
    assert not config.state_file.exists()


def test_installer_manifest_and_extension_validation(tmp_path: Path) -> None:
    valid_id = "a" * 32
    assert normalize_extension_id(f"chrome-extension://{valid_id}/") == valid_id
    with pytest.raises(NativeInstallError):
        normalize_extension_id("not-an-extension-id")

    host_path = tmp_path / "native host" / "ct2-native-host.exe"
    manifest = build_native_manifest([valid_id], host_path)
    assert manifest["name"] == native_host.HOST_NAME
    assert manifest["type"] == "stdio"
    assert manifest["path"] == str(host_path.resolve())
    assert manifest["allowed_origins"] == [
        f"chrome-extension://{valid_id}/"
    ]


def test_manifest_supports_several_allowed_extensions(tmp_path: Path) -> None:
    first = "a" * 32
    second = "b" * 32
    host_path = tmp_path / "ct2-native-host"
    manifest = build_native_manifest(
        [f"chrome-extension://{first}/", second, first],
        host_path,
    )
    assert manifest["allowed_origins"] == [
        f"chrome-extension://{first}/",
        f"chrome-extension://{second}/",
    ]


def test_default_extension_id_matches_the_manifest_key() -> None:
    import base64
    import hashlib

    repo_root = Path(__file__).resolve().parents[2]
    manifest = json.loads(
        (repo_root / "public" / "manifest.json").read_text(encoding="utf-8")
    )
    der = base64.b64decode(manifest["key"])
    digest = hashlib.sha256(der).hexdigest()[:32]
    expected = "".join(chr(ord("a") + int(char, 16)) for char in digest)
    assert DEFAULT_EXTENSION_ID == expected


def test_installer_browser_paths_and_windows_registry() -> None:
    assert native_manifest_dir("chrome", "linux") == (
        Path.home()
        / ".config"
        / "google-chrome"
        / "NativeMessagingHosts"
    )
    from ct2_nllb_server.native_install import _windows_registry_path

    assert _windows_registry_path("chrome").startswith(
        r"Software\Google\Chrome\NativeMessagingHosts"
    )
    assert _windows_registry_path("edge").startswith(
        r"Software\Microsoft\Edge\NativeMessagingHosts"
    )


def test_posix_install_writes_launcher_config_and_manifest(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    valid_id = "b" * 32
    root = tmp_path / "native host"
    manifests = tmp_path / "manifests"
    monkeypatch.setattr(
        native_install,
        "native_host_root",
        lambda _platform=None: root,
    )
    monkeypatch.setattr(
        native_install,
        "install_root",
        lambda _platform=None: tmp_path,
    )
    monkeypatch.setattr(
        native_install,
        "models_root",
        lambda _platform=None: tmp_path / "models",
    )
    monkeypatch.setattr(
        native_install,
        "native_manifest_dir",
        lambda _browser, _platform=None: manifests,
    )

    installed = install_native_host(
        valid_id,
        browser="chrome",
        repo_root=Path.cwd(),
        platform_name="linux",
        force=True,
    )
    assert installed.host_path.is_file()
    assert installed.config_path.is_file()
    assert installed.manifest_path.is_file()
    launcher = installed.host_path.read_text(encoding="utf-8")
    assert "CT2_NATIVE_HOST_CONFIG=" in launcher
    assert "ct2_nllb_server.native_host" in launcher
    manifest = json.loads(
        installed.manifest_path.read_text(encoding="utf-8")
    )
    assert manifest["allowed_origins"] == [
        f"chrome-extension://{valid_id}/"
    ]

    installed.host_path.write_text("stale launcher", encoding="utf-8")
    (root / "host-version.txt").write_text("0\n", encoding="utf-8")
    refreshed = install_native_host(
        valid_id,
        browser="chrome",
        repo_root=Path.cwd(),
        platform_name="linux",
        force=False,
    )
    assert "ct2_nllb_server.native_host" in refreshed.host_path.read_text(
        encoding="utf-8"
    )
    assert (root / "host-version.txt").read_text().strip() == str(
        native_host.HOST_VERSION
    )

    removed = uninstall_native_host("chrome", platform_name="linux")
    assert removed == [installed.manifest_path]
    assert not installed.manifest_path.exists()


def test_posix_install_all_browsers_writes_both_manifests(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "native host"
    manifests = tmp_path / "manifests"
    monkeypatch.setattr(
        native_install,
        "native_host_root",
        lambda _platform=None: root,
    )
    monkeypatch.setattr(
        native_install,
        "install_root",
        lambda _platform=None: tmp_path,
    )
    monkeypatch.setattr(
        native_install,
        "models_root",
        lambda _platform=None: tmp_path / "models",
    )
    monkeypatch.setattr(
        native_install,
        "native_manifest_dir",
        lambda browser, _platform=None: manifests / browser,
    )

    installed = install_native_host(
        None,
        browser="all",
        repo_root=Path.cwd(),
        platform_name="linux",
        force=True,
    )
    assert len(installed.manifests) == 2
    assert installed.manifests == [
        manifests / "chrome" / f"{native_host.HOST_NAME}.json",
        manifests / "edge" / f"{native_host.HOST_NAME}.json",
    ]
    for manifest_path in installed.manifests:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert payload["allowed_origins"] == [
            f"chrome-extension://{DEFAULT_EXTENSION_ID}/"
        ]
    assert resolve_browsers("all") == ("chrome", "edge")
    assert resolve_browsers("edge") == ("edge",)
    with pytest.raises(NativeInstallError):
        resolve_browsers("safari")


def test_windows_install_registers_every_browser_with_all_ids(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import types

    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    root = (
        tmp_path / "UniversalSubtitleTranslator" / "native-host"
    )
    store: dict[str, str] = {}

    class FakeKey:
        def __init__(self, path: str):
            self.path = path

        def __enter__(self) -> "FakeKey":
            return self

        def __exit__(self, *exc: object) -> bool:
            return False

    fake_winreg = types.ModuleType("winreg")
    fake_winreg.HKEY_CURRENT_USER = "HKCU"  # type: ignore[attr-defined]
    fake_winreg.REG_SZ = 1  # type: ignore[attr-defined]
    fake_winreg.CreateKey = (  # type: ignore[attr-defined]
        lambda _base, path: FakeKey(path)
    )

    def set_value(key: FakeKey, name: str, _reserved: int, _kind: int, value: str) -> None:
        assert name == ""
        store[key.path] = value

    def open_key(_base, path: str) -> FakeKey:
        if path not in store:
            raise FileNotFoundError(path)
        return FakeKey(path)

    def query_value(key: FakeKey, name: str) -> tuple[str, int]:
        assert name == ""
        return store[key.path], 1

    def delete_key(_base, path: str) -> None:
        if path not in store:
            raise FileNotFoundError(path)
        del store[path]

    fake_winreg.SetValueEx = set_value  # type: ignore[attr-defined]
    fake_winreg.OpenKey = open_key  # type: ignore[attr-defined]
    fake_winreg.QueryValueEx = query_value  # type: ignore[attr-defined]
    fake_winreg.DeleteKey = delete_key  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "winreg", fake_winreg)

    def fake_build(host_path: Path, _repo: Path, *, force: bool) -> None:
        host_path.parent.mkdir(parents=True, exist_ok=True)
        host_path.write_bytes(b"exe")

    monkeypatch.setattr(native_install, "_build_windows_host", fake_build)

    installed = install_native_host(
        ["a" * 32, "b" * 32],
        browser="all",
        repo_root=Path.cwd(),
        platform_name="windows",
        force=True,
    )
    assert installed.host_path.is_file()
    assert installed.manifests == [root / f"{native_host.HOST_NAME}.json"]
    manifest = json.loads(
        installed.manifests[0].read_text(encoding="utf-8")
    )
    assert manifest["allowed_origins"] == [
        f"chrome-extension://{'a' * 32}/",
        f"chrome-extension://{'b' * 32}/",
    ]
    for browser in ("chrome", "edge"):
        key_path = native_install._windows_registry_path(browser)
        assert store[key_path] == str(installed.manifests[0].resolve())

    del store[native_install._windows_registry_path("edge")]
    with pytest.raises(NativeInstallError, match="registry"):
        native_install._verify_windows_registration(
            "edge", installed.manifests[0]
        )

    removed = uninstall_native_host("all", platform_name="windows")
    assert removed == installed.manifests
    assert not installed.manifests[0].exists()
    assert store == {}


def test_posix_install_all_browsers_accepts_multiple_extension_ids(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "native host"
    manifests = tmp_path / "manifests"
    monkeypatch.setattr(
        native_install,
        "native_host_root",
        lambda _platform=None: root,
    )
    monkeypatch.setattr(
        native_install,
        "install_root",
        lambda _platform=None: tmp_path,
    )
    monkeypatch.setattr(
        native_install,
        "models_root",
        lambda _platform=None: tmp_path / "models",
    )
    monkeypatch.setattr(
        native_install,
        "native_manifest_dir",
        lambda browser, _platform=None: manifests / browser,
    )

    first = "a" * 32
    second = "b" * 32
    installed = install_native_host(
        [first, second],
        browser="all",
        repo_root=Path.cwd(),
        platform_name="linux",
        force=True,
    )
    assert len(installed.manifests) == 2
    for manifest_path in installed.manifests:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert payload["allowed_origins"] == [
            f"chrome-extension://{first}/",
            f"chrome-extension://{second}/",
        ]


def test_windows_force_stops_managed_server_before_rebuild(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    calls: list[tuple[str, Path | None]] = []

    monkeypatch.setattr(
        native_install,
        "_stop_managed_before_purge",
        lambda root: calls.append(("stop", root)),
    )

    def fake_build(*_args: object, **_kwargs: object) -> None:
        calls.append(("build", None))
        raise PermissionError("executable is in use")

    monkeypatch.setattr(native_install, "_build_windows_host", fake_build)

    with pytest.raises(NativeInstallError, match="in use"):
        install_native_host(
            None,
            browser="all",
            repo_root=Path.cwd(),
            platform_name="windows",
            force=True,
        )
    assert [name for name, _ in calls] == ["stop", "build"]
    assert calls[0][1] == native_install.native_host_root("windows")


def test_cli_default_repo_root_is_derived_from_the_cli_location(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ct2_nllb_server import cli

    fake_cli = tmp_path / "server" / "src" / "ct2_nllb_server" / "cli.py"
    fake_cli.parent.mkdir(parents=True)
    fake_cli.write_text("", encoding="utf-8")
    (tmp_path / "server").mkdir(exist_ok=True)
    monkeypatch.setattr(cli, "__file__", str(fake_cli))
    assert cli._default_repo_root() == tmp_path.resolve()


def test_purge_stops_managed_server_before_removing_state(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "native host"
    state_dir = root / "state"
    state_dir.mkdir(parents=True)
    state_file = state_dir / "server-state.json"
    state_file.write_text("{}", encoding="utf-8")
    config_path = root / "native-host-config.json"
    config_path.write_text(
        json.dumps(
            {
                "install_root": str(tmp_path),
                "models_root": str(tmp_path / "models"),
                "python_executable": str(Path(sys.executable)),
                "state_file": str(state_file),
                "log_file": str(root / "logs" / "server.log"),
            }
        ),
        encoding="utf-8",
    )
    calls: list[str] = []

    class FakeController:
        def __init__(self, _config):
            pass

        def stop(self):
            calls.append("stop")

    monkeypatch.setattr(
        native_install,
        "native_host_root",
        lambda _platform=None: root,
    )
    monkeypatch.setattr(
        native_install,
        "install_root",
        lambda _platform=None: tmp_path,
    )
    monkeypatch.setattr(
        native_install,
        "models_root",
        lambda _platform=None: tmp_path / "models",
    )
    monkeypatch.setattr(
        native_install,
        "install_root",
        lambda _platform=None: tmp_path,
    )
    monkeypatch.setattr(
        native_install,
        "models_root",
        lambda _platform=None: tmp_path / "models",
    )
    monkeypatch.setattr(
        native_install, "ServerController", FakeController
    )

    remove_installed_files("linux")
    assert calls == ["stop"]
    assert not root.exists()


def test_server_executable_prefers_pythonw_on_windows(tmp_path: Path) -> None:
    python = tmp_path / "python.exe"
    python.write_bytes(b"")
    pythonw = tmp_path / "pythonw.exe"
    pythonw.write_bytes(b"")

    assert (
        native_host.server_executable(python, platform_name="nt") == pythonw
    )
    assert (
        native_host.server_executable(python, platform_name="linux") == python
    )
    pythonw.unlink()
    assert native_host.server_executable(python, platform_name="nt") == python
    other = tmp_path / "python3"
    assert native_host.server_executable(other, platform_name="nt") == other


def test_is_ct2_server_command_accepts_pythonw() -> None:
    assert native_host._is_ct2_server_command(
        [
            r"C:\venv\Scripts\pythonw.exe",
            "-m",
            "ct2_nllb_server",
            "serve",
            "--port",
            "8000",
        ]
    )
    assert not native_host._is_ct2_server_command(
        [r"C:\venv\Scripts\pythonw.exe", "some_other_script.py"]
    )


def test_open_stdio_uses_inherited_handles_when_frozen(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stdin = io.BytesIO()
    stdout = io.BytesIO()
    monkeypatch.setattr(native_host.os, "name", "nt")
    monkeypatch.setattr(native_host.sys, "stdin", None)
    monkeypatch.setattr(native_host.sys, "stdout", None)
    monkeypatch.setattr(
        native_host, "_windows_binary_stdio", lambda: (stdin, stdout)
    )

    assert native_host.open_stdio() == (stdin, stdout)


def test_open_stdio_reports_unavailable_handles(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(native_host.os, "name", "nt")
    monkeypatch.setattr(native_host.sys, "stdin", None)
    monkeypatch.setattr(native_host.sys, "stdout", None)
    monkeypatch.setattr(native_host, "_windows_binary_stdio", lambda: None)

    with pytest.raises(HostRequestError) as exc:
        native_host.open_stdio()
    assert exc.value.code == "stdio_unavailable"


def test_open_stdio_prefers_the_text_wrappers() -> None:
    stdin, stdout = native_host.open_stdio()
    assert stdin is sys.stdin.buffer
    assert stdout is sys.stdout.buffer


def test_log_failure_writes_next_to_the_config(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    log = tmp_path / "logs" / "ct2-host.log"
    monkeypatch.setattr(native_host, "_diagnostic_log_path", lambda: log)

    native_host._log_failure("boom")

    assert "boom" in log.read_text(encoding="utf-8")


def test_write_or_log_survives_a_closed_pipe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logged: list[str] = []

    def broken_write(_payload, _stream):
        raise BrokenPipeError("closed")

    monkeypatch.setattr(native_host, "write_message", broken_write)
    monkeypatch.setattr(native_host, "_log_failure", logged.append)

    native_host._write_or_log({"ok": True}, io.BytesIO())

    assert logged and "closed" in logged[0]
