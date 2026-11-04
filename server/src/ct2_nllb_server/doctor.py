"""Report the state of the one-click installation.

The installer reads this report to skip steps that are already complete and
re-run only what is missing. Nothing here starts or stops the server.
"""

from __future__ import annotations

import json
import platform as platform_module
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .native_host import HOST_NAME, HOST_VERSION
from .native_install import BROWSERS, WINDOWS_REGISTRY_BASES, host_executable_path
from .model_registry import scan_models
from .paths import install_root as default_install_root
from .paths import platform_name

INSTALL_STATE_FILE = "install-state.json"
PACKAGE_NAME = "ct2-nllb-server"

MINIMUM_PYTHON = (3, 11)


def install_state_path(install_root: str | Path) -> Path:
    return Path(install_root) / INSTALL_STATE_FILE


def read_install_state(install_root: str | Path) -> dict[str, Any] | None:
    path = install_state_path(install_root)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def server_version() -> str | None:
    from importlib.metadata import PackageNotFoundError, version

    try:
        return version(PACKAGE_NAME)
    except PackageNotFoundError:
        return None


def write_install_state(
    ref: str, install_root: str | Path | None = None
) -> dict[str, Any]:
    root = Path(
        install_root if install_root is not None else default_install_root()
    ).expanduser().resolve()
    payload: dict[str, Any] = {
        "ref": str(ref),
        "serverVersion": server_version(),
        "hostVersion": HOST_VERSION,
        "installedAt": datetime.now(timezone.utc).isoformat(),
    }
    path = install_state_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return payload


def _read_host_version(version_path: Path) -> int | None:
    try:
        return int(version_path.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None


def host_status(
    install: str | Path, platform: str | None = None
) -> dict[str, Any]:
    root = Path(install) / "native-host"
    executable = host_executable_path(root, platform)
    version = _read_host_version(root / "host-version.txt")
    exists = executable.is_file()
    return {
        "path": str(executable),
        "exists": exists,
        "version": version,
        "expectedVersion": HOST_VERSION,
        "upToDate": exists and version == HOST_VERSION,
    }


def registered_browsers(platform: str | None = None) -> dict[str, bool]:
    platform_value = platform_name(platform)
    status = {browser: False for browser in BROWSERS}
    if platform_value == "windows":
        import winreg

        for browser in BROWSERS:
            key_path = f"{WINDOWS_REGISTRY_BASES[browser]}\\{HOST_NAME}"
            try:
                with winreg.OpenKey(
                    winreg.HKEY_CURRENT_USER, key_path
                ) as key:
                    value, _ = winreg.QueryValueEx(key, "")
                status[browser] = bool(str(value).strip())
            except OSError:
                status[browser] = False
        return status

    from .native_install import native_manifest_dir

    for browser in BROWSERS:
        directory = native_manifest_dir(browser, platform_value)
        status[browser] = bool(
            directory and (directory / f"{HOST_NAME}.json").is_file()
        )
    return status


def python_status() -> dict[str, Any]:
    version = tuple(sys.version_info[:2])
    return {
        "executable": str(Path(sys.executable).resolve()),
        "version": platform_module.python_version(),
        "meetsRequirement": version >= MINIMUM_PYTHON,
    }


def collect_report(
    install_root: str | Path | None = None,
    platform: str | None = None,
) -> dict[str, Any]:
    platform_value = platform_name(platform)
    root = Path(
        install_root
        if install_root is not None
        else default_install_root(platform_value)
    ).expanduser().resolve()
    models_path = root / "models"
    models = scan_models(models_path)
    return {
        "installRoot": str(root),
        "platform": platform_value,
        "python": python_status(),
        "serverVersion": server_version(),
        "hostVersion": HOST_VERSION,
        "installState": read_install_state(root),
        "host": host_status(root, platform_value),
        "browsers": registered_browsers(platform_value),
        "models": {
            "root": str(models_path),
            "ready": sum(1 for model in models if model["valid"]),
            "total": len(models),
            "models": models,
        },
    }


def format_report(report: dict[str, Any]) -> str:
    python = report["python"]
    host = report["host"]
    browsers = ", ".join(
        f"{browser}={'yes' if registered else 'no'}"
        for browser, registered in report["browsers"].items()
    )
    state = report["installState"] or {}
    models = report["models"]
    lines = [
        f"Install root:    {report['installRoot']}",
        f"Python:          {python['version']} ({python['executable']})",
        f"Server package:  {report['serverVersion'] or 'not installed'}",
        f"Install ref:     {state.get('ref') or '-'}",
        (
            f"Native host:     {host['path']} "
            f"(version {host['version'] or '-'}, expected "
            f"{host['expectedVersion']})"
        ),
        f"Browsers:        {browsers}",
        f"Models:          {models['ready']}/{models['total']} ready in {models['root']}",
    ]
    return "\n".join(lines)
