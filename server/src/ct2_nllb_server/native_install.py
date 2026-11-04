"""Install and uninstall the native messaging host used by the extension."""

from __future__ import annotations

import json
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from .native_host import (
    HOST_NAME,
    HOST_VERSION,
    HostConfig,
    HostRequestError,
    ServerController,
    load_config,
)
from .paths import (
    install_root,
    models_root,
    native_host_root,
    platform_name as _platform_name,
    venv_python,
)

EXTENSION_ID_PATTERN = re.compile(r"^[a-p]{32}$")
# Derived from the "key" in public/manifest.json. Keep both in sync; the
# installer and the extension rely on this stable Chromium extension ID.
DEFAULT_EXTENSION_ID = "jjpnokgnapgibbacgponlpkeejlcffgh"
BROWSERS = ("chrome", "edge")
BROWSER_CHOICES = (*BROWSERS, "all")

WINDOWS_REGISTRY_BASES = {
    "chrome": r"Software\Google\Chrome\NativeMessagingHosts",
    "edge": r"Software\Microsoft\Edge\NativeMessagingHosts",
}


class NativeInstallError(RuntimeError):
    """The native messaging host could not be installed."""


@dataclass(frozen=True)
class InstalledPaths:
    host_path: Path
    config_path: Path
    manifest_path: Path
    manifests: list[Path]
    state_file: Path
    log_file: Path


def normalize_extension_id(value: str) -> str:
    extension_id = (value or "").strip()
    for prefix in ("chrome-extension://", "chrome-extension:"):
        if extension_id.startswith(prefix):
            extension_id = extension_id[len(prefix) :]
            break
    extension_id = extension_id.rstrip("/")
    if not EXTENSION_ID_PATTERN.fullmatch(extension_id):
        raise NativeInstallError(
            "Extension ID must be 32 characters in the range a-p."
        )
    return extension_id


def normalize_extension_ids(values: list[str] | tuple[str, ...]) -> list[str]:
    extension_ids: list[str] = []
    for value in values:
        extension_id = normalize_extension_id(value)
        if extension_id not in extension_ids:
            extension_ids.append(extension_id)
    if not extension_ids:
        raise NativeInstallError("At least one extension ID is required.")
    return extension_ids


def resolve_browsers(browser: str) -> tuple[str, ...]:
    if browser == "all":
        return BROWSERS
    if browser not in BROWSERS:
        raise NativeInstallError(f"Unsupported browser: {browser}")
    return (browser,)


def host_executable_path(root: Path, platform_name: str | None = None) -> Path:
    if _platform_name(platform_name) == "windows":
        return root / "ct2-native-host.exe"
    return root / "ct2-native-host"


def native_manifest_dir(
    browser: str, platform_name: str | None = None
) -> Path | None:
    if browser not in BROWSERS:
        raise NativeInstallError(f"Unsupported browser: {browser}")
    platform = _platform_name(platform_name)
    if platform == "windows":
        return None
    if platform == "macos":
        base = Path.home() / "Library" / "Application Support"
        return base / (
            "Google/Chrome/NativeMessagingHosts"
            if browser == "chrome"
            else "Microsoft Edge/NativeMessagingHosts"
        )
    return (
        Path.home()
        / ".config"
        / ("google-chrome" if browser == "chrome" else "microsoft-edge")
        / "NativeMessagingHosts"
    )


def build_native_manifest(
    extension_ids: list[str] | tuple[str, ...], host_path: Path
) -> dict[str, object]:
    return {
        "name": HOST_NAME,
        "description": (
            "Universal Subtitle Translator CTranslate2 launcher "
            f"(v{HOST_VERSION})"
        ),
        "path": str(host_path.resolve()),
        "type": "stdio",
        "allowed_origins": [
            f"chrome-extension://{extension_id}/"
            for extension_id in normalize_extension_ids(extension_ids)
        ],
    }


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _build_windows_host(
    host_path: Path,
    repo_root: Path,
    *,
    force: bool,
) -> None:
    if host_path.is_file() and not force:
        return
    entry = repo_root / "server" / "native_host_entry.py"
    if not entry.is_file():
        raise NativeInstallError(f"Native host entrypoint not found: {entry}")
    try:
        import PyInstaller  # noqa: F401
    except Exception as exc:
        raise NativeInstallError(
            "PyInstaller is not installed. Install the native extra first: "
            'python -m pip install -e ".\\server[native]"'
        ) from exc

    host_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=".native-host-build-", dir=str(host_path.parent)
    ) as temporary:
        work = Path(temporary) / "work"
        spec = Path(temporary) / "spec"
        command = [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--onefile",
            "--noconsole",
            "--name",
            "ct2-native-host",
            "--distpath",
            str(host_path.parent),
            "--workpath",
            str(work),
            "--specpath",
            str(spec),
            "--paths",
            str(repo_root / "server" / "src"),
            str(entry),
        ]
        completed = subprocess.run(
            command,
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            timeout=300,
        )
        if completed.returncode != 0:
            output = (completed.stdout + "\n" + completed.stderr)[-3000:]
            lowered = output.lower()
            if any(
                marker in lowered
                for marker in (
                    "permissionerror",
                    "access is denied",
                    "winerror 5",
                    "errno 13",
                )
            ):
                raise NativeInstallError(
                    "The native host executable is in use. Close the browser, "
                    "stop the CT2 server and run the installer again."
                )
            raise NativeInstallError(
                f"PyInstaller failed with exit code {completed.returncode}:\n"
                f"{output}"
            )
    if not host_path.is_file():
        raise NativeInstallError(
            f"PyInstaller did not create the expected executable: {host_path}"
        )


