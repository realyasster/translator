"""FastAPI application for local NLLB translation."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from .coordinator import (
    InferenceCoordinator,
    InferenceDeadlineExceeded,
    RequestExpiredError,
)
from .engine import InputTooLongError, load_engine
from .languages import (
    MAX_INPUT_TOKENS,
    SUPPORTED_LANGUAGES,
    is_supported_language,
    supported_codes,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ServerSettings:
    model_dir: Path
    device: str = "cpu"
    compute_type: str = "int8"
    deadline_seconds: float = 30.0
    max_input_tokens: int = MAX_INPUT_TOKENS


class TranslateRequest(BaseModel):
    model: str
    text: str
    source_lang: str
    target_lang: str


def create_app(
    engine_factory: Callable[[], Any] | None = None,
    settings: ServerSettings | None = None,
) -> FastAPI:
    """Create the app. Tests inject a fake engine through engine_factory."""
    if settings is None:
        raise ValueError("ServerSettings is required")
    config = settings

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.ready = False
        factory = engine_factory
        if factory is None:
            factory = lambda: load_engine(
                config.model_dir,
                device=config.device,
                compute_type=config.compute_type,
            )
        # Loading is blocking and intentionally happens exactly once, before
        # the app accepts requests.
        engine = await run_in_threadpool(factory)
        app.state.engine = engine
        app.state.coordinator = InferenceCoordinator(
            engine,
            deadline_seconds=config.deadline_seconds,
            max_input_tokens=config.max_input_tokens,
        )
        app.state.ready = True
        try:
            yield
        finally:
            app.state.ready = False
            coordinator = getattr(app.state, "coordinator", None)
            if coordinator is not None:
                coordinator.shutdown()
            close_engine = getattr(engine, "close", None)
            # Do not unload the native model while a timed-out inference may
            # still be running; process shutdown releases it safely.
            if callable(close_engine) and not getattr(
                coordinator, "has_active_inference", False
            ):
                close_engine()

    app = FastAPI(
        title="Universal Subtitle Translator CTranslate2 server",
        version="0.2.0",
        lifespan=lifespan,
    )
    app.state.ready = False
    app.state.settings = config

    @app.middleware("http")
    async def require_json_post(request: Request, call_next: Callable[..., Any]):
        if request.method == "POST" and request.url.path == "/translate":
            content_type = (
                request.headers.get("content-type", "")
                .split(";", 1)[0]
                .strip()
                .lower()
            )
            if content_type != "application/json":
                return JSONResponse(
                    status_code=422,
                    content={"detail": "Content-Type must be application/json"},
                )
        return await call_next(request)

    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^chrome-extension://.*$",
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
        max_age=600,
    )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request: Request, _exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={"detail": "Invalid request body."},
        )

    @app.get("/health")
    async def health(request: Request) -> dict[str, Any]:
        if not getattr(request.app.state, "ready", False):
            raise HTTPException(status_code=503, detail="Model not loaded")
        engine = request.app.state.engine
        model_dir = getattr(engine, "model_dir", config.model_dir)
        adapter = getattr(engine, "adapter", None)
        language_pairs = (
            adapter.language_pairs()
            if adapter is not None
            and hasattr(adapter, "language_pairs")
            else None
        )
        return {
            "status": "ready",
            "model": getattr(engine, "model_id", ""),
            # Privacy: report only the folder name, never the absolute path or
            # the operating-system user name.
            "model_dir": Path(model_dir).name,
            "family": getattr(engine, "family", None) or "nllb",
            "language_pairs": language_pairs,
            "device": getattr(engine, "device", config.device),
            "compute_type": getattr(
                engine, "compute_type", config.compute_type
            ),
            "max_input_tokens": config.max_input_tokens,
        }

    @app.post("/translate")
    async def translate(payload: TranslateRequest, request: Request) -> dict[str, str]:
        if not getattr(request.app.state, "ready", False):
            raise HTTPException(status_code=503, detail="Model not loaded")

        engine = request.app.state.engine
        loaded_model = getattr(engine, "model_id", "")
        if payload.model != loaded_model:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"Model '{payload.model}' does not match the loaded model "
                    f"'{loaded_model}'."
                ),
            )

        if not payload.text.strip():
            raise HTTPException(status_code=422, detail="Text must not be blank.")

        adapter = getattr(engine, "adapter", None)
        supports_pair = getattr(adapter, "supports", None)
        if callable(supports_pair):
            if not supports_pair(payload.source_lang, payload.target_lang):
                supported_pairs = None
                language_pairs = getattr(adapter, "language_pairs", None)
                if callable(language_pairs):
                    supported_pairs = language_pairs()
                if supported_pairs:
                    pairs_text = ", ".join(
                        f"{source} -> {target}"
                        for source, target in supported_pairs
                    )
                    detail = (
                        f"Unsupported language pair "
                        f"'{payload.source_lang}' -> "
                        f"'{payload.target_lang}'. "
                        f"This model supports: {pairs_text}."
                    )
                else:
                    detail = (
                        f"Unsupported language code "
                        f"'{payload.source_lang}' or "
                        f"'{payload.target_lang}'. "
                        f"Supported codes: {supported_codes()}."
                    )
                raise HTTPException(status_code=422, detail=detail)
        else:
            if not is_supported_language(payload.source_lang):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Unsupported source language code "
                        f"'{payload.source_lang}'. "
                        f"Supported codes: {supported_codes()}."
                    ),
                )
            if not is_supported_language(payload.target_lang):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Unsupported target language code "
                        f"'{payload.target_lang}'. "
                        f"Supported codes: {supported_codes()}."
                    ),
                )

        coordinator: InferenceCoordinator = request.app.state.coordinator
        try:
            outcome = await coordinator.translate(
                request,
                payload.text,
                payload.source_lang,
                payload.target_lang,
            )
        except InputTooLongError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except RequestExpiredError as exc:
            raise HTTPException(status_code=504, detail=str(exc)) from exc
        except InferenceDeadlineExceeded as exc:
            raise HTTPException(status_code=504, detail=str(exc)) from exc
        except Exception:
            # Do not log subtitle text. The traceback only carries the
            # exception and call stack.
            logger.exception("CTranslate2 inference failed")
            raise HTTPException(
                status_code=500,
                detail="Inference failed.",
            ) from None

        return {"translatedText": outcome.translated_text}

    return app


# The supported language table is imported here so documentation and tests can
# assert the server and extension expose the same first-release set.
__all__ = ["SUPPORTED_LANGUAGES", "ServerSettings", "create_app"]
