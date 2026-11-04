"""Command line interface for preparation and serving."""

from __future__ import annotations

import argparse
import ipaddress
import json
import logging
import sys
from pathlib import Path

from .adapters import SUPPORTED_FAMILIES
from .app import ServerSettings, create_app
from .engine import EngineLoadError, read_metadata
from .model_registry import default_models_root, scan_models
from .prepare import (
    PrepareError,
    check_model,
    prepare_model,
    search_translation_models,
)


def _loopback_host(value: str) -> str:
    if value == "localhost":
        return value
    try:
        address = ipaddress.ip_address(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            "Host must be an IP address or localhost."
        ) from exc
    if not address.is_loopback:
        raise argparse.ArgumentTypeError(
            "The server only binds to loopback addresses for safety."
        )
    return value


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ct2-nllb-server",
        description="Prepare and serve a local CTranslate2 NLLB model.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare = subparsers.add_parser(
        "prepare-model",
        help="Validate, convert and save an NLLB model locally.",
    )
    prepare.add_argument(
        "--model",
        required=True,
        help="Hugging Face model id, for example facebook/nllb-200-distilled-600M.",
    )
    prepare.add_argument(
        "--output",
        required=True,
        help="Output directory for the converted model and local tokenizer.",
    )
    prepare.add_argument(
        "--revision",
        default=None,
        help="Optional Hugging Face revision. The resolved SHA is recorded.",
    )
    prepare.add_argument(
        "--overwrite",
        action="store_true",
        help="Explicitly replace an existing non-empty output directory.",
    )
    prepare.add_argument(
        "--family",
        choices=("auto", *SUPPORTED_FAMILIES),
        default="auto",
        help="Model family. auto detects NLLB, M2M-100, mBART-50 or Marian.",
    )

    list_models = subparsers.add_parser(
        "list-models",
        help="List prepared model folders.",
    )
    list_models.add_argument(
        "--models-root",
        default=None,
        help="Model root (default: <install root>/models).",
    )
    list_models.add_argument("--json", action="store_true")

    search_models = subparsers.add_parser(
        "search-models",
        help="Search Hugging Face translation models with a supported family.",
    )
    search_models.add_argument("query", help="Search text, for example opus-mt-en-tr.")
    search_models.add_argument("--limit", type=int, default=15)
    search_models.add_argument("--json", action="store_true")

    check = subparsers.add_parser(
        "check-model",
        help="Validate a Hugging Face model id without preparing it.",
    )
    check.add_argument("model_id", help="Hugging Face model id.")
    check.add_argument("--revision", default=None)
    check.add_argument("--json", action="store_true")

    doctor = subparsers.add_parser(
        "doctor",
        help="Report the installation state for the installer.",
    )
    doctor.add_argument(
        "--install-root",
        default=None,
        help="Installation root (default: the platform install root).",
    )
    doctor.add_argument("--json", action="store_true")

    record_install = subparsers.add_parser(
        "record-install",
        help="Record a successful installation for doctor and repeated runs.",
    )
    record_install.add_argument("--ref", required=True)
    record_install.add_argument(
        "--install-root",
        default=None,
        help="Installation root (default: the platform install root).",
    )
    record_install.add_argument("--json", action="store_true")

    serve = subparsers.add_parser(
        "serve",
        help="Start the local HTTP server for one prepared model.",
    )
    serve.add_argument(
        "--model-dir",
        required=True,
        help="Directory created by prepare-model.",
    )
    serve.add_argument("--host", default="127.0.0.1", type=_loopback_host)
    serve.add_argument("--port", default=8000, type=int)
    serve.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    serve.add_argument(
        "--compute-type",
        default="int8",
        choices=(
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
        ),
    )
    serve.add_argument(
        "--deadline-seconds",
        default=30.0,
        type=float,
        help="Overall request deadline in seconds (default: 30).",
    )
    serve.add_argument("--log-level", default="info")

    install_native = subparsers.add_parser(
        "install-native-host",
        help="Install the Chrome/Edge Native Messaging launcher.",
    )
    install_native.add_argument(
        "--extension-id",
        action="append",
        default=None,
        help=(
            "Chromium extension ID to allow. Repeat to allow several IDs. "
            "Default: the built-in stable ID from the extension manifest."
        ),
    )
    install_native.add_argument(
        "--browser",
        choices=("chrome", "edge", "all"),
        default="all",
        help="Browser registration target (default: all).",
    )
    install_native.add_argument(
        "--repo-root",
        default=None,
        help=(
            "Repository root containing server/. "
            "Default: derived from this CLI's location."
        ),
    )
    install_native.add_argument(
        "--force",
        action="store_true",
        help="Rebuild/replace the native host executable.",
    )
    install_native.add_argument(
        "--force-if-outdated",
        action="store_true",
        help="Rebuild only when the installed host version is older.",
    )

    uninstall_native = subparsers.add_parser(
        "uninstall-native-host",
        help="Remove the Native Messaging registration.",
    )
    uninstall_native.add_argument(
        "--browser",
        choices=("chrome", "edge", "all"),
        default="all",
        help="Browser registration target (default: all).",
    )
    uninstall_native.add_argument(
        "--purge",
        action="store_true",
        help="Also remove the launcher, venv, config, state and logs.",
    )
    uninstall_native.add_argument(
        "--purge-models",
        action="store_true",
        help="With --purge, also delete the downloaded models folder.",
    )
    return parser