def _write_posix_launcher(
    host_path: Path,
    config_path: Path,
    *,
    force: bool,
) -> None:
    if host_path.is_file() and not force:
        return
    host_path.parent.mkdir(parents=True, exist_ok=True)
    script = (
        "#!/bin/sh\n"
        f"CT2_NATIVE_HOST_CONFIG={shlex.quote(str(config_path))} "
        f"exec {shlex.quote(sys.executable)} -m ct2_nllb_server.native_host\n"
    )
    host_path.write_text(script, encoding="utf-8")
    host_path.chmod(
        host_path.stat().st_mode
        | stat.S_IXUSR
        | stat.S_IXGRP
        | stat.S_IXOTH
    )


def _windows_registry_path(browser: str) -> str:
    return f"{WINDOWS_REGISTRY_BASES[browser]}\\{HOST_NAME}"


def _register_windows(browser: str, manifest_path: Path) -> None:
    import winreg

    key_path = _windows_registry_path(browser)
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path) as key:
        winreg.SetValueEx(
            key,
            "",
            0,
            winreg.REG_SZ,
            str(manifest_path.resolve()),
        )


def _unregister_windows(browser: str) -> None:
    import winreg

    try:
        winreg.DeleteKey(
            winreg.HKEY_CURRENT_USER,
            _windows_registry_path(browser),
        )
    except FileNotFoundError:
        pass


def _host_version_matches(version_path: Path) -> bool:
    try:
        return version_path.read_text(encoding="utf-8").strip() == str(
            HOST_VERSION
        )
    except OSError:
        return False


def _write_host_version(version_path: Path) -> None:
    version_path.parent.mkdir(parents=True, exist_ok=True)
    version_path.write_text(f"{HOST_VERSION}\n", encoding="utf-8")


def _verify_windows_registration(
    browser: str, manifest_path: Path
) -> None:
    import winreg

    key_path = _windows_registry_path(browser)
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path) as key:
            value, _ = winreg.QueryValueEx(key, "")
    except OSError as exc:
        raise NativeInstallError(
            f"Native host registry entry is missing for {browser}: "
            f"HKCU\\{key_path}"
        ) from exc
    registered = Path(str(value)).resolve()
    if registered != manifest_path.resolve():
        raise NativeInstallError(
            f"Native host registry entry for {browser} points to "
            f"{registered}, expected {manifest_path.resolve()}."
        )


def _verify_installation(
    host_path: Path,
    manifests: list[Path],
    browsers: tuple[str, ...],
    platform: str,
) -> None:
    if not host_path.is_file():
        raise NativeInstallError(
            f"Native host executable is missing after install: {host_path}"
        )
    for manifest_path in manifests:
        if not manifest_path.is_file():
            raise NativeInstallError(
                f"Native host manifest is missing after install: {manifest_path}"
            )
    if platform == "windows":
        for browser in browsers:
            _verify_windows_registration(browser, manifests[0])


