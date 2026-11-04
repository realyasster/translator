"""Native Messaging host that starts and stops the local CT2 server.

Chrome launches this program only after the user has installed and registered
it. The host validates every launch parameter, starts the server with an
argument list (never a shell), and tracks only the process it created.
"""

from __future__ import annotations

import json
import os
import socket
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO

from .adapters import AdapterError, family_from_metadata
from .model_registry import (
    ModelRegistryError,
    default_models_root,
    resolve_model_directory,
    scan_models,
)

HOST_NAME = "com.realyasster.universal_subtitle_translator.ct2_launcher"
HOST_VERSION = 6
MAX_MESSAGE_BYTES = 1024 * 1024
START_TIMEOUT_SECONDS = 30.0
HEALTH_TIMEOUT_SECONDS = 1.5
PORT_POLL_INTERVAL_SECONDS = 0.25

DEVICES = {"cpu", "cuda"}
HOSTS = {"127.0.0.1", "localhost"}
COMPUTE_TYPES = {
    "default",
    "auto",
    "int8",
    "int8_float32",
    "int8_float16",
    "int8_bfloat16",
    "int16",
    "float16",
    "float32",
    "bfloat16",
}
LOG_LEVELS = {"error", "warning", "info", "debug"}


class HostRequestError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class HostConfig:
    install_root: Path
    models_root: Path
    python_executable: Path
    state_file: Path
    log_file: Path


@dataclass(frozen=True)
class LaunchSettings:
    model_directory: Path
    device: str
    compute_type: str
    host: str
    port: int
    log_level: str
    selected_model: str


def _default_config_path() -> Path:
    configured = os.environ.get("CT2_NATIVE_HOST_CONFIG")
    if configured:
        return Path(configured).expanduser().resolve()
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "native-host-config.json"
    return Path(__file__).resolve().parent / "native-host-config.json"


def _diagnostic_log_path() -> Path:
    configured = os.environ.get("CT2_NATIVE_HOST_LOG")
    if configured:
        return Path(configured).expanduser()
    return _default_config_path().parent / "logs" / "ct2-host.log"


def _log_failure(message: str) -> None:
    """Write diagnostics where a windowed host cannot use stderr."""
    try:
        path = _diagnostic_log_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(
                f"{datetime.now(timezone.utc).isoformat()} {message}\n"
            )
    except OSError:
        pass


def server_executable(
    python_executable: Path, platform_name: str | None = None
) -> Path:
    """Prefer pythonw.exe on Windows so the server never opens a console."""
    executable = Path(python_executable)
    if (platform_name or os.name) != "nt":
        return executable
    if executable.name.lower() == "python.exe":
        pythonw = executable.with_name("pythonw.exe")
        if pythonw.is_file():
            return pythonw
    return executable


def _windows_binary_stdio() -> tuple[BinaryIO, BinaryIO] | None:
    """Open Chrome's inherited stdin/stdout handles from a windowed exe."""
    try:
        import ctypes
        import msvcrt

        kernel32 = ctypes.windll.kernel32
        kernel32.GetStdHandle.argtypes = [ctypes.c_uint32]
        kernel32.GetStdHandle.restype = ctypes.c_void_p
        invalid_handle = ctypes.c_void_p(-1).value
        stdin_handle = kernel32.GetStdHandle(-10)  # STD_INPUT_HANDLE
        stdout_handle = kernel32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
        if (
            not stdin_handle
            or not stdout_handle
            or stdin_handle == invalid_handle
            or stdout_handle == invalid_handle
        ):
            return None
        binary = getattr(os, "O_BINARY", 0)
        stdin_fd = msvcrt.open_osfhandle(
            int(stdin_handle), os.O_RDONLY | binary
        )
        stdout_fd = msvcrt.open_osfhandle(
            int(stdout_handle), os.O_WRONLY | binary
        )
        return (
            os.fdopen(stdin_fd, "rb", buffering=0),
            os.fdopen(stdout_fd, "wb", buffering=0),
        )
    except (AttributeError, ImportError, OSError, ValueError):
        return None


def open_stdio() -> tuple[BinaryIO, BinaryIO]:
    """Return binary stdin/stdout, falling back to raw handles when frozen.

    PyInstaller ``--noconsole`` executables have ``sys.stdin``/``sys.stdout``
    set to None, but Chrome still passes the native-messaging pipes as
    inherited standard handles.
    """
    stdin = getattr(sys.stdin, "buffer", None)
    stdout = getattr(sys.stdout, "buffer", None)
    if stdin is not None and stdout is not None:
        return stdin, stdout
    if os.name == "nt":
        streams = _windows_binary_stdio()
        if streams is not None:
            return streams
    raise HostRequestError(
        "stdio_unavailable",
        "Native messaging standard input/output is unavailable. "
        "Reinstall the native host.",
    )