def _prepare(args: argparse.Namespace) -> int:
    try:
        metadata = prepare_model(
            model_id=args.model,
            output_dir=args.output,
            revision=args.revision,
            overwrite=args.overwrite,
            family=args.family,
        )
    except PrepareError as exc:
        print(f"prepare-model failed: {exc}", file=sys.stderr)
        return 2
    print(f"Prepared model: {metadata['model_id']}")
    print(f"Family: {metadata.get('family', 'nllb')}")
    if metadata.get("source_lang") and metadata.get("target_lang"):
        print(
            f"Language pair: {metadata['source_lang']} -> "
            f"{metadata['target_lang']}"
        )
    print(f"Revision: {metadata['revision']}")
    print(f"Output: {Path(args.output).expanduser().resolve()}")
    print("The model is stored externally and is not part of the extension.")
    return 0


def _serve(args: argparse.Namespace) -> int:
    model_dir = Path(args.model_dir).expanduser().resolve()
    try:
        read_metadata(model_dir)
    except EngineLoadError as exc:
        print(f"serve failed: {exc}", file=sys.stderr)
        return 2

    logging.basicConfig(
        level=getattr(logging, str(args.log_level).upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    settings = ServerSettings(
        model_dir=model_dir,
        device=args.device,
        compute_type=args.compute_type,
        deadline_seconds=args.deadline_seconds,
    )
    app = create_app(settings=settings)
    try:
        import uvicorn
    except Exception as exc:  # pragma: no cover - environment dependent
        print(
            "serve failed: uvicorn is not installed. "
            'Install server runtime dependencies first.',
            file=sys.stderr,
        )
        print(str(exc), file=sys.stderr)
        return 2

    # One process and one worker: the coordinator serializes native inference.
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        workers=1,
        log_level=str(args.log_level).lower(),
        access_log=True,
    )
    return 0


def _default_repo_root() -> Path:
    # server/src/ct2_nllb_server/cli.py -> repository root
    candidate = Path(__file__).resolve().parents[3]
    if (candidate / "server").is_dir():
        return candidate
    return Path.cwd()


def _install_native_host(args: argparse.Namespace) -> int:
    from .native_install import NativeInstallError, install_native_host

    try:
        installed = install_native_host(
            args.extension_id,
            browser=args.browser,
            repo_root=args.repo_root or _default_repo_root(),
            force=args.force,
            force_if_outdated=args.force_if_outdated,
        )
    except NativeInstallError as exc:
        print(f"install-native-host failed: {exc}", file=sys.stderr)
        return 2
    print(f"Installed native host: {installed.host_path}")
    for manifest_path in installed.manifests:
        print(f"Host manifest: {manifest_path}")
    print(f"Config: {installed.config_path}")
    print(
        "Restart Chrome/Edge completely if the extension does not detect "
        "the host immediately."
    )
    return 0


def _uninstall_native_host(args: argparse.Namespace) -> int:
    from .native_install import (
        NativeInstallError,
        remove_installed_files,
        uninstall_native_host,
    )

    try:
        removed = uninstall_native_host(args.browser)
    except NativeInstallError as exc:
        print(f"uninstall-native-host failed: {exc}", file=sys.stderr)
        return 2
    for manifest_path in removed:
        if manifest_path is not None:
            print(f"Removed native host registration: {manifest_path}")
    if args.purge:
        try:
            remove_installed_files(purge_models=args.purge_models)
        except NativeInstallError as exc:
            print(f"uninstall-native-host failed: {exc}", file=sys.stderr)
            return 2
        print("Removed native host, virtual environment and configuration.")
    return 0


def _list_models(args: argparse.Namespace) -> int:
    root = Path(
        args.models_root or default_models_root()
    ).expanduser().resolve()
    models = scan_models(root)
    if args.json:
        print(
            json.dumps(
                {"models_root": str(root), "models": models},
                indent=2,
                ensure_ascii=False,
            )
        )
        return 0
    print(f"Models root: {root}")
    if not models:
        print("No model directories were found.")
        return 0
    for model in models:
        state = "ready" if model["valid"] else model["problem"]
        print(
            f"{model['name']}\t{model['model_id'] or '-'}\t"
            f"{model['family'] or '-'}\t{state}"
        )
    return 0


def _search_models(args: argparse.Namespace) -> int:
    try:
        results = search_translation_models(args.query, limit=args.limit)
    except Exception as exc:
        print(f"search-models failed: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(results, indent=2, ensure_ascii=False))
        return 0
    if not results:
        print("No supported translation models matched.")
        return 0
    for model in results:
        downloads = model["downloads"]
        suffix = f" ({downloads} downloads)" if downloads is not None else ""
        print(f"{model['id']}\t{model['family']}{suffix}")
    return 0


def _check_model(args: argparse.Namespace) -> int:
    result = check_model(args.model_id, revision=args.revision)
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(result["message"])
        if result["suggestions"]:
            print("Try: " + ", ".join(result["suggestions"]))
    return 0 if result["ok"] else 1


def _doctor(args: argparse.Namespace) -> int:
    from .doctor import collect_report, format_report

    report = collect_report(args.install_root)
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(format_report(report))
    return 0


def _record_install(args: argparse.Namespace) -> int:
    from .doctor import write_install_state

    payload = write_install_state(args.ref, args.install_root)
    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print(f"Recorded install ref: {payload['ref']}")
    return 0


def main(argv: list[str] | None = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.command == "prepare-model":
        raise SystemExit(_prepare(args))
    if args.command == "list-models":
        raise SystemExit(_list_models(args))
    if args.command == "search-models":
        raise SystemExit(_search_models(args))
    if args.command == "check-model":
        raise SystemExit(_check_model(args))
    if args.command == "doctor":
        raise SystemExit(_doctor(args))
    if args.command == "record-install":
        raise SystemExit(_record_install(args))
    if args.command == "serve":
        raise SystemExit(_serve(args))
    if args.command == "install-native-host":
        raise SystemExit(_install_native_host(args))
    if args.command == "uninstall-native-host":
        raise SystemExit(_uninstall_native_host(args))
    parser.error("Unknown command")
