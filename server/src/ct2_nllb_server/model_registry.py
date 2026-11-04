"""Discovery and resolution of prepared model directories."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .adapters import AdapterError, SUPPORTED_FAMILIES, family_from_metadata
from .paths import models_root as install_models_root


class ModelRegistryError(RuntimeError):
    def __init__(
        self,
        code: str,
        message: str,
        candidates: list[dict[str, Any]] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.candidates = candidates or []


def default_models_root(install_root: str | Path | None = None) -> Path:
    if install_root is None:
        return install_models_root()
    return Path(install_root).expanduser().resolve() / "models"


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def inspect_model_directory(directory: Path) -> dict[str, Any]:
    """Describe one candidate folder without raising."""
    entry: dict[str, Any] = {
        "directory": str(directory.resolve()),
        "name": directory.name,
        "model_id": None,
        "family": None,
        "revision": None,
        "valid": False,
        "problem": None,
    }
    metadata_path = directory / "model-metadata.json"
    if not metadata_path.is_file():
        entry["problem"] = "model-metadata.json is missing."
        return entry
    metadata = _read_json(metadata_path)
    if metadata is None:
        entry["problem"] = "model-metadata.json is not a readable JSON object."
        return entry
    model_id = metadata.get("model_id")
    if not isinstance(model_id, str) or not model_id.strip():
        entry["problem"] = "model_id is missing from model-metadata.json."
        return entry
    entry["model_id"] = model_id
    revision = metadata.get("revision")
    if isinstance(revision, str):
        entry["revision"] = revision
    try:
        family = family_from_metadata(metadata)
    except AdapterError:
        family = str(metadata.get("family") or metadata.get("architecture") or "")
        entry["family"] = family or None
        entry["problem"] = (
            f"Unsupported model family '{family or 'unknown'}'. "
            f"Supported families: {', '.join(SUPPORTED_FAMILIES)}."
        )
        return entry
    entry["family"] = family
    if not (directory / "tokenizer").is_dir():
        entry["problem"] = "Tokenizer directory is missing."
        return entry
    if not (directory / "model.bin").is_file():
        entry["problem"] = "model.bin is missing."
        return entry
    entry["valid"] = True
    return entry


def scan_models(models_root: str | Path) -> list[dict[str, Any]]:
    root = Path(models_root).expanduser().resolve()
    if not root.is_dir():
        return []
    return [
        inspect_model_directory(directory)
        for directory in sorted(root.iterdir(), key=lambda path: path.name.lower())
        if directory.is_dir()
    ]


def _describe(candidates: list[dict[str, Any]]) -> str:
    descriptions = []
    for candidate in candidates:
        if candidate.get("valid"):
            descriptions.append(
                f"{candidate['name']} ({candidate['model_id']})"
            )
        else:
            descriptions.append(
                f"{candidate['name']} (invalid: {candidate['problem']})"
            )
    return ", ".join(descriptions)


def resolve_model_directory(
    models_root: str | Path,
    model_directory: str | Path,
    selected_model: str,
) -> Path:
    """Resolve a configured directory, falling back to a prepared model scan."""
    models_path = Path(models_root).expanduser().resolve()
    raw = str(model_directory or "").strip()

    if raw:
        candidate = Path(raw).expanduser()
        if not candidate.is_absolute():
            # Legacy saved values look like ./server/models/<name>; only the
            # last segment is meaningful inside the install models folder.
            candidate = models_path / candidate.name
        candidate = candidate.resolve()
        if candidate.is_dir():
            return candidate

    candidates = scan_models(models_path)
    valid = [candidate for candidate in candidates if candidate["valid"]]
    matches = [
        candidate
        for candidate in valid
        if candidate["model_id"] == selected_model
    ]
    if len(matches) == 1:
        return Path(matches[0]["directory"])
    if len(matches) > 1:
        names = ", ".join(candidate["name"] for candidate in matches)
        raise ModelRegistryError(
            "model_select_required",
            f"Several prepared models match '{selected_model}': {names}. "
            "Choose one model directory in the setup card.",
            matches,
        )

    tried = f" Tried: {raw}." if raw else ""
    if candidates:
        raise ModelRegistryError(
            "model_not_prepared",
            f"No prepared model matched '{selected_model}'.{tried} "
            f"Prepared models: {_describe(candidates)}.",
            candidates,
        )
    raise ModelRegistryError(
        "model_not_prepared",
        f"No prepared models were found in {models_path}.{tried} "
        "Run prepare-model first.",
        candidates,
    )