def _write_or_log(payload: dict[str, Any], stream: BinaryIO) -> None:
    try:
        write_message(payload, stream)
    except (OSError, ValueError) as exc:
        _log_failure(f"Could not write a native message: {exc}")


def load_config(path: Path | None = None) -> HostConfig:
    config_path = path or _default_config_path()
    try:
        payload = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HostRequestError(
            "host_config_missing",
            f"Native host config is unavailable: {config_path} ({exc})",
        ) from exc
    if not isinstance(payload, dict):
        raise HostRequestError(
            "host_config_invalid",
            "Native host config must be a JSON object.",
        )
    try:
        raw_install_root = payload.get("install_root")
        raw_repo_root = payload.get("repo_root")
        raw_models_root = payload.get("models_root")
        if raw_install_root:
            install = Path(str(raw_install_root)).expanduser().resolve()
            models = (
                Path(str(raw_models_root)).expanduser().resolve()
                if raw_models_root
                else install / "models"
            )
        elif raw_repo_root:
            # Legacy format: everything lived in the checkout.
            install = Path(str(raw_repo_root)).expanduser().resolve()
            models = Path(
                str(raw_models_root)
                if raw_models_root
                else install / "server" / "models"
            ).expanduser().resolve()
        else:
            raise KeyError("install_root")
        config = HostConfig(
            install_root=install,
            models_root=models,
            python_executable=Path(
                str(payload["python_executable"])
            ).expanduser().resolve(),
            state_file=Path(str(payload["state_file"])).expanduser().resolve(),
            log_file=Path(str(payload["log_file"])).expanduser().resolve(),
        )
    except KeyError as exc:
        raise HostRequestError(
            "host_config_invalid",
            f"Native host config is missing {exc}.",
        ) from exc
    if not config.install_root.is_dir():
        raise HostRequestError(
            "host_config_invalid",
            f"Configured install root does not exist: {config.install_root}",
        )
    if not config.python_executable.is_file():
        raise HostRequestError(
            "host_config_invalid",
            "Configured Python executable does not exist. Reinstall the native host.",
        )
    return config


