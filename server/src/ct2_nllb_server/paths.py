"""Filesystem layout for a repository-independent installation."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def platform_name(value: str | None = None) -> str:
    if value:
        return value
    if sys.platform.startswith("win"):
        return "windows"
    if sys.platform == "darwin":
        return "macos"
    return "linux"


def install_root(platform: str | None = None) -> Path:
    """Single folder containing venv/, models/ and native-host/."""
    name = platform_name(platform)
    if name == "windows":
        base = Path(
            os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local"
        )
        return base / "UniversalSubtitleTranslator"
    if name == "macos":
        return (
            Path.home()
            / "Library"
            / "Application Support"
            / "UniversalSubtitleTranslator"
        )
    base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return base / "universal-subtitle-translator"


def native_host_root(platform: str | None = None) -> Path:
    return install_root(platform) / "native-host"


def models_root(platform: str | None = None) -> Path:
    return install_root(platform) / "models"


def venv_root(platform: str | None = None) -> Path:
    return install_root(platform) / "venv"


def venv_python(platform: str | None = None) -> Path:
    if platform_name(platform) == "windows":
        return venv_root(platform) / "Scripts" / "python.exe"
    return venv_root(platform) / "bin" / "python"