def install_native_host(
    extension_ids: str | list[str] | tuple[str, ...] | None = None,
    browser: str = "all",
    repo_root: str | Path | None = None,
    *,
    force: bool = False,
    force_if_outdated: bool = False,
    platform_name: str | None = None,
) -> InstalledPaths:
    if extension_ids is None:
        ids = [DEFAULT_EXTENSION_ID]
    elif isinstance(extension_ids, str):
        ids = [extension_ids]
    else:
        ids = list(extension_ids)
    normalized_ids = normalize_extension_ids(ids)
    browsers = resolve_browsers(browser)
    root = native_host_root(platform_name)
    platform = _platform_name(platform_name)
    repo = Path(repo_root or Path.cwd()).expanduser().resolve()
    if not (repo / "server").is_dir():
        raise NativeInstallError(
            f"Repository root does not contain server/: {repo}"
        )
    host_path = host_executable_path(root, platform)
    version_path = root / "host-version.txt"
    config_path = root / "native-host-config.json"
    state_file = root / "state" / "server-state.json"
    log_file = root / "logs" / "ct2-server.log"
    root.mkdir(parents=True, exist_ok=True)
    version_mismatch = not _host_version_matches(version_path)
    refresh_host = force or not host_path.is_file() or version_mismatch
    if force_if_outdated and version_mismatch:
        refresh_host = True

    if platform == "windows":
        if refresh_host:
            # A running host/server may still hold the executable; stop the
            # managed server before PyInstaller replaces the file.
            _stop_managed_before_purge(root)
        try:
            _build_windows_host(host_path, repo, force=refresh_host)
        except PermissionError as exc:
            raise NativeInstallError(
                "The native host executable is in use. Close the browser and "
                "stop the CT2 server, then run the installer again."
            ) from exc

    install = install_root(platform)
    models = models_root(platform)
    models.mkdir(parents=True, exist_ok=True)
    configured_python = venv_python(platform)
    if not configured_python.is_file():
        configured_python = Path(sys.executable).resolve()
    config_path.parent.mkdir(parents=True, exist_ok=True)
    _write_json(
        config_path,
        {
            "install_root": str(install),
            "models_root": str(models),
            "python_executable": str(configured_python),
            "state_file": str(state_file),
            "log_file": str(log_file),
        },
    )

    if platform == "windows":
        manifests = [root / f"{HOST_NAME}.json"]
    else:
        _write_posix_launcher(host_path, config_path, force=refresh_host)
        manifests = []
        for target_browser in browsers:
            manifest_dir = native_manifest_dir(target_browser, platform)
            if manifest_dir is None:
                raise NativeInstallError(
                    "No native manifest directory for platform."
                )
            manifests.append(manifest_dir / f"{HOST_NAME}.json")

    manifest = build_native_manifest(normalized_ids, host_path)
    for manifest_path in manifests:
        _write_json(manifest_path, manifest)
    if platform == "windows":
        for target_browser in browsers:
            _register_windows(target_browser, manifests[0])

    _write_host_version(version_path)
    _verify_installation(host_path, manifests, browsers, platform)

    return InstalledPaths(
        host_path=host_path,
        config_path=config_path,
        manifest_path=manifests[0],
        manifests=manifests,
        state_file=state_file,
        log_file=log_file,
    )


def uninstall_native_host(
    browser: str = "all",
    *,
    platform_name: str | None = None,
) -> list[Path | None]:
    browsers = resolve_browsers(browser)
    platform = _platform_name(platform_name)
    removed: list[Path | None] = []
    if platform == "windows":
        manifest_path = native_host_root(platform) / f"{HOST_NAME}.json"
        for target_browser in browsers:
            _unregister_windows(target_browser)
        try:
            manifest_path.unlink()
        except FileNotFoundError:
            pass
        removed.append(manifest_path)
        return removed
    for target_browser in browsers:
        manifest_dir = native_manifest_dir(target_browser, platform)
        if manifest_dir is None:
            removed.append(None)
            continue
        manifest_path = manifest_dir / f"{HOST_NAME}.json"
        try:
            manifest_path.unlink()
        except FileNotFoundError:
            pass
        removed.append(manifest_path)
    return removed


def _stop_managed_before_purge(root: Path) -> None:
    state_file = root / "state" / "server-state.json"
    if not state_file.is_file():
        return
    config_path = root / "native-host-config.json"
    try:
        config = load_config(config_path)
    except HostRequestError:
        config = HostConfig(
            install_root=root.parent,
            models_root=root.parent / "models",
            python_executable=Path(sys.executable).resolve(),
            state_file=state_file,
            log_file=root / "logs" / "ct2-server.log",
        )
    try:
        ServerController(config).stop()
    except HostRequestError as exc:
        if exc.code != "not_managed":
            raise NativeInstallError(
                f"Could not stop the managed CT2 server: "
                f"{exc.message}"
            ) from exc


def remove_installed_files(
    platform_name: str | None = None,
    *,
    purge_models: bool = False,
) -> None:
    platform = _platform_name(platform_name)
    root = native_host_root(platform)
    if root.exists():
        _stop_managed_before_purge(root)
        shutil.rmtree(root, ignore_errors=True)
    venv = install_root(platform) / "venv"
    if venv.exists():
        shutil.rmtree(venv, ignore_errors=True)
    if purge_models:
        models = models_root(platform)
        if models.exists():
            shutil.rmtree(models, ignore_errors=True)