def read_message(stream: BinaryIO) -> dict[str, Any] | None:
    raw_length = stream.read(4)
    if not raw_length:
        return None
    if len(raw_length) != 4:
        raise HostRequestError("protocol_error", "Truncated native message.")
    (length,) = struct.unpack("@I", raw_length)
    if length <= 0 or length > MAX_MESSAGE_BYTES:
        raise HostRequestError("protocol_error", "Invalid native message length.")
    raw_payload = stream.read(length)
    if len(raw_payload) != length:
        raise HostRequestError("protocol_error", "Truncated native message body.")
    try:
        payload = json.loads(raw_payload.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise HostRequestError("protocol_error", "Invalid JSON message.") from exc
    if not isinstance(payload, dict):
        raise HostRequestError("protocol_error", "Message must be a JSON object.")
    return payload


def write_message(payload: dict[str, Any], stream: BinaryIO) -> None:
    encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    if len(encoded) > MAX_MESSAGE_BYTES:
        encoded = json.dumps(
            {
                "ok": False,
                "action": payload.get("action"),
                "code": "response_too_large",
                "message": "Native response exceeded the message limit.",
            }
        ).encode("utf-8")
    stream.write(struct.pack("@I", len(encoded)))
    stream.write(encoded)
    stream.flush()


def _safe_text(value: Any, field: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        raise HostRequestError("invalid_settings", f"{field} must be a string.")
    if not allow_empty and value.strip() == "":
        raise HostRequestError("invalid_settings", f"{field} is required.")
    if any(char in value for char in ("\0", "\r", "\n")):
        raise HostRequestError(
            "invalid_settings",
            f"{field} cannot contain NUL or newline characters.",
        )
    if value.startswith("-"):
        raise HostRequestError(
            "invalid_settings",
            f"{field} cannot start with '-'.",
        )
    return value


def _normalize_port(value: Any) -> int:
    if isinstance(value, bool):
        raise HostRequestError("invalid_settings", "port must be an integer.")
    if isinstance(value, int):
        port = value
    elif (
        isinstance(value, str)
        and value.strip().isascii()
        and value.strip().isdigit()
    ):
        port = int(value.strip())
    else:
        raise HostRequestError("invalid_settings", "port must be an integer.")
    if port < 1 or port > 65535:
        raise HostRequestError(
            "invalid_settings", "port must be between 1 and 65535."
        )
    return port


def validate_settings(
    payload: Any,
    selected_model_value: Any | None = None,
    models_root: str | Path | None = None,
) -> LaunchSettings:
    if not isinstance(payload, dict):
        raise HostRequestError("invalid_settings", "settings must be an object.")
    selected_model = _safe_text(
        selected_model_value
        if selected_model_value is not None
        else payload.get("selectedModel"),
        "selectedModel",
    )
    raw_model_dir = _safe_text(
        payload.get("modelDirectory", ""),
        "modelDirectory",
        allow_empty=True,
    )
    models_path = Path(
        models_root
        if models_root is not None
        else default_models_root()
    ).expanduser().resolve()
    try:
        model_dir = resolve_model_directory(
            models_path,
            raw_model_dir,
            selected_model,
        )
    except ModelRegistryError as exc:
        raise HostRequestError(exc.code, exc.message) from exc

    metadata_path = model_dir / "model-metadata.json"
    if not metadata_path.is_file():
        raise HostRequestError(
            "model_not_prepared",
            f"model-metadata.json was not found in {model_dir}.",
        )
    if not (model_dir / "tokenizer").is_dir():
        raise HostRequestError(
            "model_not_prepared",
            f"Tokenizer directory was not found in {model_dir}.",
        )
    if not (model_dir / "model.bin").is_file():
        raise HostRequestError(
            "model_not_prepared",
            f"model.bin was not found in {model_dir}.",
        )
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise HostRequestError(
            "model_not_prepared", f"Model metadata is unreadable: {exc}"
        ) from exc
    if not isinstance(metadata, dict):
        raise HostRequestError(
            "model_not_prepared",
            "The selected folder does not contain a supported model.",
        )
    try:
        family_from_metadata(metadata)
    except AdapterError as exc:
        raise HostRequestError(
            "model_not_prepared",
            f"The selected folder does not contain a supported model: {exc}",
        ) from exc

    metadata_model = metadata.get("model_id")
    if metadata_model != selected_model:
        raise HostRequestError(
            "model_mismatch",
            f"Model folder contains '{metadata_model}', but the selected "
            f"provider model is '{selected_model}'.",
        )

    device = payload.get("device")
    if device not in DEVICES:
        raise HostRequestError(
            "invalid_settings", "device must be cpu or cuda."
        )
    compute_type = payload.get("computeType")
    if compute_type not in COMPUTE_TYPES:
        raise HostRequestError(
            "invalid_settings", "computeType is not supported by the CLI."
        )
    host = payload.get("host")
    if host not in HOSTS:
        raise HostRequestError(
            "invalid_settings", "host must be 127.0.0.1 or localhost."
        )
    log_level = payload.get("logLevel")
    if log_level not in LOG_LEVELS:
        raise HostRequestError(
            "invalid_settings", "logLevel is not supported."
        )
    port = _normalize_port(payload.get("port"))
    return LaunchSettings(
        model_directory=model_dir,
        device=str(device),
        compute_type=str(compute_type),
        host=str(host),
        port=port,
        log_level=str(log_level),
        selected_model=selected_model,
    )


def _read_state(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def _write_state(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def _clear_state(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def _tail_file(path: Path, max_chars: int = 3000) -> str:
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    return content[-max_chars:]


def _health(host: str, port: int) -> dict[str, Any] | None:
    url = f"http://{host}:{port}/health"
    try:
        with urllib.request.urlopen(url, timeout=HEALTH_TIMEOUT_SECONDS) as response:
            if response.status != 200:
                return None
            payload = json.loads(response.read().decode("utf-8"))
    except (OSError, ValueError, urllib.error.URLError):
        return None
    if not isinstance(payload, dict) or payload.get("status") != "ready":
        return None
    return payload


def _port_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.6):
            return True
    except OSError:
        return False


def _has_managed_command(cmdline: list[str]) -> bool:
    tokens = ["-m", "ct2_nllb_server", "serve"]
    return any(
        cmdline[index : index + len(tokens)] == tokens
        for index in range(max(0, len(cmdline) - len(tokens) + 1))
    )


def _is_ct2_server_command(cmdline: list[str]) -> bool:
    if _has_managed_command(cmdline):
        return True
    for index in range(max(0, len(cmdline) - 1)):
        executable = Path(cmdline[index]).name.lower()
        if (
            executable in {"ct2-nllb-server", "ct2-nllb-server.exe"}
            and cmdline[index + 1] == "serve"
        ):
            return True
    return False


def _host_port_from_settings(
    settings_payload: Any | None,
) -> tuple[str, int]:
    host = "127.0.0.1"
    port = 8000
    if isinstance(settings_payload, dict):
        candidate_host = settings_payload.get("host")
        if candidate_host in HOSTS:
            host = str(candidate_host)
        try:
            port = _normalize_port(settings_payload.get("port", port))
        except HostRequestError:
            pass
    return host, port


def _parse_netstat_listening_pids(output: str, port: int) -> set[int]:
    pids: set[int] = set()
    for line in output.splitlines():
        parts = line.split()
        if len(parts) < 5 or parts[0].upper() != "TCP":
            continue
        if parts[3].upper() != "LISTENING":
            continue
        local_address = parts[1]
        try:
            local_port = int(local_address.rsplit(":", 1)[-1])
        except (ValueError, IndexError):
            continue
        if local_port != port:
            continue
        try:
            pids.add(int(parts[4]))
        except ValueError:
            continue
    return pids


def _listening_pids(port: int) -> set[int]:
    import psutil

    pids: set[int] = set()
    try:
        for connection in psutil.net_connections(kind="inet"):
            address = getattr(connection, "laddr", None)
            if (
                address is not None
                and getattr(address, "port", None) == port
                and getattr(connection, "status", None) == psutil.CONN_LISTEN
                and connection.pid is not None
            ):
                pids.add(int(connection.pid))
    except (psutil.Error, OSError):
        pass
    if pids:
        return pids

    if os.name == "nt":
        try:
            completed = subprocess.run(
                ["netstat", "-ano", "-p", "TCP"],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            return _parse_netstat_listening_pids(completed.stdout, port)
        except (OSError, subprocess.SubprocessError):
            return set()

    for command in (
        ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
    ):
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if completed.returncode != 0:
            continue
        for line in completed.stdout.splitlines():
            try:
                pids.add(int(line.strip()))
            except ValueError:
                continue
        if pids:
            return pids
    return pids


def _ct2_processes_on_port(port: int) -> list[Any]:
    import psutil

    processes: list[Any] = []
    for pid in _listening_pids(port):
        try:
            process = psutil.Process(pid)
            if _is_ct2_server_command(process.cmdline()):
                processes.append(process)
        except (psutil.Error, OSError):
            continue
    return processes


def _state_matches_settings(
    state: dict[str, Any], settings: LaunchSettings
) -> bool:
    try:
        stored_model = Path(str(state["model_directory"])).expanduser().resolve()
        return (
            stored_model == settings.model_directory
            and state.get("selected_model") == settings.selected_model
            and state.get("device") == settings.device
            and state.get("compute_type") == settings.compute_type
            and state.get("host") == settings.host
            and int(state.get("port", 0)) == settings.port
            and state.get("log_level") == settings.log_level
        )
    except (KeyError, TypeError, ValueError):
        return False


class ServerController:
    def __init__(self, config: HostConfig):
        self.config = config

    def _managed_process(self):
        import psutil

        state = _read_state(self.config.state_file)
        if not state:
            return None
        try:
            pid = int(state["pid"])
            expected_create_time = float(state["create_time"])
        except (KeyError, TypeError, ValueError):
            _clear_state(self.config.state_file)
            return None
        try:
            process = psutil.Process(pid)
            if abs(process.create_time() - expected_create_time) > 1.0:
                _clear_state(self.config.state_file)
                return None
            cmdline = process.cmdline()
        except (psutil.Error, OSError):
            _clear_state(self.config.state_file)
            return None
        if not _has_managed_command(cmdline):
            _clear_state(self.config.state_file)
            return None
        return process, state

    def _status_payload(
        self,
        state: str,
        managed: bool,
        pid: int | None = None,
        health: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "ok": True,
            "action": "status",
            "hostVersion": HOST_VERSION,
            "state": state,
            "managed": managed,
        }
        if pid is not None:
            payload["pid"] = pid
        if health is not None:
            payload["health"] = health
        return payload

    def status(self, settings_payload: Any | None = None) -> dict[str, Any]:
        managed_process = self._managed_process()
        if managed_process:
            process, state = managed_process
            health = _health(
                str(state.get("host", "127.0.0.1")),
                int(state.get("port", 8000)),
            )
            return self._status_payload(
                "running", True, process.pid, health
            )

        host, port = _host_port_from_settings(settings_payload)
        health = _health(host, port)
        if health is not None:
            return self._status_payload(
                "external_running", False, None, health
            )
        return self._status_payload("stopped", False)

    def list_models(self) -> dict[str, Any]:
        models = scan_models(self.config.models_root)
        return {
            "ok": True,
            "action": "list_models",
            "modelsRoot": str(self.config.models_root),
            "models": models,
        }

    def start(self, request: dict[str, Any]) -> dict[str, Any]:
        import psutil

        settings = validate_settings(
            request.get("settings"),
            request.get("selectedModel"),
            self.config.models_root,
        )
        managed = self._managed_process()
        if managed:
            process, state = managed
            if _state_matches_settings(state, settings):
                health = _health(settings.host, settings.port)
                return self._status_payload(
                    "running", True, process.pid, health
                ) | {"action": "start"}
            raise HostRequestError(
                "already_running_with_different_settings",
                "A managed CT2 server is already running with different "
                "startup settings. Stop it before starting another one.",
            )

        health = _health(settings.host, settings.port)
        if health is not None:
            return self._status_payload(
                "external_running", False, None, health
            ) | {"action": "start"}
        if _port_open(settings.host, settings.port):
            raise HostRequestError(
                "port_in_use",
                f"{settings.host}:{settings.port} is already in use.",
            )

        self.config.log_file.parent.mkdir(parents=True, exist_ok=True)
        log_handle = open(
            self.config.log_file, "a", encoding="utf-8", buffering=1
        )
        env = os.environ.copy()
        env.update(
            {
                "HF_HUB_OFFLINE": "1",
                "TRANSFORMERS_OFFLINE": "1",
                "PYTHONUNBUFFERED": "1",
                "CT2_NLLB_MANAGED": "1",
            }
        )
        command = [
            str(server_executable(self.config.python_executable)),
            "-m",
            "ct2_nllb_server",
            "serve",
            "--model-dir",
            str(settings.model_directory),
            "--host",
            settings.host,
            "--port",
            str(settings.port),
            "--device",
            settings.device,
            "--compute-type",
            settings.compute_type,
            "--log-level",
            settings.log_level,
        ]
        kwargs: dict[str, Any] = {
            "cwd": str(self.config.install_root),
            "env": env,
            "stdin": subprocess.DEVNULL,
            "stdout": log_handle,
            "stderr": subprocess.STDOUT,
        }
        if os.name == "nt":
            # CREATE_NO_WINDOW hides the console; it must not be combined with
            # DETACHED_PROCESS. SW_HIDE covers hosts that still attach one.
            kwargs["creationflags"] = (
                subprocess.CREATE_NO_WINDOW
                | subprocess.CREATE_NEW_PROCESS_GROUP
            )
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = subprocess.SW_HIDE
            kwargs["startupinfo"] = startupinfo
        else:
            kwargs["start_new_session"] = True
        try:
            process = subprocess.Popen(command, **kwargs)
        except OSError as exc:
            log_handle.close()
            raise HostRequestError(
                "start_failed", f"Could not start the CT2 server: {exc}"
            ) from exc
        finally:
            log_handle.close()

        try:
            managed_process = psutil.Process(process.pid)
            create_time = managed_process.create_time()
        except psutil.NoSuchProcess as exc:
            _clear_state(self.config.state_file)
            tail = _tail_file(self.config.log_file)
            raise HostRequestError(
                "server_exited",
                f"The CT2 server exited immediately. {tail[-1200:]}",
            ) from exc
        except (psutil.Error, OSError) as exc:
            _clear_state(self.config.state_file)
            self._terminate_pid(process.pid)
            raise HostRequestError(
                "start_failed",
                f"Could not inspect the CT2 server process: {exc}",
            ) from exc

        state = {
            "pid": process.pid,
            "create_time": create_time,
            "host": settings.host,
            "port": settings.port,
            "model_directory": str(settings.model_directory),
            "selected_model": settings.selected_model,
            "device": settings.device,
            "compute_type": settings.compute_type,
            "log_level": settings.log_level,
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            _write_state(self.config.state_file, state)
        except OSError as exc:
            self._terminate_pid(process.pid)
            _clear_state(self.config.state_file)
            raise HostRequestError(
                "start_failed",
                f"Could not persist native host state: {exc}",
            ) from exc

        deadline = time.monotonic() + START_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            exit_code = process.poll()
            if exit_code is not None:
                _clear_state(self.config.state_file)
                tail = _tail_file(self.config.log_file)
                raise HostRequestError(
                    "server_exited",
                    f"The CT2 server exited with code {exit_code}. {tail[-1200:]}",
                )
            try:
                current_process = psutil.Process(process.pid)
                if abs(current_process.create_time() - create_time) > 1.0:
                    raise psutil.NoSuchProcess(process.pid)
            except (psutil.Error, OSError) as exc:
                _clear_state(self.config.state_file)
                tail = _tail_file(self.config.log_file)
                raise HostRequestError(
                    "server_exited",
                    f"The CT2 server process is no longer available. "
                    f"{tail[-1200:]}",
                ) from exc
            health = _health(settings.host, settings.port)
            if health is not None:
                return self._status_payload(
                    "running", True, process.pid, health
                ) | {"action": "start"}
            time.sleep(PORT_POLL_INTERVAL_SECONDS)

        self._terminate_pid(process.pid)
        _clear_state(self.config.state_file)
        tail = _tail_file(self.config.log_file)
        raise HostRequestError(
            "start_timeout",
            f"CT2 server did not become ready within {int(START_TIMEOUT_SECONDS)}s. "
            f"{tail[-1200:]}",
        )

    def _terminate_pid(self, pid: int) -> None:
        import psutil

        try:
            process = psutil.Process(pid)
        except psutil.Error:
            return
        children = []
        try:
            children = process.children(recursive=True)
        except psutil.Error:
            pass
        for child in children:
            try:
                child.terminate()
            except psutil.Error:
                pass
        try:
            process.terminate()
        except psutil.Error:
            pass
        _gone, alive = psutil.wait_procs(
            [process, *children], timeout=5.0
        )
        for item in alive:
            try:
                item.kill()
            except psutil.Error:
                pass

    def stop(self, settings_payload: Any | None = None) -> dict[str, Any]:
        managed = self._managed_process()
        if managed:
            process, _state = managed
            self._terminate_pid(process.pid)
            _clear_state(self.config.state_file)
            return {
                "ok": True,
                "action": "stop",
                "hostVersion": HOST_VERSION,
                "state": "stopped",
                "managed": False,
            }

        host, port = _host_port_from_settings(settings_payload)
        if _health(host, port) is None:
            raise HostRequestError(
                "not_managed",
                f"No running CT2 server was found at {host}:{port}.",
            )
        processes = _ct2_processes_on_port(port)
        if not processes:
            raise HostRequestError(
                "external_not_ct2",
                f"A server is running at {host}:{port}, but it is not a "
                "recognized CT2 server process.",
            )
        for process in processes:
            self._terminate_pid(process.pid)
        _clear_state(self.config.state_file)
        return {
            "ok": True,
            "action": "stop",
            "hostVersion": HOST_VERSION,
            "state": "stopped",
            "managed": False,
            "external": True,
        }


def handle_request(
    request: dict[str, Any], config: HostConfig
) -> dict[str, Any]:
    action = request.get("action")
    controller = ServerController(config)
    if action == "ping":
        return {
            "ok": True,
            "action": "ping",
            "hostVersion": HOST_VERSION,
            "modelsRoot": str(config.models_root),
        }
    if action == "status":
        return controller.status(request.get("settings"))
    if action == "list_models":
        return controller.list_models()
    if action == "start":
        return controller.start(request)
    if action == "stop":
        return controller.stop(request.get("settings"))
    raise HostRequestError(
        "unknown_action",
        f"Unknown native host action: {action!r}.",
    )


def main() -> None:
    try:
        stdin, stdout = open_stdio()
    except HostRequestError as exc:
        _log_failure(f"Native host stdio unavailable: {exc.message}")
        return
    try:
        config = load_config()
    except HostRequestError as exc:
        _write_or_log(
            {
                "ok": False,
                "action": None,
                "code": exc.code,
                "message": exc.message,
            },
            stdout,
        )
        return
    try:
        request = read_message(stdin)
        if request is None:
            return
        response = handle_request(request, config)
    except HostRequestError as exc:
        response = {
            "ok": False,
            "action": None,
            "code": exc.code,
            "message": exc.message,
        }
    except Exception as exc:  # pragma: no cover - defensive boundary
        response = {
            "ok": False,
            "action": None,
            "code": "host_error",
            "message": f"Native host error: {exc}",
        }
    _write_or_log(response, stdout)


if __name__ == "__main__":
    main()
